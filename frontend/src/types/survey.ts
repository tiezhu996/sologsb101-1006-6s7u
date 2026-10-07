/** 复测：对同一条裂缝按测次追加的读数记录 */
export interface Survey {
  id: string
  crackId: string
  /** 测次序号，从 1 开始 */
  seq: number
  /** 复测日期 YYYY-MM-DD */
  date: string
  widthMm: number
  lengthMm: number
  /** 与上一次有效测次相比的宽度变化量（mm） */
  deltaWidthMm: number
  /** 复测人 */
  surveyor: string
  /** 是否已作废：作废后保留原值，但不参与台账宽度、变化量、速率与预警计算 */
  voided: boolean
  /** 作废原因（作废时必填，恢复时清空） */
  voidReason: string
  /** 作废时间戳；未作废为 null */
  voidedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 测次是否有效（未作废）；兼容旧数据缺省字段，按有效处理 */
export function isSurveyEffective(survey: { voided?: boolean }): boolean {
  return survey.voided !== true
}

export interface SurveyDraft {
  crackId: string
  date: string
  widthMm: number
  lengthMm: number
  surveyor: string
}

export const EMPTY_SURVEY_DRAFT: SurveyDraft = {
  crackId: '',
  date: '',
  widthMm: 0,
  lengthMm: 0,
  surveyor: ''
}

/** 单个测次在折线图上的取点 */
export interface SurveyPoint {
  seq: number
  date: string
  widthMm: number
  lengthMm: number
  deltaWidthMm: number
  /** 该测次距上一有效测次的月均速率（mm/月）；作废测次恒为 0 */
  rate: number
  /** 是否已作废：作废点不参与速率链与聚合，仅在图表/明细中原值展示 */
  voided: boolean
}
