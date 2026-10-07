/**
 * 裂缝发展态势：拉取某条裂缝的全部测次，派生变化量序列、月均速率与分级结果。
 * 被复测对比页与速率分级页消费。
 *
 * 作废口径：作废读数保留原值用于展示，但不参与台账宽度、变化量、速率与预警；
 * points/rate/delta/level/warning 一律只按有效测次计算。
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { liveQuery } from 'dexie'
import type { Survey, SurveyPoint } from '@/types/survey'
import { isSurveyVoided } from '@/types/survey'
import type { AdviceLevel } from '@/types/advice'
import { db } from '@/utils/db'
import { buildSurveyPoints, latestRate, levelFromRate, sortSurveysByDate, totalDelta } from '@/utils/rate'

export interface UseCrackTrendResult {
  /** 全部测次（按日期、其次按测次升序），含作废读数 */
  surveys: Ref<Survey[]>
  /** 仅有效测次（按日期、其次按测次升序） */
  validSurveys: ComputedRef<Survey[]>
  /** 有效测次折线取点（驱动台账宽度、变化量、速率与分级） */
  points: ComputedRef<SurveyPoint[]>
  /** 含作废点的全序列取点（作废点标记 voided，供测次明细展示原值） */
  allPoints: ComputedRef<SurveyPoint[]>
  /** 最新有效测次 */
  latest: ComputedRef<SurveyPoint | null>
  /** 作废测次数 */
  voidedCount: ComputedRef<number>
  /** 初测读数（日期最早的测次）id，初测不允许作废 */
  initialSurveyId: ComputedRef<string | null>
  /** 最新有效测次的月均速率（mm/月） */
  rate: ComputedRef<number>
  /** 累计宽度变化量（mm） */
  delta: ComputedRef<number>
  /** 由最新有效速率推导的等级 */
  level: ComputedRef<AdviceLevel>
  /** 是否已发展（速率超过预警阈值） */
  warning: ComputedRef<boolean>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}

/**
 * @param crackId 裂缝 id（支持 ref / getter）
 */
export function useCrackTrend(crackId: MaybeRefOrGetter<string | null | undefined>): UseCrackTrendResult {
  const surveys = ref<Survey[]>([]) as Ref<Survey[]>
  const loading = ref(false)
  const error = ref<string | null>(null)
  const subscription = shallowRef<{ unsubscribe: () => void } | null>(null)

  const load = async (): Promise<void> => {
    const id = toValue(crackId)
    if (!id) {
      surveys.value = []
      return
    }
    loading.value = true
    try {
      const rows = await db.surveys.where('crackId').equals(id).toArray()
      surveys.value = sortSurveysByDate(rows)
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : '读取复测记录失败'
    } finally {
      loading.value = false
    }
  }

  const subscribe = (): void => {
    subscription.value?.unsubscribe()
    subscription.value = null
    const id = toValue(crackId)
    if (!id) {
      surveys.value = []
      return
    }
    subscription.value = liveQuery(async () =>
      sortSurveysByDate(await db.surveys.where('crackId').equals(id).toArray())
    ).subscribe({
      next: (rows) => {
        surveys.value = rows
        error.value = null
      },
      error: (err: unknown) => {
        error.value = err instanceof Error ? err.message : '订阅复测记录失败'
      }
    })
    void load()
  }

  watch(() => toValue(crackId), subscribe, { immediate: true })

  const validSurveys = computed(() => surveys.value.filter((survey) => !isSurveyVoided(survey)))
  const points = computed(() => buildSurveyPoints(validSurveys.value))
  const allPoints = computed(() => buildSurveyPoints(surveys.value, true))
  const latest = computed(() => (points.value.length > 0 ? points.value[points.value.length - 1] : null))
  const voidedCount = computed(() => surveys.value.filter((survey) => isSurveyVoided(survey)).length)
  // 初测 = 日期最早的测次；初测是复测链基准，不能作废
  const initialSurveyId = computed(() => (surveys.value.length > 0 ? surveys.value[0].id : null))
  const rate = computed(() => latestRate(points.value))
  const delta = computed(() => totalDelta(points.value))
  const level = computed(() => levelFromRate(rate.value))
  const warning = computed(() => level.value !== '一般')

  return {
    surveys,
    validSurveys,
    points,
    allPoints,
    latest,
    voidedCount,
    initialSurveyId,
    rate,
    delta,
    level,
    warning,
    loading,
    error,
    reload: load
  }
}
