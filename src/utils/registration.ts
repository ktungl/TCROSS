import type { FileMeta } from '../types'
import { resolveAttachmentUrl } from '../lib/attachments'
import { parseCsv, readFirstSheet, stripBom } from './sheet'

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

async function readRows(file: FileMeta): Promise<string[][]> {
  const res = await fetch(await resolveAttachmentUrl(file.url, file.name))
  if (!res.ok) throw new Error(`無法讀取報名表「${file.name}」`)
  if (/\.csv$/i.test(file.name.trim())) return parseCsv(stripBom(await res.text()))
  return readFirstSheet(await res.arrayBuffer())
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
