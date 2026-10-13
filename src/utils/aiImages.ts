import type { FileMeta } from '../types'
import { resolveAttachmentUrl } from '../lib/attachments'
import { renderPdfPages } from './pdfPages'

/** 送進 AI 的圖片：base64（不含 data: 前綴）＋預覽用的 object URL（用完要 revoke）。 */
export interface AiImage {
  data: string
  mimeType: 'image/jpeg'
  previewUrl: string
}

/** 長邊上限：手寫簽到表要看得清楚小字，又不能讓請求太大（後端單張上限 5 MB） */
const MAX_SIDE = 2400

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取這張圖片（格式不支援或檔案損毀）'))
    }
    img.src = url
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 縮到長邊 MAX_SIDE 以內並轉成 JPEG（HEIC 等瀏覽器讀不了的格式會丟出錯誤）。 */
export async function prepareImageForAi(blob: Blob): Promise<AiImage> {
  const img = await loadImage(blob)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('瀏覽器無法處理圖片')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!jpeg) throw new Error('瀏覽器無法處理圖片')
  return { data: await blobToBase64(jpeg), mimeType: 'image/jpeg', previewUrl: URL.createObjectURL(jpeg) }
}

export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name.trim())
}

export function isImageName(name: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(name.trim())
}

/** 讀已上傳的附件（圖片或 PDF）轉成 AI 用的圖片；PDF 每頁一張，最多 maxPages 頁。 */
export async function loadAttachmentForAi(file: FileMeta, maxPages: number): Promise<AiImage[]> {
  const res = await fetch(await resolveAttachmentUrl(file.url, file.name))
  if (!res.ok) throw new Error(`無法下載「${file.name}」`)
  const blob = await res.blob()
  if (isPdfName(file.name)) {
    const pages = await renderPdfPages(await blob.arrayBuffer(), maxPages)
    return Promise.all(pages.map((p) => prepareImageForAi(new Blob([p.data], { type: 'image/jpeg' }))))
  }
  return [await prepareImageForAi(blob)]
}
