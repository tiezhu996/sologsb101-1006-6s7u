/**
 * 导出工具：整库 JSON 存档、裂缝台账 CSV、文本复制
 * 全部在浏览器本地完成，不经过任何服务端。
 */
import type { Section } from '@/types/section'
import type { Ring } from '@/types/ring'
import type { Crack, CrackState } from '@/types/crack'
import type { Survey } from '@/types/survey'
import type { Advice } from '@/types/advice'
import { formatMileage } from '@/types/section'
import { buildSurveyPoints, isAdviceStale, levelFromRate } from '@/utils/rate'

/** 触发浏览器下载 */
export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 时间戳文件名片段 */
export function stampSuffix(): string {
  const date = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/** 导出整库 JSON 存档，返回文件名 */
export function exportBackupJson(payload: unknown): string {
  const filename = `gbtunnelcrack-backup-${stampSuffix()}.json`
  download(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
  return filename
}

/** 导出裂缝台账 CSV（含所属区间/环片/最新速率/处置状态） */
export function exportCrackCsv(
  sections: Section[],
  rings: Ring[],
  cracks: Crack[],
  surveys: Survey[],
  advices: Advice[]
): string {
  const header = [
    '线路',
    '区间起里程',
    '区间止里程',
    '环号',
    '里程',
    '裂缝编号',
    '部位',
    '走向',
    '初测宽度(mm)',
    '初测长度(mm)',
    '状态',
    '有效测次数',
    '作废测次数',
    '最新有效宽度(mm)',
    '月均速率(mm/月)',
    '最新有效分级',
    '建议等级',
    '建议措施',
    '建议状态',
    '建议复核'
  ]
  const lines: string[] = [header.map(csvCell).join(',')]
  cracks.forEach((crack) => {
    const ring = rings.find((item) => item.id === crack.ringId)
    const section = sections.find((item) => item.id === crack.sectionId)
    const crackSurveys = surveys.filter((survey) => survey.crackId === crack.id)
    // buildSurveyPoints 默认只取有效测次：作废读数不进宽度、速率与预警
    const points = buildSurveyPoints(crackSurveys)
    const voidedCount = crackSurveys.filter((survey) => survey.voided === true).length
    const advice = advices.find((item) => item.crackId === crack.id)
    const latest = points.length > 0 ? points[points.length - 1] : null
    const currentLevel = latest ? levelFromRate(latest.rate) : '一般'
    lines.push(
      [
        section ? section.line : '—',
        section ? formatMileage(section.startMileage) : '—',
        section ? formatMileage(section.endMileage) : '—',
        ring ? ring.ringNo : '—',
        ring ? formatMileage(ring.mileage) : '—',
        crack.code,
        crack.position,
        crack.direction,
        points.length > 0 ? points[0].widthMm : crack.widthMm,
        crack.lengthMm,
        crack.state,
        points.length,
        voidedCount,
        latest ? latest.widthMm : crack.widthMm,
        latest ? latest.rate : 0,
        currentLevel,
        advice ? advice.level : '未分级',
        advice ? advice.measure : '—',
        advice ? advice.state : '—',
        advice && isAdviceStale(advice, currentLevel) ? '待复核' : ''
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `裂缝复测台账-${stampSuffix()}.csv`
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** CSV 单元格转义 */
export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 复制文本到剪贴板 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  return false
}

/** 状态中文文案（用于导出与提示） */
export const CRACK_STATE_TEXT: Record<CrackState, string> = {
  观察: '观察',
  待整治: '待整治',
  已整治: '已整治'
}
