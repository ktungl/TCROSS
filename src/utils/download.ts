import ExcelJS from 'exceljs'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from 'docx'
import { FOLDERS } from '../types'
import type { ActivityRecord } from '../types'

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
    `活動名稱：${a.name}　日期：${a.date}`,
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

  const rowCount = Math.max(10, a.headcount || 10)
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
    ['參與人數', String(a.headcount || ''), 1],
    ['活動流程', '', 5],
    ['執行情形', a.summary, 5],
    ['檢討與建議', '', 5],
    ['附件', FOLDERS.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0} 件`).join('　'), 1],
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

export async function buildResultsReportDocx(
  activities: ActivityRecord[],
  planScopeLabel: string,
  fromLabel: string,
  toLabel: string,
): Promise<Blob> {
  const totalHeadcount = activities.reduce((s, a) => s + (Number(a.headcount) || 0), 0)
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: '成果報告草稿', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `計畫範圍：${planScopeLabel}　期間：${fromLabel} 至 ${toLabel}` }),
    new Paragraph({ text: `活動場次：${activities.length} 場　累計參與：${totalHeadcount} 人次`, spacing: { after: 300 } }),
  ]

  activities.forEach((a, i) => {
    children.push(new Paragraph({ text: `${i + 1}. ${a.name}`, heading: HeadingLevel.HEADING_2 }))
    children.push(new Paragraph({ text: `${a.date}｜${a.place}｜負責人 ${a.owner}｜參與 ${a.headcount} 人` }))
    children.push(new Paragraph({ text: a.summary || '（成果摘要待補）' }))
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
    }
    children.push(
      new Paragraph({
        text: `附件：${FOLDERS.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0}`).join('　')}`,
        spacing: { after: 300 },
      }),
    )
  })

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}
