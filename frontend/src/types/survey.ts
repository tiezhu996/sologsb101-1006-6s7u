/** 复测：对同一条裂缝按测次追加的读数记录 */
export interface Survey {
  id: string
  crackId: string
  /** 测次序号，从 1 开始（按日期顺序编号，作废不回收序号） */
  seq: number
  /** 复测日期 YYYY-MM-DD */
  date: string
  widthMm: number
  lengthMm: number
  /** 与上一有效测次相比的宽度变化量（mm）；作废后冻结为作废时原值 */
  deltaWidthMm: number
  /** 复测人 */
  surveyor: string
  /** 是否作废：误录等原因作废后保留原值，但不参与台账宽度、变化量、速率与预警计算 */
  voided?: boolean
  /** 作废原因（作废时必填） */
  voidReason?: string
  /** 作废操作时间（ms 时间戳）；未作废为 0 */
  voidedAt?: number
  createdAt: number
  updatedAt: number
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

/** 判断测次是否已作废（兼容历史缺省行） */
export function isSurveyVoided(survey: Pick<Survey, 'voided'> | null | undefined): boolean {
  return survey?.voided === true
}

/** 单个测次在折线图上的取点 */
export interface SurveyPoint {
  id: string
  seq: number
  date: string
  widthMm: number
  lengthMm: number
  /** 复测人（明细展示用） */
  surveyor: string
  deltaWidthMm: number
  /** 该测次距上一有效测次的月均速率（mm/月）；作废点为 0 */
  rate: number
  /** 是否作废读数 */
  voided: boolean
  /** 作废原因 */
  voidReason?: string
}
