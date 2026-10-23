import Parse from './parse'
import { MAX_FILE_SIZE_BYTES } from '../types'
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

/** 被 Cloud Run 限流（429，每人每分鐘 30 次、以 60 秒滑動計算）時依序等這麼久再重試，合計超過 60 秒。
 * 429 是在處理請求前就擋下，重送不會重複執行。 */
const RATE_LIMIT_RETRY_DELAYS_MS = [3_000, 10_000, 20_000, 30_000]

/** 呼叫 Cloud Run 中介層的共用入口：帶 session token、429 自動重試、錯誤時拋出後端的 detail 訊息。 */
async function request(path: string, body: unknown, fallback: string, keepalive = false): Promise<Response> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const send = () =>
    fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    })
  let res = await send()
  for (const delay of RATE_LIMIT_RETRY_DELAYS_MS) {
    if (res.status !== 429) break
    await new Promise((r) => setTimeout(r, delay))
    res = await send()
  }
  if (!res.ok) {
    let message = fallback
    try {
      const err = await res.json()
      if (typeof err?.detail === 'string') message = err.detail
    } catch {
      // 回應不是 JSON 就用預設訊息
    }
    throw new Error(message)
  }
  return res
}

export async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return (await request(path, body, fallback)).json() as Promise<T>
}

/** 一個 activityId 對多個檔案，只驗證一次 session／activity 存在，
 * 換取一批簽好的上傳網址——取代先前每個檔案各打一次 /signed-url 的作法。 */
export async function requestSignedUploadUrls(
  activityId: string,
  files: { folder: FolderKey; filename: string; contentType: string; size: number }[],
): Promise<SignedUrlResponse[]> {
  const body = await postJson<{ files: SignedUrlResponse[] }>('/signed-url', { activityId, files }, '無法取得上傳網址')
  return body.files
}

/** pdf：AI 報告的 PDF 版，objectPath 仍傳 resultFile（.docx）。 */
export async function requestDownloadUrl(objectPath: string, pdf = false): Promise<string> {
  const body = await postJson<{ downloadUrl: string }>('/download-url', { objectPath, pdf }, '無法取得下載網址')
  return body.downloadUrl
}

export async function deleteObjects(objectPaths: string[], activityId?: string): Promise<void> {
  if (!objectPaths.length) return
  await request('/delete-objects', { objectPaths, activityId }, '無法刪除素材檔案')
}

/** 建立好 GenerationJob 後呼叫，觸發 Cloud Run 端的 Gemini 分析＋文件組裝（Phase 3b）。
 * Cloud Run 會在這個請求裡把整份報告做完才回應（這樣才能用按請求計費，不用常駐 CPU），
 * 呼叫端不該 await 它，結果透過 useGenerationJobPolling.ts 輪詢 GenerationJob.status 取得。
 * keepalive 讓使用者關掉頁面後請求仍能送達。 */
export async function triggerGeneration(jobId: string): Promise<void> {
  await request(`/generate/${jobId}`, undefined, '無法觸發自動生成', true)
}

/** 同時上傳的檔案數（活動附件與 AI 素材共用）。 */
export const UPLOAD_CONCURRENCY = 4

/** 單一檔案上傳上限，跟 server/main.py MAX_UPLOAD_BYTES 一致；簽在上傳網址裡，GCS 會實際擋下超過的檔案。 */
export const MAX_UPLOAD_BYTES = MAX_FILE_SIZE_BYTES

/** 用 XHR 而非 fetch，才能取得上傳進度。Content-Type 與 x-goog-content-length-range
 * 都簽在網址裡（/signed-url、/attachments/upload-urls 都是），必須原樣送出，否則 GCS 會回 403。 */
export function putToSignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('x-goog-content-length-range', `0,${MAX_UPLOAD_BYTES}`)
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
  return postJson<RewriteResult>(`/rewrite/${activityId}`, { format }, 'AI 改寫失敗')
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
  return postJson('/assist/sign-in', { activityId, images }, '簽到表辨識失敗')
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
  return postJson('/assist/poster', { image, today }, '海報辨識失敗')
}

/** 分類／計畫推薦（doc/AI_UPGRADE_PLAN.md 2-2）：只會從現有清單挑選。 */
export function assistClassify(text: string): Promise<{ categories: string[]; planIds: string[]; reason: string }> {
  return postJson('/assist/classify', { text }, '推薦失敗')
}

interface DocumentCheckItem {
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
  return postJson('/assist/document', { activityId, document }, '公文快讀失敗')
}
