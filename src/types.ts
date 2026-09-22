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

/** 上傳檔案安全限制（ISO 27001 A.8.7 惡意軟體防護／A.8.28 安全程式設計）。
 * 這裡是擋執行檔類型＋大小上限的最後防線，實際的伺服器端強制在
 * cloud/main.js 的 beforeSave('Activity')；這裡只是讓使用者在前端就能
 * 得到即時錯誤訊息，不用等存檔失敗。 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'dll', 'ps1', 'psm1',
  'vbs', 'vbe', 'js', 'jse', 'jar', 'apk', 'sh', 'app', 'cpl', 'gadget',
  'pif', 'wsf', 'wsh', 'hta', 'lnk', 'reg',
]

/** 回傳不允許上傳的原因；允許則回傳 null。 */
export function fileUploadRejectionReason(file: { name: string; size: number }): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `「${file.name}」超過上傳大小上限（${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB）`
  }
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return `「${file.name}」的檔案類型不允許上傳`
  }
  return null
}

export type ActivityFiles = Record<AttachmentKey, FileMeta[]>

/** 活動分類的值本身就是使用者自訂的名稱字串（存在 Activity.categories 裡），
 * 分類清單由「分類管理」頁面維護（見 CategoryRecord），不再寫死成固定選項。 */
export type ActivityCategory = string

export interface CategoryRecord {
  id: string
  name: string
  /** 這個分類所屬的計畫（可複選，可留空）。留空代表不限計畫，任何計畫底下
   * 建活動都看得到；有指定的話，只有在活動表單選了對應計畫時才會出現在
   * 「活動分類」的可選清單裡。 */
  planIds: string[]
}

/** Category 集合（Parse class）首次為空時，用來建立起始選項的預設種子；
 * 建立後即可在「分類管理」頁面自由新增／改名／刪除，調整不會動到已存活動
 * 的 categories 欄位（那裡存的是分類名稱文字本身，不是參照 id）。 */
export const DEFAULT_CATEGORY_NAMES = ['居場所', '會務', '合作教育', '社區關懷', '其他']

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
  /** 活動分類（可複選） */
  categories: ActivityCategory[]
  /** 活動日期 */
  date: string
  /** 活動開始時間（HH:MM，選填） */
  time: string
  /** 活動結束時間（HH:MM，選填，同一時間可留空） */
  timeEnd: string
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
