import ExcelJS from 'exceljs'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  HeightRule,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityRecord, FileMeta } from '../types'
import { resolveAttachmentUrl } from '../lib/attachments'
import type { Participant } from './registration'
import { isAgendaReadable, readAgenda } from './agenda'
import { renderPdfPages } from './pdfPages'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const THIN_BORDER = {
  top: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  left: { style: 'thin' as const },
  right: { style: 'thin' as const },
}

export function downloadFile(name: string, text: string, type: 'text/csv' = 'text/csv'): void {
  downloadBlob(name, new Blob(['﻿' + text], { type: `${type};charset=utf-8` }))
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  // 沒掛進 DOM 的連結在部分瀏覽器會忽略 download 檔名
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 馬上 revoke 的話，部分瀏覽器（Safari／Firefox）在大檔案還沒開始存之前就會取消下載
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function buildCsv(rows: (string | number)[][]): string {
  const q = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return rows.map((row) => row.map(q).join(',')).join('\n')
}

export type GeneratedFormKind = '簽到表' | '領據' | '活動紀錄表' | '成果報告' | '公文'

export function generatedFormExtension(kind: GeneratedFormKind): 'xlsx' | 'docx' {
  return kind === '活動紀錄表' ? 'xlsx' : 'docx'
}

/** 開始～結束時間格式：09:00～10:30；沒填結束時間或跟開始時間一樣就只顯示開始時間。 */
function formatTimeRange(time: string, timeEnd: string): string {
  if (!time) return ''
  if (!timeEnd || timeEnd === time) return ` ${time}`
  return ` ${time}～${timeEnd}`
}

/** 領據、活動紀錄表開頭的活動資訊；日期跟其他產出文件一樣用民國年（114年1月3日）。 */
function activityInfoLines(a: ActivityRecord, planNames: string): string[] {
  const date = formatRocChinese(a.date) || a.date
  return [
    `活動名稱：${a.name}　日期：${date}${formatTimeRange(a.time, a.timeEnd)}`,
    `地點：${a.place}　負責人：${a.owner}`,
    `對應計畫：${planNames || '—'}`,
  ]
}

export type SignInLayout = 'detailed' | 'double'

/** 簽到表版型，對照場域實際使用的兩份範例：
 * - detailed：編號／單位／職稱／姓名／簽到，一頁 15 人（簽到表(1).docx）
 * - double：編號／姓名／簽到 左右兩欄，一頁 30 人（簽到表(2).docx） */
export const SIGN_IN_LAYOUTS: Record<SignInLayout, { label: string; perPage: number }> = {
  detailed: { label: '含單位、職稱（一頁 15 人）', perPage: 15 },
  double: { label: '姓名雙欄（一頁 30 人）', perPage: 30 },
}

const WEEKDAYS = '日一二三四五六'

/** 簽到表日期：114年10月20日(星期一) 09:00～12:00 */
function formatSignInDate(a: ActivityRecord): string {
  const roc = formatRocChinese(a.date)
  if (!roc) return ''
  const weekday = WEEKDAYS[new Date(`${a.date}T00:00:00`).getDay()]
  return `${roc}(星期${weekday})${formatTimeRange(a.time, a.timeEnd)}`
}

/** 簽到表 Word，格式比照場域範例：A4、邊界 2 公分、微軟正黑體；標題兩行（計畫名稱、
 * 活動名稱＋簽到表）、時間地點條列，表格標題列灰底、全部置中。人數多時每頁重複標題與表頭。 */
export async function buildSignInSheetDocx(
  a: ActivityRecord,
  opts: { titlePlans: string[]; layout: SignInLayout; participants?: Participant[] },
): Promise<Blob> {
  const FONT = '微軟正黑體'
  const { perPage } = SIGN_IN_LAYOUTS[opts.layout]
  const participants = opts.participants ?? []
  // 名單以外仍照活動人數留空白列，給現場報到的人
  const total = Math.max(a.headcount.total || 0, participants.length, 1)
  const pages = Math.ceil(total / perPage)

  const run = (text: string, extra: { bold?: boolean; size?: number } = {}) =>
    new TextRun({ text, font: FONT, bold: extra.bold, size: (extra.size ?? 12) * 2 })
  const centered = (text: string, extra: { bold?: boolean; size?: number; after?: number; pageBreakBefore?: boolean } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: extra.after ?? 0 },
      pageBreakBefore: extra.pageBreakBefore,
      children: [run(text, extra)],
    })

  const HEADER_SHADING = { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' }
  // 欄寬（twip），加總等於 A4 扣掉左右各 2 公分的版心寬度
  const columns =
    opts.layout === 'detailed'
      ? { headers: ['編號', '單位', '職稱', '姓名', '簽到'], widths: [710, 2970, 1840, 1700, 2418] }
      : { headers: ['編號', '姓名', '簽到', '編號', '姓名', '簽到'], widths: [710, 1695, 2415, 710, 1695, 2413] }
  const ROW_HEIGHT = 680 // 1.2 公分，留足手寫簽名空間
  const rowsOnPage = opts.layout === 'detailed' ? perPage : perPage / 2

  const cell = (text: string, width: number, header = false) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      shading: header ? HEADER_SHADING : undefined,
      children: [centered(text)],
    })

  const titleLines = [...(opts.titlePlans.length ? [opts.titlePlans.join('、')] : []), `${a.name} 簽到表`]
  const children: (Paragraph | Table)[] = []
  for (let page = 0; page < pages; page++) {
    const first = page * perPage
    titleLines.forEach((t, i) =>
      children.push(
        centered(t, {
          bold: true,
          size: 14,
          after: i === titleLines.length - 1 ? 120 : 0,
          // 人數超過一頁時，每頁都重複標題、時間地點與表頭
          pageBreakBefore: page > 0 && i === 0,
        }),
      ),
    )
    children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 0 }, children: [run(`時間：${formatSignInDate(a)}`)] }))
    children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 120 }, children: [run(`地點：${a.place}`)] }))

    const rows = [
      new TableRow({
        height: { value: 560, rule: HeightRule.ATLEAST },
        children: columns.headers.map((h, i) => cell(h, columns.widths[i], true)),
      }),
    ]
    for (let r = 0; r < rowsOnPage; r++) {
      const left = participants[first + r]
      const right = participants[first + rowsOnPage + r]
      const values =
        opts.layout === 'detailed'
          ? [String(first + r + 1), left?.unit ?? '', left?.title ?? '', left?.name ?? '', '']
          : [String(first + r + 1), left?.name ?? '', '', String(first + rowsOnPage + r + 1), right?.name ?? '', '']
      rows.push(
        new TableRow({
          height: { value: ROW_HEIGHT, rule: HeightRule.ATLEAST },
          children: values.map((v, i) => cell(v, columns.widths[i])),
        }),
      )
    }
    children.push(
      new Table({
        width: { size: columns.widths.reduce((x, y) => x + y, 0), type: WidthType.DXA },
        columnWidths: columns.widths,
        alignment: AlignmentType.CENTER,
        rows,
      }),
    )
  }

  const MARGIN = 1134 // 2 公分
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children,
      },
    ],
  })
  return Packer.toBlob(doc)
}

