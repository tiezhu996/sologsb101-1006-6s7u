/**
 * 复测测次状态（Pinia）
 * 维护测次顺序、变化量缓存与按裂缝汇总的发展速率。
 *
 * 作废口径：作废读数保留原值，但不参与台账宽度/长度、变化量、速率分级与预警；
 * 恢复后按日期重新纳入有效链计算，测次序号在作废期间保留不回收。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useIdbTable } from '@/hooks/useIdbTable'
import { db, type SurveyRow } from '@/utils/db'
import type { Survey, SurveyDraft } from '@/types/survey'
import { isSurveyVoided } from '@/types/survey'
import type { AdviceLevel } from '@/types/advice'
import { buildSurveyPoints, levelFromRate, round, sortSurveysByDate } from '@/utils/rate'

export interface CrackRateSummary {
  crackId: string
  /** 有效测次数量 */
  count: number
  /** 作废测次数量 */
  voidedCount: number
  /** 首测宽度（mm，初测不能作废） */
  firstWidth: number
  /** 最新有效宽度（mm） */
  latestWidth: number
  /** 最新有效长度（mm） */
  latestLength: number
  /** 累计变化量（mm，最新有效 − 首测） */
  totalDelta: number
  /** 最新有效测次月均速率（mm/月） */
  rate: number
  level: AdviceLevel
  /** 最新有效测次日期 */
  lastDate: string
}

/** 历史整治建议等级是否与最新有效分级不一致（不一致需待复核），实现在 utils/rate.ts */

