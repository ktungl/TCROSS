import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { parseCsv } from './registration'
import type { FileMeta } from '../types'

/** 活動流程檔讀出來的內容：一般段落文字，或行程表（表格每列的儲存格文字）。 */
export type AgendaBlock = { type: 'text'; text: string } | { type: 'table'; rows: string[][] }

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function isAgendaReadable(file: FileMeta): boolean {
  return /\.(docx|xlsx|csv|txt)$/i.test(file.name.trim())
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === W_NS)
}

/** w:p 的文字：w:t 串起來，w:tab 當空白、w:br 當換行 */
function paragraphText(p: Element): string {
  let text = ''
  const walk = (node: Element) => {
    for (const child of elementChildren(node)) {
      if (child.localName === 't') text += child.textContent ?? ''
      else if (child.localName === 'tab') text += ' '
      else if (child.localName === 'br' || child.localName === 'cr') text += '\n'
      else walk(child)
    }
  }
  walk(p)
  return text.trim()
}

function wordChildren(el: Element, name: string): Element[] {
  return elementChildren(el).filter((c) => c.localName === name)
}

async function readDocx(data: ArrayBuffer): Promise<AgendaBlock[]> {
  const zip = await JSZip.loadAsync(data)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return []
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W_NS, 'body')[0]
  if (!body) return []
  const blocks: AgendaBlock[] = []
  for (const el of elementChildren(body)) {
    if (el.localName === 'p') {
      const text = paragraphText(el)
      if (text) blocks.push({ type: 'text', text })
    } else if (el.localName === 'tbl') {
      const rows = wordChildren(el, 'tr')
        .map((tr) =>
          wordChildren(tr, 'tc').map((tc) =>
            Array.from(tc.getElementsByTagNameNS(W_NS, 'p')).map(paragraphText).filter(Boolean).join('\n'),
          ),
        )
        .filter((r) => r.some(Boolean))
      if (rows.length) blocks.push({ type: 'table', rows })
    }
  }
  return blocks
}

async function readXlsx(data: ArrayBuffer): Promise<AgendaBlock[]> {
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
  return rows.length ? [{ type: 'table', rows }] : []
}

async function readAgendaFile(file: FileMeta): Promise<AgendaBlock[]> {
  const res = await fetch(file.url)
  if (!res.ok) throw new Error(`無法讀取活動流程「${file.name}」`)
  const name = file.name.trim().toLowerCase()
  if (name.endsWith('.docx')) return readDocx(await res.arrayBuffer())
  if (name.endsWith('.xlsx')) return readXlsx(await res.arrayBuffer())
  const text = (await res.text()).replace(/^﻿/, '')
  if (name.endsWith('.csv')) {
    const rows = parseCsv(text).map((r) => r.map((v) => v.trim())).filter((r) => r.some(Boolean))
    return rows.length ? [{ type: 'table', rows }] : []
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ type: 'text' as const, text: l }))
}

/** 把活動的所有「活動流程」附件讀成段落與行程表，依上傳順序串接。
 * PDF／圖片等讀不出文字的格式略過；單一檔案讀取失敗也略過，不讓整份報告產生失敗。 */
export async function readAgenda(files: FileMeta[]): Promise<AgendaBlock[]> {
  const blocks: AgendaBlock[] = []
  for (const file of files.filter(isAgendaReadable)) {
    try {
      blocks.push(...(await readAgendaFile(file)))
    } catch (err) {
      console.error(`讀取活動流程失敗：${file.name}`, err)
    }
  }
  return blocks
}
