import ExcelJS from 'exceljs'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityRecord, FileMeta } from '../types'

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
  link.click()
  URL.revokeObjectURL(url)
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

function activityInfoLines(a: ActivityRecord, planNames: string): string[] {
  return [
    `活動名稱：${a.name}　日期：${a.date}${formatTimeRange(a.time, a.timeEnd)}`,
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
  opts: { titlePlans: string[]; layout: SignInLayout },
): Promise<Blob> {
  const FONT = '微軟正黑體'
  const { perPage } = SIGN_IN_LAYOUTS[opts.layout]
  const total = Math.max(a.headcount.total || 0, 1)
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
      const values =
        opts.layout === 'detailed'
          ? [String(first + r + 1), '', '', '', '']
          : [String(first + r + 1), '', '', String(first + rowsOnPage + r + 1), '', '']
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

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
}

export async function buildReceiptDocx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const doc = new Document({
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

// ---------- 大紀事 Excel／內政部結案 Word（需求訪談欄位對照表） ----------

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

/** 大紀事日期欄格式：1140103 */
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
    const res = await fetch(file.url)
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

const PHOTO_CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
const PHOTO_CELL_BORDERS = {
  top: PHOTO_CELL_BORDER,
  bottom: PHOTO_CELL_BORDER,
  left: PHOTO_CELL_BORDER,
  right: PHOTO_CELL_BORDER,
}
const PHOTO_TABLE_BORDERS = {
  ...PHOTO_CELL_BORDERS,
  insideHorizontal: PHOTO_CELL_BORDER,
  insideVertical: PHOTO_CELL_BORDER,
}

/** 活動照片表格：固定 2 欄，照片統一高 5cm、寬度依原始比例縮放，每格加細框線。 */
function buildPhotoTable(photos: ImageAsset[], captions: string[]): Table {
  const PHOTO_HEIGHT_CM = 5
  const targetHeight = cmToPx(PHOTO_HEIGHT_CM)
  const maxWidth = cmToPx(8) // 兩欄並排時單張照片的寬度上限，避免超版面

  const cells = photos.map((asset, i) => {
    // 統一縮放到目標高度（不像其他匯出區塊只縮小不放大），讓表格裡的照片高度一致。
    const scaleRatio = targetHeight / asset.height
    let width = Math.max(1, Math.round(asset.width * scaleRatio))
    let height = Math.max(1, Math.round(asset.height * scaleRatio))
    if (width > maxWidth) {
      const extra = maxWidth / width
      width = Math.round(width * extra)
      height = Math.round(height * extra)
    }
    return new TableCell({
      borders: PHOTO_CELL_BORDERS,
      width: { size: 50, type: WidthType.PERCENTAGE },
      children: [
        new Paragraph({
          children: [new ImageRun({ type: asset.docxType, data: asset.data, transformation: { width, height } })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          text: captions[i] || '（未填圖說）',
          alignment: AlignmentType.CENTER,
          border: { top: PHOTO_CELL_BORDER },
          spacing: { before: 60 },
        }),
      ],
    })
  })

  const rows: TableRow[] = []
  for (let i = 0; i < cells.length; i += 2) {
    const rowCells = cells.slice(i, i + 2)
    if (rowCells.length === 1) {
      rowCells.push(new TableCell({ borders: PHOTO_CELL_BORDERS, width: { size: 50, type: WidthType.PERCENTAGE }, children: [] }))
    }
    rows.push(new TableRow({ children: rowCells }))
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: PHOTO_TABLE_BORDERS, rows })
}

export type LedgerPhotoSize = 'small' | 'medium' | 'large'

/** 大紀事精選照片的尺寸選項（每張照片框的寬×高，公分）。「標準」對應《114年大紀事_範例.xlsx》
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

/** 大紀事 Excel，格式比照《114年大紀事_範例.xlsx》：
 * 專案名稱／計畫項目／日期／地點／出席事由／與會單位或成員／備註／與會人數統計／精選照片 */
export async function buildLedgerXlsx(
  activities: ActivityRecord[],
  planName: (id: string) => string,
  options: { photoSize?: LedgerPhotoSize; photosPerRow?: number } = {},
): Promise<Blob> {
  const { photoSize = 'medium', photosPerRow = 1 } = options
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('大紀事', { views: [{ state: 'frozen', ySplit: 1, zoomScale: 70 }] })
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

/** 單場活動的內容區塊：活動內容／照片／簽到表／日期／地點／參加對象及人數／效益。
 * 內政部結案報告（多場活動彙整）跟單場活動的成果報告共用同一份內容格式。 */
async function buildActivityReportBlock(a: ActivityRecord): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({ text: '二、活動內容', spacing: { before: 100 } }))
  children.push(new Paragraph({ text: a.summary || '（活動內容待補）' }))

  const photos = pickPhotosForExport(a.files.photo ?? [], 6)
  const photoAssets: ImageAsset[] = []
  const photoCaptions: string[] = []
  for (const photo of photos) {
    const asset = await loadImageAsset(photo)
    if (!asset) continue
    photoAssets.push(asset)
    photoCaptions.push(photo.caption || '')
  }
  if (photoAssets.length) {
    children.push(buildPhotoTable(photoAssets, photoCaptions))
  }

  const signInFiles = a.files.signIn ?? []
  children.push(
    new Paragraph({
      text: `簽到表：${signInFiles.length ? `${signInFiles.map((f) => f.name).join('、')}（詳附件）` : '未附'}`,
      spacing: { before: 120 },
    }),
  )

  children.push(
    new Paragraph({
      text: `三、活動日期：${formatRocChinese(a.date)}${formatTimeRange(a.time, a.timeEnd)}`,
      spacing: { before: 120 },
    }),
  )
  children.push(new Paragraph({ text: `四、活動地點：${a.place}` }))
  children.push(
    new Paragraph({
      text: `五、參加對象及人數：${a.participantDesc || '—'}；男性 ${a.headcount.male} 人、女性 ${a.headcount.female} 人，合計 ${a.headcount.total} 人`,
    }),
  )

  children.push(new Paragraph({ text: '六、活動效益', spacing: { before: 100 } }))
  if (a.kpis.length) {
    const headerRow = new TableRow({
      children: ['指標', '數值'].map(
        (t) => new TableCell({ children: [new Paragraph({ text: t, alignment: AlignmentType.CENTER })] }),
      ),
    })
    const rows = a.kpis.map(
      (k) =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(k.k)] }),
            new TableCell({ children: [new Paragraph(`${k.v} ${k.u}`)] }),
          ],
        }),
    )
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }))
  } else {
    children.push(new Paragraph({ text: '（尚未填寫效益指標）' }))
  }
  if (a.remark) children.push(new Paragraph({ text: `備註：${a.remark}` }))

  return children
}