/** Excel 欄寬單位大致等同半形字元數；中文/全形字元約佔 2 個單位寬。用來估算
 * 折行後的實際行數，避免像「附件」這種一行塞很多項目的內容被固定行高擋住。 */
function estimateWrappedLines(text: string, columnWidthChars: number): number {
  let lines = 0
  for (const rawLine of text.split('\n')) {
    let width = 0
    for (const ch of rawLine) {
      width += /[　-鿿＀-￯]/.test(ch) ? 2 : 1
    }
    lines += Math.max(1, Math.ceil(width / columnWidthChars))
  }
  return Math.max(1, lines)
}

/** 內容需要的行數與版面設計的最少行數（例如空白欄位要留幾行手寫空間）取較大者，
 * 這樣文字較長時列高會跟著長，不會因固定行高被遮蔽；內容短或空白時仍保留設計的最小高度。 */
function rowHeightForWrappedText(text: string, columnWidthChars: number, minLines: number): number {
  // Excel 單行預設列高剛好等於 15pt 文字本身的高度，配上格線邊框後完全沒有留白，
  // 視覺上會顯得被夾住；多留一點緩衝，避免文字看起來貼著上下邊框。
  const LINE_HEIGHT_PT = 18
  const needed = text ? estimateWrappedLines(text, columnWidthChars) : minLines
  return Math.max(minLines, needed) * LINE_HEIGHT_PT
}

