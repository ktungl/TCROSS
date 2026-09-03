export interface Kpi {
  k: string
  v: string
  u: string
}

export interface FileMeta {
  name: string
  size: number
  url: string
  /** 圖說（照片類型必填每張圖說） */
  caption?: string
  /** 精選照片標記（作為大紀事精選照片） */
  featured?: boolean
}

/**
 * AI 自動生成素材上傳用的通用分類，對應 GCS 中介層 server/main.py 的
 * ALLOWED_FOLDERS，與下方「活動正式歸檔附件分類」是兩件事，勿混用。
 */
export type FolderKey = 'photo' | 'audio' | 'video' | 'doc'

export const FOLDERS: [FolderKey, string][] = [
  ['photo', '照片'],
  ['audio', '錄音'],
  ['video', '影片'],
  ['doc', '文件'],
]

/** 活動正式歸檔附件分類（需求訪談規格） */
export type AttachmentKey =
  | 'photo'
  | 'signIn'
  | 'record'
  | 'agenda'
  | 'document'
  | 'receipt'
  | 'social'
  | 'media'

export const ATTACHMENT_TYPES: [AttachmentKey, string][] = [
  ['photo', '活動照片'],
  ['signIn', '簽到表'],
  ['record', '成果紀錄'],
  ['agenda', '活動流程'],
  ['document', '公文'],
  ['receipt', '領據'],
  ['social', '社群貼文'],
  ['media', '影音檔'],
]

export const PHOTO_MIN = 3
export const PHOTO_MAX = 15

export type ActivityFiles = Record<AttachmentKey, FileMeta[]>

export const ACTIVITY_CATEGORIES = ['居場所', '會務', '合作教育', '社區關懷', '其他'] as const
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

export interface HeadcountStat {
  male: number
  female: number
  total: number
}

export interface PlanRecord {
  id: string
  name: string
}

export interface ActivityRecord {
  id: string
  /** 活動名稱／事由 */
  name: string
  /** 活動分類 */
  category: ActivityCategory | ''
  /** 活動起始日期 */
  date: string
  /** 活動迄止日期（同一天可留空） */
  dateEnd: string
  place: string
  /** 負責人（內部管理用） */
  owner: string
  /** 與會單位或成員 */
  attendees: string
  /** 參加對象說明 */
  participantDesc: string
  /** 與會人數統計（男性／女性／合計） */
  headcount: HeadcountStat
  plans: string[]
  /** 活動內容簡述與效益 */
  summary: string
  /** 備註 */
  remark: string
  kpis: Kpi[]
  files: ActivityFiles
}

export type GenerationJobKind = '成果報告' | '其他'
export type GenerationJobStatus = 'pending' | 'processing' | 'done' | 'error'

export interface GenerationJobRecord {
  id: string
  activityId: string
  kind: GenerationJobKind
  status: GenerationJobStatus
  sourceFiles: string[]
  resultFile: string
  errorMessage: string
  createdAt: string
}
