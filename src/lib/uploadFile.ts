import Parse from './parse'

export interface UploadedParseFile {
  name: string
  url: string
}

/** Parse JS SDK 的瀏覽器版 RESTController（node_modules/parse/lib/browser/RESTController.js）
 * 在檔案上傳有帶 progress callback、且伺服器回應沒有 Content-Length header 時，會先用
 * response.body.getReader() 鎖住 stream，又在同一個 response 物件呼叫 response.json()，
 * 導致「Failed to execute 'json' on 'Response': body stream is locked」而整個上傳失敗
 * （SDK 本身的 bug，8.6.0 版仍未修）。改用 XHR 直接打 Parse Server 的檔案上傳端點繞開這個
 * bug，同時維持原本的上傳進度回報。 */
export function uploadParseFile(
  filename: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedParseFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const serverUrl = (import.meta.env.VITE_PARSE_SERVER_URL as string).replace(/\/$/, '')
    xhr.open('POST', `${serverUrl}/files/${encodeURIComponent(filename)}`)
    xhr.setRequestHeader('X-Parse-Application-Id', import.meta.env.VITE_PARSE_APP_ID as string)
    xhr.setRequestHeader('X-Parse-Javascript-Key', import.meta.env.VITE_PARSE_JS_KEY as string)
    const token = Parse.User.current()?.getSessionToken()
    if (token) xhr.setRequestHeader('X-Parse-Session-Token', token)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedParseFile)
        } catch {
          reject(new Error(`檔案「${file.name}」上傳失敗（伺服器回應格式錯誤）`))
        }
      } else {
        let message = `檔案「${file.name}」上傳失敗`
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string }
          if (body?.error) message = body.error
        } catch {
          // 回應不是 JSON 就用預設訊息
        }
        reject(new Error(message))
      }
    }
    xhr.onerror = () => reject(new Error(`檔案「${file.name}」上傳失敗`))
    xhr.send(file)
  })
}
