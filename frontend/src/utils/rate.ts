/**
 * 裂缝发展速率计算与分级
 * 速率口径：相邻两次有效复测的宽度变化量 ÷ 间隔天数 × 30，单位 mm/月
 * 作废测次保留原值展示，但不进入速率链、变化量与预警计算（按最新有效测次取值）。
 */
import type { AdviceLevel } from '@/types/advice'
import { isSurveyEffective, type Survey, type SurveyPoint } from '@/types/survey'

/** 预警阈值：月均速率 ≥ 0.10 mm/月 记预警（较重及以上） */
export const RATE_WARNING = 0.1
/** 严重阈值：月均速率 ≥ 0.25 mm/月 */
export const RATE_SEVERE = 0.25

/** 四舍五入到指定小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 两个 YYYY-MM-DD 日期之间的天数（至少为 1，避免除零） */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`)
  const end = Date.parse(`${to}T00:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
  const days = Math.round((end - start) / 86400000)
  return days > 0 ? days : 1
}

/** 月均速率（mm/月） */
export function monthlyRate(deltaWidthMm: number, days: number): number {
  const span = days > 0 ? days : 1
  return round((deltaWidthMm / span) * 30, 3)
}

/** 由速率分级：< 0.10 一般，< 0.25 较重，≥ 0.25 严重 */
export function levelFromRate(rate: number): AdviceLevel {
  if (rate >= RATE_SEVERE) return '严重'
  if (rate >= RATE_WARNING) return '较重'
  return '一般'
}

/** 速率对应的 Element Plus 语义色 */
export function rateTone(rate: number): 'success' | 'warning' | 'danger' {
  const level = levelFromRate(rate)
  if (level === '严重') return 'danger'
  if (level === '较重') return 'warning'
  return 'success'
}

export const LEVEL_COLOR: Record<AdviceLevel, string> = {
  一般: '#1e8449',
  较重: '#d68910',
  严重: '#c0392b'
}

export const LEVEL_BG: Record<AdviceLevel, string> = {
  一般: '#eaf6ee',
  较重: '#fdf3e3',
  严重: '#fdecea'
}

/** Element Plus 图标组件名，供 <LevelTag> 动态渲染 */
export const LEVEL_ICON: Record<AdviceLevel, string> = {
  一般: 'SuccessFilled',
  较重: 'WarningFilled',
  严重: 'CircleCloseFilled'
}

export const LEVEL_WEIGHT: Record<AdviceLevel, number> = {
  一般: 10,
  较重: 20,
  严重: 30
}

/**
 * 把某条裂缝的全部测次整理成折线取点（按测次升序）。
 * 变化量与速率只沿「有效测次链」计算：作废测次跳过对比，保留原值取点但不参与聚合。
 */
export function buildSurveyPoints(surveys: Survey[]): SurveyPoint[] {
  const sorted = [...surveys].sort((a, b) => a.seq - b.seq)
  const points: SurveyPoint[] = []
  let previousEffective: Survey | null = null
  sorted.forEach((survey) => {
    const effective = isSurveyEffective(survey)
    const rawDelta = effective && previousEffective ? survey.widthMm - previousEffective.widthMm : 0
    const days = effective && previousEffective ? daysBetween(previousEffective.date, survey.date) : 1
    points.push({
      seq: survey.seq,
      date: survey.date,
      widthMm: survey.widthMm,
      lengthMm: survey.lengthMm,
      // 作废测次保留入库时的原始变化量；有效测次沿有效链重算
      deltaWidthMm: effective ? round(rawDelta, 2) : round(survey.deltaWidthMm, 2),
      rate: effective && previousEffective ? monthlyRate(rawDelta, days) : 0,
      voided: !effective
    })
    if (effective) previousEffective = survey
  })
  return points
}

/** 取点中的有效测次（未作废） */
export function effectivePoints(points: SurveyPoint[]): SurveyPoint[] {
  return points.filter((point) => !point.voided)
}

/** 最新有效测次 */
export function latestEffectivePoint(points: SurveyPoint[]): SurveyPoint | null {
  const effective = effectivePoints(points)
  return effective.length > 0 ? effective[effective.length - 1] : null
}

/** 最新有效测次的月均速率 */
export function latestRate(points: SurveyPoint[]): number {
  const latest = latestEffectivePoint(points)
  return latest ? latest.rate : 0
}

/** 累计宽度变化量（末次有效测次 - 首次有效测次） */
export function totalDelta(points: SurveyPoint[]): number {
  const effective = effectivePoints(points)
  if (effective.length < 2) return 0
  return round(effective[effective.length - 1].widthMm - effective[0].widthMm, 2)
}

/** 判定依据文案 */
export function basisText(rate: number, level: AdviceLevel): string {
  return `月均发展速率 ${formatRate(rate)}，按阈值分级判定为「${level}」（预警 ${RATE_WARNING} mm/月、严重 ${RATE_SEVERE} mm/月）`
}

/** 毫米格式化 */
export function formatMm(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return `${round(value, digits).toFixed(digits)} mm`
}

/** 速率格式化 */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—'
  return `${rate.toFixed(3)} mm/月`
}

/** 长度（mm → m）格式化 */
export function formatLengthMm(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} m` : `${round(value, 0)} mm`
}
