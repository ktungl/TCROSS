import Parse from './parse'
import type { FolderKey } from '../types'

export interface SignedUrlResponse {
  uploadUrl: string
  objectPath: string
}

function baseUrl(): string {
  const url = import.meta.env.VITE_MIDDLEWARE_URL
  if (!url) throw new Error('尚未設定 VITE_MIDDLEWARE_URL')
  return url.replace(/\/$/, '')
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.detail === 'string' ? body.detail : fallback
  } catch {
    return fallback
  }
}

/** 一個 activityId 對多個檔案，只驗證一次 session／activity 存在，
 * 換取一批簽好的上傳網址——取代先前每個檔案各打一次 /signed-url 的作法。 */
export async function requestSignedUploadUrls(
  activityId: string,
  files: { folder: FolderKey; filename: string; contentType: string }[],
): Promise<SignedUrlResponse[]> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/signed-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ activityId, files }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法取得上傳網址'))
  const body = (await res.json()) as { files: SignedUrlResponse[] }
  return body.files
}

/** pdf：AI 報告的 PDF 版，objectPath 仍傳 resultFile（.docx）。 */
export async function requestDownloadUrl(objectPath: string, pdf = false): Promise<string> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/download-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectPath, pdf }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法取得下載網址'))
  const body = (await res.json()) as { downloadUrl: string }
  return body.downloadUrl
}

export async function deleteObjects(objectPaths: string[], activityId?: string): Promise<void> {
  if (!objectPaths.length) return
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/delete-objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectPaths, activityId }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法刪除素材檔案'))
}

/** 建立好 GenerationJob 後呼叫，觸發 Cloud Run 端的 Gemini 分析＋文件組裝（Phase 3b）。
 * Cloud Run 會在這個請求裡把整份報告做完才回應（這樣才能用按請求計費，不用常駐 CPU），
 * 呼叫端不該 await 它，結果透過 useGenerationJobPolling.ts 輪詢 GenerationJob.status 取得。
 * keepalive 讓使用者關掉頁面後請求仍能送達。 */
export async function triggerGeneration(jobId: string): Promise<void> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/generate/${jobId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法觸發自動生成'))
}

export function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  // 用 XHR 而非 fetch，才能取得上傳進度事件來驅動進度條。
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`檔案「${file.name}」上傳失敗`))
    }
    xhr.onerror = () => reject(new Error(`檔案「${file.name}」上傳失敗`))
    xhr.send(file)
  })
}

export type RewriteFormat = '新聞稿' | '社群文案' | '主管摘要'

export interface RewriteResult {
  format: RewriteFormat
  title: string
  paragraphs: string[]
  bullets: string[]
  hashtags: string[]
}

/** AI 改寫（doc/AI_UPGRADE_PLAN.md 1-1）：後端讀這場活動已建檔的資料，改寫成指定格式後直接回傳，
 * 只送文字、幾秒內完成，不建 GenerationJob。 */
export async function requestRewrite(activityId: string, format: RewriteFormat): Promise<RewriteResult> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/rewrite/${activityId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ format }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, 'AI 改寫失敗'))
  return (await res.json()) as RewriteResult
}

async function postAssist<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback))
  return (await res.json()) as T
}

interface AssistImagePayload {
  data: string
  mimeType: string
}

export interface SignInRow {
  page: number
  unit: string
  title: string
  name: string
  gender: '男' | '女' | ''
  uncertain: boolean
}

/** 簽到表辨識（doc/AI_UPGRADE_PLAN.md 1-2）：只回傳名單，寫入由使用者在對照畫面確認後才做。 */
export function assistSignIn(
  activityId: string,
  images: AssistImagePayload[],
): Promise<{ rows: SignInRow[]; notes: string }> {
  return postAssist('/assist/sign-in', { activityId, images }, '簽到表辨識失敗')
}

export interface PosterSuggestion {
  name: string
  date: string
  time: string
  timeEnd: string
  online: boolean
  place: string
  venue: string
  participantDesc: string
  attendees: string
  description: string
}

/** 海報辨識可以帶入的活動表單欄位 */
export type PosterField =
  | 'name' | 'date' | 'time' | 'timeEnd' | 'placeMode' | 'place' | 'venue' | 'participantDesc' | 'attendees'

/** 海報帶入（doc/AI_UPGRADE_PLAN.md 2-1）：today 是使用者當地日期，讓沒寫年份的日期補對年份。 */
export function assistPoster(image: AssistImagePayload, today: string): Promise<PosterSuggestion> {
  return postAssist('/assist/poster', { image, today }, '海報辨識失敗')
}

/** 分類／計畫推薦（doc/AI_UPGRADE_PLAN.md 2-2）：只會從現有清單挑選。 */
export function assistClassify(text: string): Promise<{ categories: string[]; planIds: string[]; reason: string }> {
  return postAssist('/assist/classify', { text }, '推薦失敗')
}

export interface DocumentCheckItem {
  category: '期限' | '預算' | '法規' | '其他'
  item: string
  source: string
}

export interface DocumentDigest {
  docType: string
  issuer: string
  docNumber: string
  subject: string
  summary: string
  keyPoints: string[]
  checkItems: DocumentCheckItem[]
  notes: string
}

/** 公文快讀（doc/AI_UPGRADE_PLAN.md 1-5）：PDF 原檔或縮過的圖片 → 重點摘要＋需人工核對清單，不存檔。 */
export function assistDocument(
  activityId: string,
  document: { data: string; mimeType: string },
): Promise<DocumentDigest> {
  return postAssist('/assist/document', { activityId, document }, '公文快讀失敗')
}
