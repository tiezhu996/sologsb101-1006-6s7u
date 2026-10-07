/**
 * 复测测次状态（Pinia）
 * 维护测次顺序、变化量缓存与按裂缝汇总的发展速率。
 * 口径：台账宽度/长度、变化量、速率与预警一律按「有效测次」（未作废）计算；
 * 作废测次保留原值与测次链位置，恢复后按日期重新纳入计算。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useIdbTable } from '@/hooks/useIdbTable'
import { db, type SurveyRow } from '@/utils/db'
import { isSurveyEffective, type Survey, type SurveyDraft } from '@/types/survey'
import type { AdviceLevel } from '@/types/advice'
import { buildSurveyPoints, effectivePoints, levelFromRate, round } from '@/utils/rate'

export interface CrackRateSummary {
  crackId: string
  /** 有效测次数量（未作废） */
  count: number
  /** 已作废测次数量 */
  voidedCount: number
  /** 首次有效测次宽度（mm） */
  firstWidth: number
  /** 最新有效测次宽度（mm） */
  latestWidth: number
  /** 累计变化量（mm，有效测次链） */
  totalDelta: number
  /** 最新有效测次月均速率（mm/月） */
  rate: number
  level: AdviceLevel
  /** 最新有效测次日期 */
  lastDate: string
}

export const useSurveyStore = defineStore('survey', () => {
  const surveyTable = useIdbTable<SurveyRow>((database) => database.surveys, { sortByUpdatedAt: false })

  /** 正在查看的裂缝 id（复测对比页与速率分级页共用） */
  const activeCrackId = ref<string | null>(null)

  const surveys = computed<SurveyRow[]>(() =>
    [...surveyTable.rows.value].sort((a, b) => {
      const crackDiff = a.crackId.localeCompare(b.crackId)
      if (crackDiff !== 0) return crackDiff
      return a.seq - b.seq
    })
  )

  function surveysOf(crackId: string): Survey[] {
    return surveys.value.filter((survey) => survey.crackId === crackId)
  }

  /** 按裂缝汇总的速率缓存（只沿有效测次链计算） */
  const rates = computed<CrackRateSummary[]>(() => {
    const grouped = new Map<string, SurveyRow[]>()
    surveys.value.forEach((survey) => {
      const list = grouped.get(survey.crackId)
      if (list) list.push(survey)
      else grouped.set(survey.crackId, [survey])
    })
    const list: CrackRateSummary[] = []
    grouped.forEach((rows, crackId) => {
      const points = buildSurveyPoints(rows)
      const effective = effectivePoints(points)
      const latest = effective[effective.length - 1]
      const first = effective[0]
      const rate = latest ? latest.rate : 0
      list.push({
        crackId,
        count: effective.length,
        voidedCount: points.length - effective.length,
        firstWidth: first ? first.widthMm : 0,
        latestWidth: latest ? latest.widthMm : 0,
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

  /** 全部作废测次数量（统计展示用） */
  const voidedTotal = computed(() => surveys.value.filter((survey) => !isSurveyEffective(survey)).length)

  const summaryOf = (crackId: string): CrackRateSummary | null =>
    rates.value.find((item) => item.crackId === crackId) ?? null

  function setActiveCrack(id: string | null): void {
    activeCrackId.value = id
  }

  /**
   * 追加一次复测读数：自动取下一个测次序号并与前一次有效测次比对生成变化量
   */
  async function createSurvey(draft: SurveyDraft): Promise<SurveyRow> {
    const existing = surveysOf(draft.crackId)
    const previous = existing.length > 0 ? existing[existing.length - 1] : null
    const previousEffective = [...existing].reverse().find((survey) => isSurveyEffective(survey)) ?? null
    const seq = previous ? previous.seq + 1 : 1
    const delta = previousEffective ? round(draft.widthMm - previousEffective.widthMm, 2) : 0
    const row = (await surveyTable.create(
      {
        crackId: draft.crackId,
        seq,
        date: draft.date,
        widthMm: round(draft.widthMm, 2),
        lengthMm: Math.round(draft.lengthMm),
        deltaWidthMm: delta,
        surveyor: draft.surveyor.trim() || '未署名',
        voided: false,
        voidReason: '',
        voidedAt: null
      },
      'sv'
    )) as SurveyRow
    await syncCrackToLatest(draft.crackId)
    return row
  }

  /** 编辑测次后重排序号并重算全部变化量 */
  async function updateSurvey(id: string, draft: SurveyDraft): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row) return
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

  /** 重排某条裂缝的测次序号，并按日期顺序沿有效测次链重算变化量（作废测次保留原值） */
  async function recalculate(crackId: string): Promise<void> {
    const rows = (await db.surveys.where('crackId').equals(crackId).toArray()).sort((a, b) =>
      a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)
    )
    let previousEffective: SurveyRow | null = null
    const patches = rows.map((row, index) => {
      const effective = isSurveyEffective(row)
      const deltaWidthMm = effective
        ? previousEffective
          ? round(row.widthMm - previousEffective.widthMm, 2)
          : 0
        : row.deltaWidthMm
      const patch = { ...row, seq: index + 1, deltaWidthMm, updatedAt: Date.now() }
      if (effective) previousEffective = row
      return patch
    })
    if (patches.length > 0) await db.surveys.bulkPut(patches)
    await syncCrackToLatest(crackId)
  }

  /** 把裂缝台账上的宽度/长度同步为最新有效测次读数（作废测次不参与） */
  async function syncCrackToLatest(crackId: string): Promise<void> {
    const rows = (await db.surveys.where('crackId').equals(crackId).toArray())
      .filter((row) => isSurveyEffective(row))
      .sort((a, b) => a.seq - b.seq)
    const latest = rows[rows.length - 1]
    if (!latest) return
    await db.cracks.update(crackId, { widthMm: latest.widthMm, lengthMm: latest.lengthMm, updatedAt: Date.now() })
  }

  /**
   * 作废测次：填写作废原因并保留原值，移出台账/变化量/速率/预警计算。
   * 初测（首条有效测次）不能作废，保证每条裂缝至少保留一条有效读数。
   * @returns 是否作废成功
   */
  async function voidSurvey(id: string, reason: string): Promise<boolean> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row || !isSurveyEffective(row)) return false
    const firstEffective = surveysOf(row.crackId).find((survey) => isSurveyEffective(survey))
    if (firstEffective && firstEffective.id === id) return false
    await surveyTable.update(id, { voided: true, voidReason: reason.trim(), voidedAt: Date.now() })
    await recalculate(row.crackId)
    return true
  }

  /** 恢复测次：清除作废标记，按日期重新纳入有效测次链计算 */
  async function restoreSurvey(id: string): Promise<void> {
    const row = surveyTable.rows.value.find((item) => item.id === id)
    if (!row || isSurveyEffective(row)) return
    await surveyTable.update(id, { voided: false, voidReason: '', voidedAt: null })
    await recalculate(row.crackId)
  }

  return {
    surveyTable,
    surveys,
    rates,
    rateMap,
    levelMap,
    warningCrackIds,
    voidedTotal,
    activeCrackId,
    surveysOf,
    summaryOf,
    setActiveCrack,
    createSurvey,
    updateSurvey,
    removeSurvey,
    recalculate,
    voidSurvey,
    restoreSurvey
  }
})
