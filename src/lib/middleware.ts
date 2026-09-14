import Parse from './parse'
import type { FolderKey } from '../types'

interface SignedUrlResponse {
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

export async function requestSignedUploadUrl(params: {
  activityId: string
  folder: FolderKey
  filename: string
  contentType: string
}): Promise<SignedUrlResponse> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/signed-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法取得上傳網址'))
  return res.json() as Promise<SignedUrlResponse>
}

export async function requestDownloadUrl(objectPath: string): Promise<string> {
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/download-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectPath }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法取得下載網址'))
  const body = (await res.json()) as { downloadUrl: string }
  return body.downloadUrl
}

export async function deleteObjects(objectPaths: string[]): Promise<void> {
  if (!objectPaths.length) return
  const token = Parse.User.current()?.getSessionToken()
  if (!token) throw new Error('請重新登入')
  const res = await fetch(`${baseUrl()}/delete-objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectPaths }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, '無法刪除素材檔案'))
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
