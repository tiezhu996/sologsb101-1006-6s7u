/**
 * 裂缝发展态势：拉取某条裂缝的全部测次，派生变化量序列、月均速率与分级结果。
 * 速率、变化量与等级只沿有效测次（未作废）计算；作废测次保留在序列中原值展示。
 * 被复测对比页与速率分级页消费。
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { liveQuery } from 'dexie'
import type { Survey, SurveyPoint } from '@/types/survey'
import type { AdviceLevel } from '@/types/advice'
import { db } from '@/utils/db'
import { buildSurveyPoints, latestEffectivePoint, latestRate, levelFromRate, totalDelta } from '@/utils/rate'

export interface UseCrackTrendResult {
  surveys: Ref<Survey[]>
  points: ComputedRef<SurveyPoint[]>
  /** 最新有效测次（作废测次不参与） */
  latest: ComputedRef<SurveyPoint | null>
  /** 最新有效测次的月均速率（mm/月） */
  rate: ComputedRef<number>
  /** 累计宽度变化量（mm，有效测次链） */
  delta: ComputedRef<number>
  /** 由速率推导的等级 */
  level: ComputedRef<AdviceLevel>
  /** 是否已发展（速率超过预警阈值） */
  warning: ComputedRef<boolean>
  /** 已作废测次数量 */
  voidedCount: ComputedRef<number>
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
      surveys.value = rows.sort((a, b) => a.seq - b.seq)
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
      (await db.surveys.where('crackId').equals(id).toArray()).sort((a, b) => a.seq - b.seq)
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

  const points = computed(() => buildSurveyPoints(surveys.value))
  const latest = computed(() => latestEffectivePoint(points.value))
  const rate = computed(() => latestRate(points.value))
  const delta = computed(() => totalDelta(points.value))
  const level = computed(() => levelFromRate(rate.value))
  const warning = computed(() => level.value !== '一般')
  const voidedCount = computed(() => points.value.filter((point) => point.voided).length)

  return {
    surveys,
    points,
    latest,
    rate,
    delta,
    level,
    warning,
    voidedCount,
    loading,
    error,
    reload: load
  }
}
