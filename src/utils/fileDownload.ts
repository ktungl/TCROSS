import JSZip from 'jszip'
import { downloadBlob } from './download'
import { resolveAttachmentUrl } from '../lib/attachments'

export interface DownloadItem {
  /** 原始檔名（FileMeta.name），Parse 檔案網址上的檔名有加時間戳記前綴，不拿來用 */
  name: string
  url: string
  /** 壓縮檔裡的資料夾路徑，例如「活動名稱/活動照片」；單檔下載時不用 */
  folder?: string
}

export interface DownloadResult {
  /** 抓不到的檔案名稱（網址失效、網路中斷），其他檔案照樣下載 */
  failed: string[]
}

/** 同時下載的檔案數，太多會讓手機或慢網路卡住 */
const FETCH_CONCURRENCY = 4

/** Windows／macOS 檔名不能用的字元換成全形底線 */
function safePathPart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '＿').replace(/[.\s]+$/, '').trim() || '未命名'
}

async function fetchBlob(url: string, name: string): Promise<Blob> {
  const res = await fetch(await resolveAttachmentUrl(url, name))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

/** 同一個資料夾裡撞名時加上（2）、（3），避免後面的檔案蓋掉前面的 */
function uniquePath(used: Set<string>, folder: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let path = folder ? `${folder}/${name}` : name
  for (let n = 2; used.has(path.toLowerCase()); n++) {
    path = `${folder ? `${folder}/` : ''}${base}（${n}）${ext}`
  }
  used.add(path.toLowerCase())
  return path
}

/** 一個檔案直接用原始檔名下載；多個檔案打包成 zip（依 folder 分資料夾）。
 * 照片／影片本身已經壓縮過，zip 只打包不再壓縮，大量檔案也不會卡很久。 */
export async function downloadFiles(
  items: DownloadItem[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<DownloadResult> {
  if (!items.length) return { failed: [] }
  if (items.length === 1) {
    const [item] = items
    downloadBlob(safePathPart(item.name), await fetchBlob(item.url, item.name))
    onProgress?.(1, 1)
    return { failed: [] }
  }

  const zip = new JSZip()
  const used = new Set<string>()
  const paths = items.map((item) =>
    uniquePath(used, (item.folder ?? '').split('/').map(safePathPart).filter(Boolean).join('/'), safePathPart(item.name)),
  )
  const failed: string[] = []
  let cursor = 0
  let done = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      try {
        zip.file(paths[i], await fetchBlob(items[i].url, items[i].name))
      } catch (err) {
        console.error(`下載失敗：${items[i].name}`, err)
        failed.push(items[i].name)
      }
      onProgress?.(++done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, worker))
  if (failed.length === items.length) throw new Error('檔案都下載失敗，請檢查網路後再試一次')
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  downloadBlob(`${safePathPart(zipName)}.zip`, blob)
  return { failed }
}

/** 今天日期 YYYYMMDD，放進壓縮檔名 */
export function todayStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
