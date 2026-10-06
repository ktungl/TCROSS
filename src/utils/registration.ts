import ExcelJS from 'exceljs'
import type { FileMeta } from '../types'

export interface Participant {
  unit: string
  title: string
  name: string
}

/** 報名表只能從試算表格式讀出欄位；Word／PDF／圖片的報名表無法自動帶入。 */
export function isParsableRegistration(file: FileMeta): boolean {
  return /\.(xlsx|csv)$/i.test(file.name.trim())
}

// 表頭比對：Google 表單、各單位自製報名表的欄名不一致，用關鍵字辨識
const HEADER_MATCHERS: [keyof Participant, RegExp][] = [
  ['name', /姓名|名字|^name$/i],
  ['title', /職稱|職務|職位|^title$/i],
  ['unit', /單位|機關|公司|組織|所屬|服務處/i],
]

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

async function readRows(file: FileMeta): Promise<string[][]> {
  const res = await fetch(file.url)
  if (!res.ok) throw new Error(`無法讀取報名表「${file.name}」`)
  if (/\.csv$/i.test(file.name.trim())) {
    return parseCsv((await res.text()).replace(/^﻿/, ''))
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await res.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = []
    for (let c = 1; c <= row.cellCount; c++) values.push(row.getCell(c).text)
    rows.push(values)
  })
  return rows
}

/** 讀報名表第一個工作表：在前 10 列裡找有「姓名」的那列當表頭，之後有姓名的列就是參加者。 */
export async function readParticipants(file: FileMeta): Promise<Participant[]> {
  const rows = (await readRows(file)).map((r) => r.map((v) => (v ?? '').trim()))
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const columns: Partial<Record<keyof Participant, number>> = {}
    rows[h].forEach((header, c) => {
      const key = HEADER_MATCHERS.find(([, re]) => re.test(header))?.[0]
      if (key && columns[key] === undefined) columns[key] = c
    })
    if (columns.name === undefined) continue
    const pick = (r: string[], key: keyof Participant) => (columns[key] === undefined ? '' : r[columns[key]!] ?? '')
    return rows
      .slice(h + 1)
      .map((r) => ({ unit: pick(r, 'unit'), title: pick(r, 'title'), name: pick(r, 'name') }))
      .filter((p) => p.name)
  }
  throw new Error(`報名表「${file.name}」找不到「姓名」欄位，請確認第一個工作表的表頭有「姓名」`)
}
