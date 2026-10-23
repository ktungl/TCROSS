import { resolveAttachmentUrl } from '../lib/attachments'
import type { FileMeta } from '../types'
import { isPdfFile } from './file'
import { openPdf } from './pdfjs'

/** 單一檔案放進報告的文字上限，避免一份很長的 PDF 把 Excel 儲存格／Word 版面撐爆。 */
const MAX_TEXT_LENGTH = 3000

/** 擷取 PDF 的文字。掃描成圖片的 PDF 沒有文字層、或下載／解析失敗時回傳 null，
 * 由呼叫端改顯示檔名，不讓整份匯出失敗。 */
export async function extractPdfText(url: string, name = ''): Promise<string | null> {
  try {
    // GCS 附件要先換成簽名網址才下載得到
    const res = await fetch(await resolveAttachmentUrl(url, name))
    if (!res.ok) return null
    const data = await res.arrayBuffer()
    const task = await openPdf(data)
    const pages: string[] = []
    // 解析到一半失敗也要釋放 worker 端的文件，同 pdfPages.ts
    try {
      const pdf = await task.promise
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
    } finally {
      await task.destroy()
    }
    const text = pages.filter(Boolean).join('\n\n')
    if (!text) return null
    return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…（全文詳附件）` : text
  } catch {
    return null
  }
}

interface AttachmentText {
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
      text: f.url && isPdfFile(f.name) ? await extractPdfText(f.url, f.name) : null,
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