export const useSurveyStore = defineStore('survey', () => {
  const surveyTable = useIdbTable<SurveyRow>((database) => database.surveys, { sortByUpdatedAt: false })

  /** 正在查看的裂缝 id（复测对比页与速率分级页共用） */
  const activeCrackId = ref<string | null>(null)

  const surveys = computed<SurveyRow[]>(() =>
    [...surveyTable.rows.value].sort((a, b) => {
      const crackDiff = a.crackId.localeCompare(b.crackId)
      if (crackDiff !== 0) return crackDiff
      return a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)
    })
  )

  /** 全部测次（按日期、其次按测次升序，含作废） */
  function surveysOf(crackId: string): Survey[] {
    return surveys.value.filter((survey) => survey.crackId === crackId)
  }

  /** 仅有效测次 */
  function validSurveysOf(crackId: string): Survey[] {
    return sortSurveysByDate(surveysOf(crackId).filter((survey) => !isSurveyVoided(survey)))
  }

  /** 按裂缝汇总的速率缓存（全部按有效测次计算） */
  const rates = computed<CrackRateSummary[]>(() => {
    const grouped = new Map<string, SurveyRow[]>()
    surveys.value.forEach((survey) => {
      const list = grouped.get(survey.crackId)
      if (list) list.push(survey)
      else grouped.set(survey.crackId, [survey])
    })
    const list: CrackRateSummary[] = []
    grouped.forEach((rows, crackId) => {
      const validRows = rows.filter((survey) => !isSurveyVoided(survey))
      const points = buildSurveyPoints(validRows)
      const latest = points[points.length - 1]
      const first = points[0]
      const rate = latest ? latest.rate : 0
      list.push({
        crackId,
        count: points.length,
        voidedCount: rows.length - validRows.length,
        firstWidth: first ? first.widthMm : 0,
        latestWidth: latest ? latest.widthMm : 0,
        latestLength: latest ? latest.lengthMm : 0,
        totalDelta: round((latest ? latest.widthMm : 0) - (first ? first.widthMm : 0), 2),
        rate,
        level: levelFromRate(rate),
        lastDate: latest ? latest.date : ''
      })
    })
    return list.sort((a, b) => b.rate - a.rate)
  })

  const rateMap = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    rates.value.forEach((item) => {
      map[item.crackId] = item.rate
    })
    return map
  })

  const levelMap = computed<Record<string, AdviceLevel>>(() => {
    const map: Record<string, AdviceLevel> = {}
    rates.value.forEach((item) => {
      map[item.crackId] = item.level
    })
    return map
  })

  const warningCrackIds = computed(() => rates.value.filter((item) => item.level !== '一般').map((item) => item.crackId))

  /** 全库作废读数总数 */
  const totalVoidedCount = computed(() =>
    surveyTable.rows.value.reduce((sum, survey) => sum + (isSurveyVoided(survey) ? 1 : 0), 0)
  )

  /** 至少有一条有效测次的裂缝数量 */
  const measuredCrackCount = computed(() => rates.value.filter((item) => item.count > 0).length)

  const summaryOf = (crackId: string): CrackRateSummary | null =>
    rates.value.find((item) => item.crackId === crackId) ?? null

  function setActiveCrack(id: string | null): void {
    activeCrackId.value = id
  }

  /**
   * 追加一次复测读数：序号沿用日期链（作废读数仍占位），变化量由 recalculate 统一按
   * 上一有效测次重算。
   */
  async function createSurvey(draft: SurveyDraft): Promise<SurveyRow> {
    const existing = surveysOf(draft.crackId)
    const seq = existing.reduce((max, survey) => Math.max(max, survey.seq), 0) + 1
    const row = (await surveyTable.create(
      {
        crackId: draft.crackId,
        seq,
        date: draft.date,
        widthMm: round(draft.widthMm, 2),
        lengthMm: Math.round(draft.lengthMm),
        deltaWidthMm: 0,
        surveyor: draft.surveyor.trim() || '未署名',
        voided: false,
        voidReason: '',
        voidedAt: 0
      },
      'sv'
    )) as SurveyRow
    await recalculate(draft.crackId)
    return row
  }

  /** 编辑测次后按日期重排序号并重算全部变化量（作废读数只能恢复，不能直接改值） */
  async function updateSurvey(id: string, draft: SurveyDraft): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row || isSurveyVoided(row)) return
    await surveyTable.update(id, {
      date: draft.date,
      widthMm: round(draft.widthMm, 2),
      lengthMm: Math.round(draft.lengthMm),
      surveyor: draft.surveyor.trim() || '未署名'
    })
    await recalculate(draft.crackId)
  }

  async function removeSurvey(id: string): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row) return
    await surveyTable.remove(id)
    await recalculate(row.crackId)
  }

  /**
   * 作废复测读数：必填原因，原值完整保留，不再参与台账宽度、变化量、速率与预警。
   * 初测读数（日期最早）不能作废。
   */
  async function voidSurvey(id: string, reason: string): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row || isSurveyVoided(row)) return
    const ordered = sortSurveysByDate(surveysOf(row.crackId))
    if (ordered[0]?.id === id) return
    await db.surveys.update(id, {
      voided: true,
      voidReason: reason.trim(),
      voidedAt: Date.now()
    })
    await recalculate(row.crackId)
  }

  /** 恢复作废读数：清空作废标记，按日期重新纳入有效链计算（措施/建议等历史记录不变） */
  async function restoreSurvey(id: string): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row || !isSurveyVoided(row)) return
    await db.surveys.update(id, {
      voided: false,
      voidReason: '',
      voidedAt: 0
    })
    await recalculate(row.crackId)
  }

  /**
   * 按日期顺序重排某裂缝的测次序号，并重算有效链变化量：
   * - 作废读数保留原值（widthMm/lengthMm/deltaWidthMm 均不改动），仅随日期重新编号；
   * - 有效读数的变化量相对上一有效测次计算；
   * - 台账裂缝宽度/长度同步为最新有效测次。
   */
  async function recalculate(crackId: string): Promise<void> {
    const rows = sortSurveysByDate(await db.surveys.where('crackId').equals(crackId).toArray())
    const now = Date.now()
    let previous: SurveyRow | null = null
    const patches = rows.map((row, index) => {
      const seq = index + 1
      if (isSurveyVoided(row)) {
        // 作废点：冻结原值，仅校正序号（序号在作废期间不回收）
        const frozen: SurveyRow = { ...row, seq, updatedAt: now }
        return frozen
      }
      const valid: SurveyRow = {
        ...row,
        seq,
        deltaWidthMm: previous ? round(row.widthMm - previous.widthMm, 2) : 0,
        updatedAt: now
      }
      previous = row
      return valid
    })
    if (patches.length > 0) await db.surveys.bulkPut(patches)
    await syncCrackToLatest(crackId)
  }

  /** 把裂缝台账上的宽度/长度同步为最新有效测次读数（作废读数不计入） */
  async function syncCrackToLatest(crackId: string): Promise<void> {
    const valid = validSurveysOf(crackId)
    const latest = valid[valid.length - 1]
    if (!latest) return
    await db.cracks.update(crackId, { widthMm: latest.widthMm, lengthMm: latest.lengthMm, updatedAt: Date.now() })
  }

  return {
    surveyTable,
    surveys,
    rates,
    rateMap,
    levelMap,
    warningCrackIds,
    totalVoidedCount,
    measuredCrackCount,
    activeCrackId,
    surveysOf,
    validSurveysOf,
    summaryOf,
    setActiveCrack,
    createSurvey,
    updateSurvey,
    removeSurvey,
    voidSurvey,
    restoreSurvey,
    recalculate
  }
})
