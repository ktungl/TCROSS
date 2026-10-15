import { resolveAttachmentUrl } from '../lib/attachments'
import type { FileMeta } from '../types'

/** 跟 package.json 的 pdfjs-dist 版本一致；中文 PDF 常用的 CJK 字型編碼需要這份 cMap 才解得出字。 */
const PDFJS_VERSION = '6.4.299'
const CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`

/** 單一檔案放進報告的文字上限，避免一份很長的 PDF 把 Excel 儲存格／Word 版面撐爆。 */
const MAX_TEXT_LENGTH = 3000

export function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf')
}

/** pdfjs 約 1MB，只有匯出時遇到 PDF 才載入，不放進主程式包。用 legacy build，同 pdfPages.ts（內含 polyfill，舊手機／Safari 也能跑）。 */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/** 擷取 PDF 的文字。掃描成圖片的 PDF 沒有文字層、或下載／解析失敗時回傳 null，
 * 由呼叫端改顯示檔名，不讓整份匯出失敗。 */
export async function extractPdfText(url: string, name = ''): Promise<string | null> {
  try {
    const pdfjs = await loadPdfjs()
    // GCS 附件要先換成簽名網址才下載得到
    const res = await fetch(await resolveAttachmentUrl(url, name))
    if (!res.ok) return null
    const data = await res.arrayBuffer()
    const task = pdfjs.getDocument({ data, cMapUrl: CMAP_URL, cMapPacked: true })
    const pdf = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        pageText += item.str
        if (item.hasEOL) pageText += '\n'
      }
      pages.push(pageText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    }
    await task.destroy()
    const text = pages.filter(Boolean).join('\n\n')
    if (!text) return null
    return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…（全文詳附件）` : text
  } catch {
    return null
  }
}

export interface AttachmentText {
  name: string
  /** PDF 擷取出的文字；非 PDF、掃描檔或解析失敗為 null */
  text: string | null
}

/** 依序解析附件；只有 PDF 會嘗試擷取文字，其他格式只帶檔名。已移到垃圾桶的不算。 */
export async function readAttachmentTexts(files: FileMeta[]): Promise<AttachmentText[]> {
  const active = files.filter((f) => !f.deletedAt)
  return Promise.all(
    active.map(async (f) => ({
      name: f.name,
      text: f.url && isPdf(f.name) ? await extractPdfText(f.url, f.name) : null,
    })),
  )
}

/** 給 Excel 儲存格這種只能放一段文字的地方：有文字就放文字（多檔以檔名分段），
 * 沒文字的檔案標示「詳附件」，完全沒附件回傳空字串。 */
export function attachmentTextsToPlain(items: AttachmentText[]): string {
  if (!items.length) return ''
  if (items.length === 1 && items[0].text) return items[0].text
  return items
    .map((it) => (it.text ? `〈${it.name}〉\n${it.text}` : `${it.name}（詳附件）`))
    .join('\n\n')
}
