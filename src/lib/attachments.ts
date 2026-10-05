import { reactive, ref } from 'vue'
import Parse from './parse'
import type { AttachmentKey } from '../types'

/** 活動附件存在 GCS（Cloud Run 中介層簽發的臨時網址上傳／讀取）。FileMeta.url 存成
 * 「gcs:attachments/…」，跟 10 月前上傳到 Back4App 的舊附件（https://parsefiles.back4app.com/…）
 * 區分；舊網址照舊直接使用，新舊可以並存在同一個活動裡。 */
export const GCS_URL_PREFIX = 'gcs:'

export function isGcsUrl(url: string | undefined): url is string {
  return !!url && url.startsWith(GCS_URL_PREFIX)
}

function baseUrl(): string {
  const url = import.meta.env.VITE_MIDDLEWARE_URL
  if (!url) throw new Error('尚未設定 VITE_MIDDLEWARE_URL')
  return url.replace(/\/$/, '')
}

async function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
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
  return res.json() as Promise<T>
}

// ── 上傳 ──────────────────────────────────────────────

/** 跟 server/main.py MAX_ATTACHMENT_BYTES 一致；簽在上傳網址裡，GCS 會實際擋下超過的檔案。 */
const MAX_BYTES = 50 * 1024 * 1024
const UPLOAD_URL_BATCH = 50

/** 一次換一批上傳網址（Cloud Run 一個請求最多 50 個），回傳與 files 同順序。 */
export async function requestAttachmentUploadUrls(
  activityId: string,
  folder: AttachmentKey,
  files: File[],
): Promise<{ uploadUrl: string; url: string }[]> {
  const out: { uploadUrl: string; url: string }[] = []
  for (let i = 0; i < files.length; i += UPLOAD_URL_BATCH) {
    const batch = files.slice(i, i + UPLOAD_URL_BATCH)
    const body = await post<{ files: { uploadUrl: string; url: string }[] }>(
      '/attachments/upload-urls',
      {
        activityId,
        folder,
        files: batch.map((f) => ({ filename: f.name, contentType: contentTypeOf(f), size: f.size })),
      },
      '無法取得上傳網址',
    )
    out.push(...body.files)
  }
  return out
}

export function contentTypeOf(file: File): string {
  return file.type || 'application/octet-stream'
}

/** 用 XHR 而非 fetch，才能取得上傳進度。Content-Type 與 x-goog-content-length-range
 * 都簽在網址裡，必須原樣送出，否則 GCS 會回 403。 */
export function putAttachment(
  uploadUrl: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentTypeOf(file))
    xhr.setRequestHeader('x-goog-content-length-range', `0,${MAX_BYTES}`)
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

// ── 讀取（臨時網址）─────────────────────────────────────

/** Cloud Run 簽的網址 15 分鐘到期，提早 3 分鐘換新，避免畫面上拿到快過期的網址。 */
const VIEW_URL_TTL_MS = 12 * 60 * 1000
const VIEW_URL_BATCH = 300

interface CachedUrl {
  url: string
  expiresAt: number
}

/** key 是 FileMeta.url（gcs:…）＋檔名；同一個檔案在不同畫面共用同一份快取。 */
const cache = reactive(new Map<string, CachedUrl>())
const pending = new Map<string, { path: string; name: string }>()
const waiters: { resolve: () => void; reject: (e: unknown) => void }[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 每分鐘跳一次，讓 attachmentSrc() 在網址快到期時重新計算、觸發換新。 */
const now = ref(Date.now())
setInterval(() => (now.value = Date.now()), 60 * 1000)

const keyOf = (url: string, name: string) => `${url}\n${name}`

function fresh(key: string): CachedUrl | undefined {
  const hit = cache.get(key)
  return hit && hit.expiresAt > now.value ? hit : undefined
}

function enqueue(url: string, name: string) {
  const key = keyOf(url, name)
  if (pending.has(key)) return
  pending.set(key, { path: url.slice(GCS_URL_PREFIX.length), name })
  // 同一輪渲染裡的所有圖片併成一次請求（Cloud Run 每人每分鐘 30 次限流）
  flushTimer ??= setTimeout(flush, 30)
}

async function flush() {
  flushTimer = null
  const entries = [...pending.entries()]
  pending.clear()
  const batchWaiters = waiters.splice(0)
  try {
    for (let i = 0; i < entries.length; i += VIEW_URL_BATCH) {
      const batch = entries.slice(i, i + VIEW_URL_BATCH)
      const body = await post<{ urls: Record<string, string> }>(
        '/attachments/view-urls',
        { items: batch.map(([, v]) => ({ path: v.path, name: v.name })) },
        '無法取得附件網址',
      )
      const expiresAt = Date.now() + VIEW_URL_TTL_MS
      for (const [key, v] of batch) {
        const signed = body.urls[v.path]
        if (signed) cache.set(key, { url: signed, expiresAt })
      }
    }
    batchWaiters.forEach((w) => w.resolve())
  } catch (e) {
    batchWaiters.forEach((w) => w.reject(e))
  }
}

/** 給模板用（<img :src>、<a :href>）：舊網址原樣回傳；gcs: 網址回傳快取的臨時網址，
 * 還沒有就先回空字串並排入批次換網址，換好後畫面會自動更新。 */
export function attachmentSrc(url: string | undefined, name = ''): string {
  if (!url) return ''
  if (!isGcsUrl(url)) return url
  const hit = fresh(keyOf(url, name))
  if (!hit) enqueue(url, name)
  return hit?.url ?? cache.get(keyOf(url, name))?.url ?? ''
}

/** 給程式用（匯出時 fetch 照片）：等到拿到可用的網址才回傳。 */
export async function resolveAttachmentUrl(url: string, name = ''): Promise<string> {
  if (!isGcsUrl(url)) return url
  const key = keyOf(url, name)
  const hit = fresh(key)
  if (hit) return hit.url
  await new Promise<void>((resolve, reject) => {
    enqueue(url, name)
    waiters.push({ resolve, reject })
  })
  const got = cache.get(key)
  if (!got) throw new Error(`無法取得附件「${name || url}」`)
  return got.url
}

// ── 刪除 ──────────────────────────────────────────────

/** 從活動拿掉附件後呼叫：Cloud Run 只會刪掉已經沒有任何活動引用的檔案（同一檔案掛在
 * 別的活動、或還在某個垃圾桶裡就保留）。舊的 Back4App 附件不經過這裡，由 Cloud Code 處理。 */
export async function deleteUnreferencedAttachments(urls: string[]): Promise<void> {
  const paths = urls.filter(isGcsUrl).map((u) => u.slice(GCS_URL_PREFIX.length))
  if (!paths.length) return
  await post('/attachments/delete', { paths }, '無法刪除附件檔案')
}
