import ExcelJS from 'exceljs'

/** 試算表的共用讀法（報名表、活動流程）。 */

/** UTF-8 BOM：Excel 另存的 CSV 開頭常帶這個字元 */
export function stripBom(text: string): string {
  return text.replace(/^﻿/, '')
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 第一個工作表的每列儲存格文字（去頭尾空白、略過整列空白的列）。 */
export async function readFirstSheet(data: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = []
    for (let c = 1; c <= row.cellCount; c++) values.push(row.getCell(c).text.trim())
    if (values.some(Boolean)) rows.push(values)
  })
  return rows
}