export async function buildActivityRecordXlsx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('活動紀錄表')
  sheet.columns = [{ width: 16 }, { width: 70 }]

  sheet.mergeCells('A1:B1')
  const title = sheet.getCell('A1')
  title.value = '活動紀錄表'
  title.font = { bold: true, size: 16 }
  title.alignment = { horizontal: 'center' }

  const infoLines = activityInfoLines(a, planNames)
  infoLines.forEach((line, i) => {
    const rowIdx = 2 + i
    sheet.mergeCells(`A${rowIdx}:B${rowIdx}`)
    sheet.getCell(`A${rowIdx}`).value = line
  })

  const startRow = 2 + infoLines.length + 1
  const fields: [string, string, number][] = [
    ['參與人數', `男性 ${a.headcount.male} 人、女性 ${a.headcount.female} 人，合計 ${a.headcount.total} 人`, 2],
    ['活動流程', '', 5],
    ['執行情形', a.summary, 5],
    ['檢討與建議', '', 5],
    ['附件', ATTACHMENT_TYPES.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0} 件`).join('　'), 2],
  ]
  fields.forEach(([label, value, heightLines], i) => {
    const rowIdx = startRow + i
    const labelCell = sheet.getCell(`A${rowIdx}`)
    labelCell.value = label
    labelCell.font = { bold: true }
    labelCell.border = THIN_BORDER
    const valueCell = sheet.getCell(`B${rowIdx}`)
    valueCell.value = value
    valueCell.alignment = { wrapText: true, vertical: 'top' }
    valueCell.border = THIN_BORDER
    sheet.getRow(rowIdx).height = rowHeightForWrappedText(value, 70, heightLines)
  })

  // 字型跟大事紀一致，不然 Excel 會用預設字型開啟
  sheet.eachRow((row) => row.eachCell((cell) => (cell.font = { ...cell.font, name: LEDGER_FONT.name })))

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
}

export async function buildReceiptDocx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const doc = new Document({
    // 字型跟其他產出文件一致；docx 預設的 Heading 1 是藍色，改成黑色粗體 16pt
    styles: {
      default: {
        document: { run: { font: REPORT_FONT, size: 24 } },
        heading1: { run: { font: REPORT_FONT, size: 32, bold: true, color: '000000' } },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({ text: '領據', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
          ...activityInfoLines(a, planNames).map((line) => new Paragraph({ text: line })),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: `茲收到　　　　　　　　　　撥付之「${a.name}」活動經費，金額新臺幣　　　　　　　　元整，特立此據。`,
          }),
          new Paragraph({ text: '', spacing: { after: 400 } }),
          new Paragraph({ text: '立據人（簽章）：　　　　　　　　　　　身分證字號：' }),
          new Paragraph({ text: '地址：' }),
          new Paragraph({ text: '日期：中華民國　　年　　月　　日' }),
        ],
      },
    ],
  })
  return Packer.toBlob(doc)
}

export type OfficialLetterPurpose = '邀請參加' | '檢送成果'

export interface OfficialLetterOptions {
  /** 發文機關全銜 */
  issuer: string
  /** 受文者 */
  recipient: string
  purpose: OfficialLetterPurpose
  /** 說明「依據」要寫的專案名稱（使用者在對話框勾選；空陣列就不寫這一條） */
  basisPlans: string[]
}

/** 公文（函）Word：依公文格式排好檔號、發文日期、字號、主旨、說明、正副本，
 * 主旨與說明由活動資料帶入，字號、發文日期等機關內部編號留白給承辦人填寫。 */
export async function buildOfficialLetterDocx(a: ActivityRecord, opts: OfficialLetterOptions): Promise<Blob> {
  const issuer = opts.issuer.trim() || '（發文機關全銜）'
  const recipient = opts.recipient.trim() || '（受文者）'
  const when = `${formatRocChinese(a.date) || '（日期）'}${formatTimeRange(a.time, a.timeEnd)}`
  const headcount = a.headcount.total ? `，參加人數計 ${a.headcount.total} 人` : ''
  const basis = opts.basisPlans.length ? `依據${opts.basisPlans.map((n) => `「${n}」`).join('、')}辦理。` : ''

  const subject =
    opts.purpose === '邀請參加'
      ? `本會訂於${when}假${a.place || '（地點）'}辦理「${a.name}」，敬邀　貴單位派員參加，請　查照。`
      : `檢送本會辦理「${a.name}」活動成果資料 1 份，請　查照。`
  const explanations =
    opts.purpose === '邀請參加'
      ? [
          basis,
          `活動時間：${when}。`,
          `活動地點：${a.place || '（地點）'}。`,
          a.participantDesc ? `參加對象：${a.participantDesc}。` : '',
          a.summary ? `活動內容：${a.summary}` : '',
          `聯絡人：${a.owner || '（聯絡人）'}。`,
        ]
      : [
          basis,
          `本會已於${when}假${a.place || '（地點）'}辦理旨揭活動${headcount}。`,
          a.summary ? `活動內容與效益：${a.summary}` : '',
          '檢附活動成果資料（含活動照片、簽到表）如附件。',
        ]
  const items = explanations.filter(Boolean)
  const toChineseNum = (n: number) => '一二三四五六七八九十'[n - 1] ?? String(n)

  const FONT = '標楷體'
  const line = (text: string, opts: { size?: number; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; indent?: number; after?: number } = {}) =>
    new Paragraph({
      alignment: opts.align,
      indent: opts.indent ? { left: opts.indent, hanging: opts.indent } : undefined,
      spacing: { after: opts.after ?? 60, line: 360 },
      children: [new TextRun({ text, font: FONT, size: (opts.size ?? 14) * 2, bold: opts.bold })],
    })

  const children: Paragraph[] = [
    line('檔　　號：', { size: 12, after: 0 }),
    line('保存年限：', { size: 12, after: 200 }),
    line(`${issuer}　函`, { size: 20, bold: true, align: AlignmentType.CENTER, after: 200 }),
    line('地址：', { size: 12, after: 0 }),
    line(`聯絡人：${a.owner}`, { size: 12, after: 0 }),
    line('電話：', { size: 12, after: 0 }),
    line('電子信箱：', { size: 12, after: 200 }),
    line(`受文者：${recipient}`, { size: 16, after: 120 }),
    line('發文日期：中華民國　　年　　月　　日', { size: 12, after: 0 }),
    line('發文字號：　　字第　　　　　　號', { size: 12, after: 0 }),
    line('速別：普通件', { size: 12, after: 0 }),
    line('密等及解密條件或保密期限：', { size: 12, after: 0 }),
    line(opts.purpose === '檢送成果' ? '附件：活動成果資料 1 份' : '附件：', { size: 12, after: 240 }),
    line(`主旨：${subject}`, { size: 16, indent: 960, after: 120 }),
    line('說明：', { size: 16, after: 0 }),
    ...items.map((t, i) => line(`${toChineseNum(i + 1)}、${t}`, { size: 16, indent: 640 })),
    line('', { after: 240 }),
    line(`正本：${recipient}`, { size: 12, after: 0 }),
    line(`副本：${issuer}`, { size: 12, after: 480 }),
    line('（機關首長署名）', { size: 20, align: AlignmentType.RIGHT }),
  ]

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

// ---------- 大事紀 Excel／內政部結案 Word（需求訪談欄位對照表） ----------

const ROC_EPOCH = 1911

function toRocParts(dateStr: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null
  return { y: Number(match[1]) - ROC_EPOCH, m: Number(match[2]), d: Number(match[3]) }
}

function formatRocCompact(dateStr: string): string {
  const p = toRocParts(dateStr)
  if (!p) return ''
  return `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`
}

/** 大事紀日期欄格式：1140103 */
export function formatLedgerDate(date: string): string {
  return formatRocCompact(date)
}

/** 內政部報告日期格式：114年1月3日 */
export function formatRocChinese(date: string): string {
  const start = toRocParts(date)
  if (!start) return ''
  return `${start.y}年${start.m}月${start.d}日`
}

function pickPhotosForExport(files: FileMeta[], max: number): FileMeta[] {
  const featured = files.filter((f) => f.featured)
  return (featured.length ? featured : files).slice(0, max)
}

function fileKindFromName(
  name: string,
): { docxType: 'jpg' | 'png' | 'gif' | 'bmp'; xlsxExt: 'jpeg' | 'png' | 'gif' } | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return { docxType: 'jpg', xlsxExt: 'jpeg' }
  if (ext === 'png') return { docxType: 'png', xlsxExt: 'png' }
  if (ext === 'gif') return { docxType: 'gif', xlsxExt: 'gif' }
  return null
}

function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: 1, height: 1 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('讀取圖片失敗'))
    reader.readAsDataURL(blob)
  })
}

/** docx／exceljs 都只認得 jpg/png/gif，手機截圖、Line 傳圖、瀏覽器另存常見的 webp（或其他
 * 瀏覽器看得懂但不在白名單裡的格式）會被上面的 fileKindFromName() 擋掉。這裡用瀏覽器內建
 * 的圖片解碼能力把它畫到 canvas 上再輸出成 PNG，而不是直接放棄不嵌入。 */
function convertToPng(blob: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      const width = img.naturalWidth || 1
      const height = img.naturalHeight || 1
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((pngBlob) => resolve(pngBlob ? { blob: pngBlob, width, height } : null), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

interface ImageAsset {
  dataUrl: string
  data: ArrayBuffer
  docxType: 'jpg' | 'png' | 'gif' | 'bmp'
  xlsxExt: 'jpeg' | 'png' | 'gif'
  width: number
  height: number
}

async function loadImageAsset(file: FileMeta): Promise<ImageAsset | null> {
  if (!file.url) return null
  try {
    const res = await fetch(await resolveAttachmentUrl(file.url, file.name))
    if (!res.ok) return null
    const originalBlob = await res.blob()
    const kind = fileKindFromName(file.name)
    if (kind) {
      const [dataUrl, data, dims] = await Promise.all([
        blobToDataUrl(originalBlob),
        originalBlob.arrayBuffer(),
        readImageDimensions(originalBlob),
      ])
      return { dataUrl, data, docxType: kind.docxType, xlsxExt: kind.xlsxExt, width: dims.width, height: dims.height }
    }
    const converted = await convertToPng(originalBlob)
    if (!converted) return null
    const [dataUrl, data] = await Promise.all([
      blobToDataUrl(converted.blob),
      converted.blob.arrayBuffer(),
    ])
    return { dataUrl, data, docxType: 'png', xlsxExt: 'png', width: converted.width, height: converted.height }
  } catch {
    return null
  }
}

function scaleToBox(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = Math.min(maxW / w, maxH / h, 1)
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) }
}

/** docx 的 ImageRun 尺寸以 96dpi 像素為單位。 */
const PX_PER_CM = 96 / 2.54

function cmToPx(cm: number): number {
  return Math.round(cm * PX_PER_CM)
}

const PHOTO_CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const PHOTO_TABLE_BORDERS = {
  top: PHOTO_CELL_BORDER,
  bottom: PHOTO_CELL_BORDER,
  left: PHOTO_CELL_BORDER,
  right: PHOTO_CELL_BORDER,
  insideHorizontal: PHOTO_CELL_BORDER,
  insideVertical: PHOTO_CELL_BORDER,
}

/** 成果報告書用字：微軟正黑體 12pt（比照《成果報告書範本》） */
const REPORT_FONT = '微軟正黑體'

/** 活動照片表格（比照範本）：固定 2 欄，照片列與圖說列交錯；照片統一高 5cm、寬度依原始
 * 比例縮放（上限 7.5cm，避免超出欄寬），圖說粗體置中。 */
function buildPhotoTable(photos: ImageAsset[], captions: string[]): Table {
  const targetHeight = cmToPx(5)
  const maxWidth = cmToPx(7.5)
  const COL = 4454 // twip，兩欄合計約等於版心寬

  const photoCell = (asset?: ImageAsset) => {
    let children: Paragraph[] = [new Paragraph({})]
    if (asset) {
      // 統一縮放到目標高度（不像其他匯出區塊只縮小不放大），讓表格裡的照片高度一致。
      const ratio = Math.min(targetHeight / asset.height, maxWidth / asset.width)
      const width = Math.max(1, Math.round(asset.width * ratio))
      const height = Math.max(1, Math.round(asset.height * ratio))
      children = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: asset.docxType, data: asset.data, transformation: { width, height } })],
        }),
      ]
    }
    return new TableCell({ width: { size: COL, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, children })
  }
  const captionCell = (text?: string) =>
    new TableCell({
      width: { size: COL, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: text ?? '', font: REPORT_FONT, size: 24, bold: true })],
        }),
      ],
    })

  const rows: TableRow[] = []
  for (let i = 0; i < photos.length; i += 2) {
    const pair = [i, i + 1].map((idx) => (idx < photos.length ? idx : -1))
    rows.push(new TableRow({ children: pair.map((idx) => photoCell(idx >= 0 ? photos[idx] : undefined)) }))
    rows.push(
      new TableRow({
        children: pair.map((idx) => captionCell(idx >= 0 ? captions[idx] || '（未填圖說）' : undefined)),
      }),
    )
  }

  return new Table({
    width: { size: COL * 2, type: WidthType.DXA },
    columnWidths: [COL, COL],
    indent: { size: 720, type: WidthType.DXA }, // 範本的照片表格往右縮排 1.27cm
    borders: PHOTO_TABLE_BORDERS,
    rows,
  })
}

export type LedgerPhotoSize = 'small' | 'medium' | 'large'

/** 大事紀精選照片的尺寸選項（每張照片框的寬×高，公分）。「標準」對應《114年大紀事_範例.xlsx》
 * 裡的照片大小。每一列的列高、照片欄的欄寬都由這裡推算，整份表格列高固定一致，照片一定落在
 * 格子內，不用匯出後再手動調版面。 */
export const LEDGER_PHOTO_SIZES: Record<LedgerPhotoSize, { label: string; widthCm: number; heightCm: number }> = {
  small: { label: '小（5 × 3.75 公分）', widthCm: 5, heightCm: 3.75 },
  medium: { label: '標準（6.7 × 5 公分，同範例）', widthCm: 6.67, heightCm: 5 },
  large: { label: '大（8 × 6 公分）', widthCm: 8, heightCm: 6 },
}

/** 每場活動最多放幾張精選照片（範例檔最多 3 張並排） */
export const LEDGER_MAX_PHOTOS = 3

/** 照片與格線之間的留白（px） */
const LEDGER_PHOTO_GAP_PX = 8
/** Excel 欄寬單位是「字元數」，以預設字型約 7px／字元＋5px 邊界換算 */
const excelColWidthToPx = (w: number) => Math.round(w * 7 + 5)
const pxToExcelColWidth = (px: number) => Math.ceil(((px - 5) / 7) * 100) / 100
/** 列高單位是 pt（1pt = 96/72 px） */
const pxToPt = (px: number) => Math.ceil(px * 0.75 * 10) / 10

const LEDGER_FONT = { name: '微軟正黑體', size: 12 }

/** 大事紀 Excel，格式比照《114年大紀事_範例.xlsx》：
 * 專案名稱／計畫項目／日期／地點／出席事由／與會單位或成員／備註／與會人數統計／精選照片 */
export async function buildLedgerXlsx(
  activities: ActivityRecord[],
  planName: (id: string) => string,
  options: { photoSize?: LedgerPhotoSize; photosPerRow?: number } = {},
): Promise<Blob> {
  const { photoSize = 'medium', photosPerRow = 1 } = options
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('大事紀', { views: [{ state: 'frozen', ySplit: 1, zoomScale: 70 }] })
  const headers = ['專案名稱', '計畫項目', '日期', '地點', '出席事由', '與會單位或成員', '備註', '與會人數統計', '精選照片']
  const CENTERED_COLS = new Set([3, 8])

  const box = LEDGER_PHOTO_SIZES[photoSize]
  const boxW = cmToPx(box.widthCm)
  const boxH = cmToPx(box.heightCm)
  const slots = Math.min(Math.max(1, photosPerRow), LEDGER_MAX_PHOTOS)
  // 比照範例：一張照片一個格子，「精選照片」依張數往右延伸成幾欄，每欄剛好放一張
  const photoColWidth = pxToExcelColWidth(boxW + LEDGER_PHOTO_GAP_PX * 2)
  const photoColPx = excelColWidthToPx(photoColWidth)
  const rowHeightPt = pxToPt(boxH + LEDGER_PHOTO_GAP_PX * 2)
  const rowHeightPx = rowHeightPt / 0.75

  sheet.columns = [
    { width: 16 },
    { width: 15 },
    { width: 12 },
    { width: 34 },
    { width: 23 },
    { width: 21 },
    { width: 15 },
    { width: 14.5 },
    ...Array.from({ length: slots }, () => ({ width: photoColWidth })),
  ]
  const PHOTO_COL = headers.length

  const headerRow = sheet.getRow(1)
  headerRow.height = 30
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = LEDGER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  if (slots > 1) sheet.mergeCells(1, PHOTO_COL, 1, PHOTO_COL + slots - 1)

  for (let i = 0; i < activities.length; i++) {
    const a = activities[i]
    const rowIdx = i + 2
    const row = sheet.getRow(rowIdx)
    const rocDate = formatLedgerDate(a.date)
    const values: (string | number)[] = [
      a.plans.map(planName).join('、'),
      a.categories.join('、'),
      // 範例檔的日期是數字（1140103），存數字才能在 Excel 裡直接排序／篩選
      rocDate ? Number(rocDate) : '',
      a.place,
      a.name,
      a.attendees,
      a.remark,
      a.headcount.total ? `${a.headcount.total}人` : '',
    ]
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font = LEDGER_FONT
      cell.alignment = {
        vertical: 'middle',
        horizontal: CENTERED_COLS.has(ci + 1) ? 'center' : undefined,
        wrapText: true,
      }
    })
    row.height = rowHeightPt

    const photos = pickPhotosForExport(a.files.photo ?? [], slots)
    const assets: ImageAsset[] = []
    for (const photo of photos) {
      const asset = await loadImageAsset(photo)
      if (asset) assets.push(asset)
    }
    // 照片由左到右各放一格（I、J、K…），每張在自己的格子裡置中。
    for (let pi = 0; pi < assets.length; pi++) {
      const asset = assets[pi]
      const { width, height } = scaleToBox(asset.width, asset.height, boxW, boxH)
      const offsetX = (photoColPx - width) / 2
      const offsetY = (rowHeightPx - height) / 2
      // 位移直接用 EMU 指定（1px = 9525 EMU）。不能用 tl 的小數欄列：ExcelJS 換算小數時
      // 是用「欄寬×10000」當一整格，比 Excel 實際格寬小很多，照片往右偏一點就會溢位
      // 跳到後面的欄位。ExcelJS 的 Anchor 本身支援 nativeCol/nativeColOff，只是型別沒寫。
      const tl = {
        nativeCol: PHOTO_COL - 1 + pi,
        nativeColOff: Math.round(offsetX * 9525),
        nativeRow: rowIdx - 1,
        nativeRowOff: Math.round(offsetY * 9525),
      }
      const imageId = workbook.addImage({ base64: asset.dataUrl, extension: asset.xlsxExt })
      sheet.addImage(imageId, {
        tl: tl as unknown as { col: number; row: number },
        ext: { width, height },
        editAs: 'oneCell',
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
}

/** 主辦單位全銜（成果報告書封面「主辦單位」） */
export const ORGANIZER_NAME = '社團法人臺灣合作社照顧聯盟'

const CHINESE_DIGITS = '〇一二三四五六七八九'
const LEGAL_DIGITS = ['', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾']

/** 1→一、12→十二、20→二十（成果報告書的活動編號最多就到幾十場） */
function toChineseNumber(n: number): string {
  if (n < 10) return CHINESE_DIGITS[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return `${tens === 1 ? '' : CHINESE_DIGITS[tens]}十${ones ? CHINESE_DIGITS[ones] : ''}`
}

/** 1→壹、11→拾壹、23→貳拾參 */
function toLegalNumber(n: number): string {
  if (n <= 10) return LEGAL_DIGITS[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return `${tens === 1 ? '' : LEGAL_DIGITS[tens]}拾${ones ? LEGAL_DIGITS[ones] : ''}`
}

/** 成果報告書日期：112年9月5日，星期二，11：00-16：00 */
function formatReportDate(a: ActivityRecord): string {
  const roc = formatRocChinese(a.date)
  if (!roc) return '（日期待補）'
  const weekday = WEEKDAYS[new Date(`${a.date}T00:00:00`).getDay()]
  const fw = (t: string) => t.replace(':', '：')
  const end = a.timeEnd && a.timeEnd !== a.time ? `-${fw(a.timeEnd)}` : ''
  const time = a.time ? `，${fw(a.time)}${end}` : ''
  return `${roc}，星期${weekday}${time}`
}

function reportText(text: string, extra: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, font: REPORT_FONT, size: (extra.size ?? 12) * 2, bold: extra.bold })
}

/** 「一、活動名稱：…」這類條列項目，換行後對齊在「、」後面 */
function reportItem(no: number, text: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    pageBreakBefore,
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: 991, hanging: 567 },
    children: [reportText(`${toChineseNumber(no)}、${text}`)],
  })
}

/** 條列項目底下的內文段落（對齊項目文字） */
function reportBody(text: string): Paragraph {
  return new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { left: 991 }, children: [reportText(text)] })
}

/** 活動流程裡的行程表，縮排對齊條列項目的內文；第一列當表頭加粗。 */
function buildAgendaTable(rows: string[][]): Table {
  const WIDTH = 8647 // A4 版心寬度扣掉內文縮排 991
  const cols = Math.max(...rows.map((r) => r.length))
  const colWidth = Math.floor(WIDTH / cols)
  return new Table({
    width: { size: colWidth * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colWidth),
    indent: { size: 991, type: WidthType.DXA },
    rows: rows.map(
      (r, ri) =>
        new TableRow({
          children: Array.from({ length: cols }, (_, ci) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              children: (r[ci] ?? '').split('\n').map((line) => new Paragraph({ children: [reportText(line, { bold: ri === 0 })] })),
            }),
          ),
        }),
    ),
  })
}

/** 單場活動的內容區塊（比照《成果報告書範本》）：
 * 一、活動名稱 二、活動日期 三、活動地點 四、參與人數 五、活動內容 六、活動效益 七、活動照片，
 * 再附上 八、活動流程表 九、簽到表 的原始檔（PDF／圖片逐頁嵌入）。
 * 活動內容取自「活動流程」附件的文字與行程表；活動效益是成果摘要加上 KPI。
 * 內政部成果報告書（多場活動彙整）跟單場活動的成果報告共用同一份內容格式。 */
async function buildActivityReportBlock(a: ActivityRecord): Promise<(Paragraph | Table)[]> {
  const hc = a.headcount
  const agenda = await readAgenda(a.files.agenda ?? [])
  const benefits = [
    ...(a.summary.trim() ? a.summary.trim().split(/\r?\n/).filter(Boolean).map(reportBody) : []),
    ...a.kpis.map((k) => reportBody(`${k.k}：${k.v}${k.u ? ` ${k.u}` : ''}`)),
  ]
  const children: (Paragraph | Table)[] = [
    reportItem(1, `活動名稱：${a.name}`),
    reportItem(2, `活動日期：${formatReportDate(a)}。`),
    reportItem(3, `活動地點：${a.place || '（地點待補）'}。`),
    reportItem(4, `參與人數：男${hc.male}人、女${hc.female}人，合計${hc.total}人。`),
    reportItem(5, '活動內容：'),
    ...(agenda.length
      ? agenda.map((b) => (b.type === 'text' ? reportBody(b.text) : buildAgendaTable(b.rows)))
      : [reportBody('（活動內容待補：請上傳 Word／Excel 格式的活動流程）')]),
    reportItem(6, '活動效益：'),
    ...(benefits.length ? benefits : [reportBody('（尚未填寫成果摘要與效益指標）')]),
  ]

  const photos = pickPhotosForExport(a.files.photo ?? [], 6)
  const photoAssets: ImageAsset[] = []
  const photoCaptions: string[] = []
  for (const photo of photos) {
    const asset = await loadImageAsset(photo)
    if (!asset) continue
    photoAssets.push(asset)
    photoCaptions.push(photo.caption || '')
  }
  // 範本的活動照片都從新的一頁開始，照片表格才不會被切到兩頁
  children.push(reportItem(7, '活動照片：', photoAssets.length > 0))
  children.push(photoAssets.length ? buildPhotoTable(photoAssets, photoCaptions) : reportBody('（尚未上傳活動照片）'))

  children.push(
    ...(await buildAttachmentSection(8, '活動流程表', a.files.agenda ?? [], {
      isInlined: isAgendaReadable,
      inlinedNote: '內容已整理於「五、活動內容」',
    })),
    ...(await buildAttachmentSection(9, '簽到表', a.files.signIn ?? [])),
  )
  return children
}

/** 每份附件最多嵌入幾頁，避免一份很長的 PDF 把報告撐到幾百 MB */
const MAX_ATTACHMENT_PAGES = 10
/** 附件頁面在報告裡的最大尺寸：A4 版心 17cm 寬，高度留一點給項目標題 */
const ATTACHMENT_MAX_WIDTH_CM = 16
const ATTACHMENT_MAX_HEIGHT_CM = 22

/** 把附件轉成可以嵌進 Word 的頁面圖片：圖片本身一張；PDF 每頁畫成一張。其他格式回傳 null。 */
async function loadAttachmentPages(file: FileMeta): Promise<ImageAsset[] | null> {
  const name = file.name.trim().toLowerCase()
  if (name.endsWith('.pdf')) {
    try {
      const res = await fetch(await resolveAttachmentUrl(file.url, file.name))
      if (!res.ok) return []
      const pages = await renderPdfPages(await res.arrayBuffer(), MAX_ATTACHMENT_PAGES)
      return pages.map((p) => ({ dataUrl: '', data: p.data, docxType: 'jpg', xlsxExt: 'jpeg', width: p.width, height: p.height }))
    } catch (err) {
      console.error(`轉換 PDF 失敗：${file.name}`, err)
      return []
    }
  }
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(name)) {
    const asset = await loadImageAsset(file)
    return asset ? [asset] : []
  }
  return null
}

/** 「八、活動流程表」「九、簽到表」：把掃描檔／照片／PDF 逐頁嵌入，一頁一張、從新的一頁開始。
 * Word／Excel 等嵌不進去的檔案列出檔名提醒另附；inlinedNote 是已經整理進報告其他段落的說明。 */
async function buildAttachmentSection(
  no: number,
  label: string,
  files: FileMeta[],
  opts: { isInlined?: (f: FileMeta) => boolean; inlinedNote?: string } = {},
): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [reportItem(no, `${label}：`, true)]
  if (!files.length) {
    children.push(reportBody(`（尚未上傳${label}）`))
    return children
  }
  const maxW = cmToPx(ATTACHMENT_MAX_WIDTH_CM)
  const maxH = cmToPx(ATTACHMENT_MAX_HEIGHT_CM)
  const inlined: string[] = []
  const skipped: string[] = []
  let embedded = 0
  for (const file of files) {
    const pages = await loadAttachmentPages(file)
    if (pages === null) {
      ;(opts.isInlined?.(file) ? inlined : skipped).push(file.name)
      continue
    }
    if (!pages.length) {
      skipped.push(file.name)
      continue
    }
    for (const page of pages) {
      const { width, height } = scaleToBox(page.width, page.height, maxW, maxH)
      children.push(
        new Paragraph({
          // 第一張接在項目標題底下，之後每張各自一頁
          pageBreakBefore: embedded > 0,
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: page.docxType, data: page.data, transformation: { width, height } })],
        }),
      )
      embedded++
    }
  }
  if (inlined.length && opts.inlinedNote) children.push(reportBody(`（${inlined.join('、')}：${opts.inlinedNote}）`))
  if (skipped.length) children.push(reportBody(`（以下檔案無法嵌入報告，請另行附上：${skipped.join('、')}）`))
  return children
}

/** 「壹、活動一」這類大標題；用 Heading 1 樣式，目錄才抓得到 */
function reportHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    indent: { left: 567, hanging: 567 },
    children: [reportText(text, { bold: true })],
  })
}

// 覆寫 docx 套件內建的 Heading 1（預設是藍色 16pt），改成範本的黑色 12pt 粗體、段前段後各 9pt
const REPORT_STYLES = {
  default: {
    document: { run: { font: REPORT_FONT, size: 24 } },
    heading1: {
      run: { font: REPORT_FONT, size: 24, bold: true, color: '000000' },
      paragraph: { keepNext: true, spacing: { before: 180, after: 180, line: 240 } },
    },
  },
}

const A4_PAGE = {
  size: { width: 11906, height: 16838 },
  margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
}

function todayRocChinese(): string {
  const d = new Date()
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return formatRocChinese(iso)
}

/** 內政部成果報告書 Word（比照《成果報告書範本》）：封面（計畫名稱／活動成果報告書／指導單位／
 * 主辦單位／日期）→ 目錄 → 每場活動一章（壹、活動一…）→ 計畫整體效益，內文頁尾有頁碼。
 * 目錄是 Word 欄位，開檔時 Word 會詢問是否更新欄位，按「是」就會帶出頁碼。 */
export async function buildNeimuReportDocx(activities: ActivityRecord[], planScopeLabel: string): Promise<Blob> {
  // 封面各段之間的留白，比照範本用空白行撐開的高度（範本：標題前 2 行、兩標題間 1 行、
  // 指導單位前 8 行、日期前 5 行，一行約 18.5pt）
  const cover: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 740, after: 530 },
      children: [reportText(planScopeLabel, { bold: true, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 2960 },
      children: [reportText('活動成果報告書', { bold: true, size: 24 })],
    }),
    new Paragraph({ children: [reportText('指導單位：內政部', { bold: true, size: 16 })] }),
    new Paragraph({
      spacing: { after: 1900 },
      children: [reportText(`主辦單位：${ORGANIZER_NAME}`, { bold: true, size: 16 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [reportText(`中華民國${todayRocChinese()}`, { bold: true, size: 16 })],
    }),
  ]

  const body: (Paragraph | Table | TableOfContents)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
      children: [reportText('目　　錄', { size: 20 })],
    }),
    new TableOfContents('目錄', { hyperlink: true, headingStyleRange: '1-1' }),
  ]
  for (let i = 0; i < activities.length; i++) {
    body.push(reportHeading(`${toLegalNumber(i + 1)}、活動${toChineseNumber(i + 1)}`))
    body.push(...(await buildActivityReportBlock(activities[i])))
  }
  body.push(reportHeading(`${toLegalNumber(activities.length + 1)}、計畫整體效益`))
  body.push(reportBody('（請填寫計畫整體效益）'))

  const pageNumberFooter = new Footer({
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] }),
    ],
  })

  const doc = new Document({
    features: { updateFields: true },
    styles: REPORT_STYLES,
    sections: [
      { properties: { page: A4_PAGE }, children: cover },
      {
        properties: { page: { ...A4_PAGE, pageNumbers: { start: 1 } } },
        footers: { default: pageNumberFooter },
        children: body,
      },
    ],
  })
  return Packer.toBlob(doc)
}

/** 成果報告 Word：單場活動版，內容格式同成果報告書的一章，資料完全來自使用者手動填寫的欄位
 * （摘要／KPI／照片圖說），不經過 AI 生成，跟活動詳情頁的「儲存成果」表單資料一一對應。 */
export async function buildResultReportDocx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [reportText('活動成果報告', { bold: true, size: 20 })],
    }),
    ...(planNames
      ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [reportText(planNames)] })]
      : []),
    ...(await buildActivityReportBlock(a)),
  ]
  const doc = new Document({ styles: REPORT_STYLES, sections: [{ properties: { page: A4_PAGE }, children }] })
  return Packer.toBlob(doc)
}
