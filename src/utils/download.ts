import ExcelJS from 'exceljs'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
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

export type GeneratedFormKind = '簽到表' | '領據' | '活動紀錄表'

export function generatedFormExtension(kind: GeneratedFormKind): 'xlsx' | 'docx' {
  return kind === '領據' ? 'docx' : 'xlsx'
}

function activityInfoLines(a: ActivityRecord, planNames: string): string[] {
  return [
    `活動名稱：${a.name}　日期：${a.date}${a.time ? ` ${a.time}` : ''}`,
    `地點：${a.place}　負責人：${a.owner}`,
    `對應計畫：${planNames || '—'}`,
  ]
}

export async function buildSignInSheetXlsx(a: ActivityRecord, planNames: string): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('簽到表')
  sheet.columns = [{ width: 8 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 16 }]

  sheet.mergeCells('A1:E1')
  const title = sheet.getCell('A1')
  title.value = '簽到表'
  title.font = { bold: true, size: 16 }
  title.alignment = { horizontal: 'center' }

  const infoLines = activityInfoLines(a, planNames)
  infoLines.forEach((line, i) => {
    const rowIdx = 2 + i
    sheet.mergeCells(`A${rowIdx}:E${rowIdx}`)
    sheet.getCell(`A${rowIdx}`).value = line
  })

  const headerRowIdx = 2 + infoLines.length + 1
  const headers = ['編號', '姓名', '單位／身分', '聯絡方式', '簽名']
  headers.forEach((h, i) => {
    const cell = sheet.getRow(headerRowIdx).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true }
    cell.border = THIN_BORDER
  })

  const rowCount = Math.max(10, a.headcount.total || 10)
  for (let i = 0; i < rowCount; i++) {
    const row = sheet.getRow(headerRowIdx + 1 + i)
    for (let c = 1; c <= 5; c++) {
      const cell = row.getCell(c)
      if (c === 1) cell.value = i + 1
      cell.border = THIN_BORDER
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
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
    ['參與人數', `男性 ${a.headcount.male} 人、女性 ${a.headcount.female} 人，合計 ${a.headcount.total} 人`, 1],
    ['活動流程', '', 5],
    ['執行情形', a.summary, 5],
    ['檢討與建議', '', 5],
    ['附件', ATTACHMENT_TYPES.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0} 件`).join('　'), 1],
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
    sheet.getRow(rowIdx).height = heightLines * 15
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

interface ImageAsset {
  dataUrl: string
  data: ArrayBuffer
  docxType: 'jpg' | 'png' | 'gif' | 'bmp'
  xlsxExt: 'jpeg' | 'png' | 'gif'
  width: number
  height: number
}

async function loadImageAsset(file: FileMeta): Promise<ImageAsset | null> {
  const kind = fileKindFromName(file.name)
  if (!kind || !file.url) return null
  try {
    const res = await fetch(file.url)
    if (!res.ok) return null
    const blob = await res.blob()
    const [dataUrl, data, dims] = await Promise.all([
      blobToDataUrl(blob),
      blob.arrayBuffer(),
      readImageDimensions(blob),
    ])
    return { dataUrl, data, docxType: kind.docxType, xlsxExt: kind.xlsxExt, width: dims.width, height: dims.height }
  } catch {
    return null
  }
}

function scaleToBox(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = Math.min(maxW / w, maxH / h, 1)
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) }
}

/** 大紀事 Excel：分類／日期／地點／出席事由／與會單位或成員／備註／與會人數統計／精選照片 */
export async function buildLedgerXlsx(activities: ActivityRecord[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('大紀事')
  const headers = ['分類', '日期', '地點', '出席事由', '與會單位或成員', '備註', '與會人數統計', '精選照片']
  sheet.columns = [
    { width: 10 },
    { width: 14 },
    { width: 16 },
    { width: 26 },
    { width: 20 },
    { width: 20 },
    { width: 12 },
    { width: 14 },
  ]
  const PHOTO_COL = headers.length

  const headerRow = sheet.getRow(1)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true }
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  for (let i = 0; i < activities.length; i++) {
    const a = activities[i]
    const rowIdx = i + 2
    const row = sheet.getRow(rowIdx)
    const values = [
      a.categories.join('、'),
      formatLedgerDate(a.date),
      a.place,
      a.name,
      a.attendees,
      a.remark,
      a.headcount.total ? `${a.headcount.total}人` : '',
    ]
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'top', wrapText: true }
    })
    row.getCell(PHOTO_COL).border = THIN_BORDER
    row.height = 60

    const [photo] = pickPhotosForExport(a.files.photo ?? [], 1)
    const asset = photo ? await loadImageAsset(photo) : null
    if (asset) {
      const { width, height } = scaleToBox(asset.width, asset.height, 70, 55)
      const imageId = workbook.addImage({ base64: asset.dataUrl, extension: asset.xlsxExt })
      sheet.addImage(imageId, {
        tl: { col: PHOTO_COL - 1 + 0.05, row: rowIdx - 1 + 0.05 },
        ext: { width, height },
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
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

    children.push(new Paragraph({ text: '二、活動內容', spacing: { before: 100 } }))
    children.push(new Paragraph({ text: a.summary || '（活動內容待補）' }))

    const photos = pickPhotosForExport(a.files.photo ?? [], 6)
    for (const photo of photos) {
      const asset = await loadImageAsset(photo)
      if (!asset) continue
      const { width, height } = scaleToBox(asset.width, asset.height, 320, 320)
      children.push(
        new Paragraph({
          children: [new ImageRun({ type: asset.docxType, data: asset.data, transformation: { width, height } })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120 },
        }),
      )
      children.push(new Paragraph({ text: photo.caption || '（未填圖說）', alignment: AlignmentType.CENTER }))
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
        text: `三、活動日期：${formatRocChinese(a.date)}${a.time ? ` ${a.time}` : ''}`,
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
    children.push(new Paragraph({ text: '', spacing: { after: 400 } }))
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}
