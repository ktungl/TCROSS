import ExcelJS from 'exceljs'
import type { ActivityRecord } from '../types'
import { gaps } from './activity'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const FONT = { name: '微軟正黑體', size: 12 }
const BOLD = { ...FONT, bold: true }
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE7EEF7' } }
const THIN_BORDER = {
  top: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  left: { style: 'thin' as const },
  right: { style: 'thin' as const },
}

interface StatsRow {
  label: string
  sessions: number
  male: number
  female: number
  total: number
}

function emptyRow(label: string): StatsRow {
  return { label, sessions: 0, male: 0, female: 0, total: 0 }
}

function addTo(row: StatsRow, a: ActivityRecord) {
  row.sessions++
  row.male += a.headcount.male || 0
  row.female += a.headcount.female || 0
  row.total += a.headcount.total || 0
}

/** 依 keysOf 分組小計；一場活動有多個計畫／分類時，每組各算一次（各組加總會大於總計）。 */
function groupBy(
  activities: ActivityRecord[],
  keysOf: (a: ActivityRecord) => string[],
  emptyLabel: string,
): StatsRow[] {
  const groups = new Map<string, StatsRow>()
  for (const a of activities) {
    const keys = keysOf(a).filter(Boolean)
    for (const key of keys.length ? keys : [emptyLabel]) {
      if (!groups.has(key)) groups.set(key, emptyRow(key))
      addTo(groups.get(key)!, a)
    }
  }
  return [...groups.values()]
}

interface OutcomeStats {
  overall: StatsRow
  byPlan: StatsRow[]
  byCategory: StatsRow[]
  byMonth: StatsRow[]
}

export function computeOutcomeStats(activities: ActivityRecord[], planName: (id: string) => string): OutcomeStats {
  const overall = emptyRow('合計')
  activities.forEach((a) => addTo(overall, a))
  const byMonth = groupBy(activities, (a) => [(a.date || '').slice(0, 7)], '未定日期').sort((x, y) =>
    x.label.localeCompare(y.label),
  )
  return {
    overall,
    byPlan: groupBy(activities, (a) => a.plans.map(planName), '未對應計畫').sort((x, y) => y.sessions - x.sessions),
    byCategory: groupBy(activities, (a) => a.categories, '未分類').sort((x, y) => y.sessions - x.sessions),
    byMonth,
  }
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = BOLD
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  row.height = 24
}

function styleBody(row: ExcelJS.Row, numericFrom: number) {
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = FONT
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle', horizontal: col >= numericFrom ? 'right' : undefined, wrapText: true }
  })
}

const STATS_HEADERS = ['項目', '場次', '男性人數', '女性人數', '合計人數', '平均每場人數']

function statsValues(r: StatsRow): (string | number)[] {
  return [r.label, r.sessions, r.male, r.female, r.total, r.sessions ? Math.round((r.total / r.sessions) * 10) / 10 : 0]
}

function addStatsTable(sheet: ExcelJS.Worksheet, title: string, rows: StatsRow[], note?: string) {
  const titleRow = sheet.addRow([title])
  titleRow.getCell(1).font = { ...BOLD, size: 13 }
  if (note) sheet.addRow([note]).getCell(1).font = { ...FONT, size: 10, color: { argb: 'FF666666' } }
  styleHeader(sheet.addRow(STATS_HEADERS))
  for (const r of rows) styleBody(sheet.addRow(statsValues(r)), 2)
  sheet.addRow([])
}

/** 成效統計表 Excel：「統計總表」（總計＋依計畫／分類／月份小計）＋「活動明細」。 */
export async function buildOutcomeStatsXlsx(
  activities: ActivityRecord[],
  planName: (id: string) => string,
  scope: { planLabel: string; from: string; to: string; categories: string[] },
): Promise<Blob> {
  const stats = computeOutcomeStats(activities, planName)
  const workbook = new ExcelJS.Workbook()

  const summary = workbook.addWorksheet('統計總表')
  summary.columns = [{ width: 30 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }]
  summary.addRow(['活動成效統計表']).getCell(1).font = { ...BOLD, size: 16 }
  const period = scope.from || scope.to ? `${scope.from || '不限'} ～ ${scope.to || '不限'}` : '不限'
  for (const line of [
    `計畫：${scope.planLabel}`,
    `期間：${period}`,
    `分類：${scope.categories.length ? scope.categories.join('、') : '全部'}`,
    `產出日期：${new Date().toLocaleDateString('zh-TW')}`,
  ]) {
    summary.addRow([line]).getCell(1).font = FONT
  }
  summary.addRow([])
  addStatsTable(summary, '總計', [stats.overall])
  const overlapNote = '一場活動對應多個項目時，每個項目各計一次，因此各列加總可能大於總計。'
  addStatsTable(summary, '依計畫', stats.byPlan, overlapNote)
  addStatsTable(summary, '依活動分類', stats.byCategory, overlapNote)
  addStatsTable(summary, '依月份', stats.byMonth)

  const detail = workbook.addWorksheet('活動明細', { views: [{ state: 'frozen', ySplit: 1 }] })
  detail.columns = [
    { width: 12 }, { width: 32 }, { width: 18 }, { width: 24 }, { width: 28 },
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 }, { width: 28 },
  ]
  styleHeader(
    detail.addRow(['日期', '活動名稱', '活動分類', '對應計畫', '地點', '男性', '女性', '合計', 'KPI', '缺漏']),
  )
  for (const a of activities) {
    styleBody(
      detail.addRow([
        a.date,
        a.name,
        a.categories.join('、'),
        a.plans.map(planName).join('、'),
        a.place,
        a.headcount.male || 0,
        a.headcount.female || 0,
        a.headcount.total || 0,
        a.kpis.map((k) => `${k.k} ${k.v}${k.u}`).join('；'),
        gaps(a).join('；'),
      ]),
      6,
    )
    // KPI、缺漏是文字欄，靠左
    const last = detail.lastRow!
    for (const col of [9, 10]) last.getCell(col).alignment = { vertical: 'middle', wrapText: true }
  }
  const totalRow = detail.addRow([
    '', '合計', '', '', '', stats.overall.male, stats.overall.female, stats.overall.total, '', '',
  ])
  styleBody(totalRow, 6)
  totalRow.eachCell((cell) => (cell.font = BOLD))

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_MIME })
}