/** 內政部經常門結案報告 Word：計畫名稱／活動內容／活動日期／活動地點／參加對象及人數／活動效益 */
export async function buildNeimuReportDocx(
  activities: ActivityRecord[],
  planScopeLabel: string,
): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: '內政部經常門結案報告', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: `一、計畫名稱：${planScopeLabel}`, spacing: { after: 100 } }),
    new Paragraph({ text: `共 ${activities.length} 場活動`, spacing: { after: 300 } }),
  ]

  for (let i = 0; i < activities.length; i++) {
    const a = activities[i]
    children.push(new Paragraph({ text: `${i + 1}. ${a.name}`, heading: HeadingLevel.HEADING_2 }))
    children.push(...(await buildActivityReportBlock(a)))
    children.push(new Paragraph({ text: '', spacing: { after: 400 } }))
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

/** 成果報告 Word：單場活動版，資料完全來自使用者手動填寫的欄位（摘要／KPI／照片圖說），
 * 不經過 AI 生成，跟活動詳情頁的「儲存成果」表單資料一一對應。 */
export async function buildResultReportDocx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: '成果報告', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: `活動名稱：${a.name}`, spacing: { after: 60 } }),
    new Paragraph({ text: `一、對應計畫：${planNames || '—'}`, spacing: { after: 200 } }),
  ]
  children.push(...(await buildActivityReportBlock(a)))

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}
