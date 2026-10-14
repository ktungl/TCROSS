import { ATTACHMENT_TYPES, PHOTO_MIN } from '../types'
import type { ActivityRecord } from '../types'

/** 用地點文字產生 Google 地圖搜尋連結（不需要地理編碼 API，直接讓 Google 用文字搜尋）。 */
export function googleMapsUrl(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
}

export function kb(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function nFiles(a: ActivityRecord): number {
  return ATTACHMENT_TYPES.reduce((sum, [key]) => sum + (a.files[key]?.length ?? 0), 0)
}

/** 缺漏規則：五個必備項目（KPI 先不列入缺漏提醒） */
export function gaps(a: ActivityRecord): string[] {
  const g: string[] = []
  if (!a.plans.length) g.push('尚未對應計畫')
  if ((a.files.photo?.length ?? 0) < PHOTO_MIN) g.push(`照片未達 ${PHOTO_MIN} 張`)
  if (a.files.photo?.some((f) => !f.caption?.trim())) g.push('有照片未填圖說')
  if (!(a.files.signIn?.length ?? 0) && !(a.files.record?.length ?? 0)) g.push('沒有簽到表或成果紀錄')
  if (!a.summary.trim()) g.push('成果摘要空白')
  return g
}

const GAP_CHECK_COUNT = 5

export function score(a: ActivityRecord): number {
  return Math.round(((GAP_CHECK_COUNT - gaps(a).length) / GAP_CHECK_COUNT) * 100)
}

export function averageScore(activities: ActivityRecord[]): number {
  if (!activities.length) return 0
  return Math.round(activities.reduce((sum, a) => sum + score(a), 0) / activities.length)
}

export interface MonthCount {
  month: string
  label: string
  count: number
}

/** 近 months 個月（含當月）的活動數量，缺的月份補 0 */
export function monthlyCounts(activities: ActivityRecord[], months = 6): MonthCount[] {
  const now = new Date()
  const buckets: MonthCount[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.push({ month, label: `${d.getMonth() + 1}月`, count: 0 })
  }
  const byMonth = new Map(buckets.map((b) => [b.month, b]))
  for (const a of activities) {
    const bucket = byMonth.get((a.date || '').slice(0, 7))
    if (bucket) bucket.count++
  }
  return buckets
}

// ── 資料防呆：存檔前檢查前後矛盾（只提醒、不阻擋，使用者確認後仍可儲存） ──

const WEEKDAY_CHARS = '日一二三四五六'

function parseDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function weekdayLabel(d: Date): string {
  return `週${WEEKDAY_CHARS[d.getDay()]}`
}

/** 文字裡提到的星期、月日、年份，跟活動日期不一致的地方。
 * 只認明確寫法：週六／星期六／禮拜天、10/18(六)、10月18日、10/18、115年、2026年。 */
export function dateMentionMismatches(text: string, date: string, fieldLabel: string): string[] {
  const d = parseDate(date)
  if (!d || !text.trim()) return []
  const issues = new Set<string>()
  const actual = `${date}（${weekdayLabel(d)}）`

  for (const m of text.matchAll(/(?:週|周|星期|禮拜)([日天一二三四五六])|[(（]([日一二三四五六])[)）]/g)) {
    const ch = (m[1] ?? m[2]).replace('天', '日')
    if (WEEKDAY_CHARS.indexOf(ch) !== d.getDay()) {
      issues.add(`${fieldLabel}寫「${m[0]}」，但活動日期是 ${actual}`)
    }
  }
  // 斜線後面接「折、的、人、倍、以上」這類字是分數或比例（1/2 折、3/4 的人），不是日期
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})(?:月(\d{1,2})[日號]|\/(\d{1,2})(?!\s*(?:折|的|人|位|名|倍|成|份|組|個|以上|以下|左右|強|弱|%|％)))(?![\d/])/g)) {
    const month = Number(m[1])
    const day = Number(m[2] ?? m[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    if (month !== d.getMonth() + 1 || day !== d.getDate()) {
      issues.add(`${fieldLabel}寫「${m[0]}」，但活動日期是 ${actual}`)
    }
  }
  for (const m of text.matchAll(/(?<!\d)(\d{3}|20\d{2})\s*年/g)) {
    const year = Number(m[1])
    const expected = year >= 2000 ? d.getFullYear() : d.getFullYear() - 1911
    if (year !== expected) issues.add(`${fieldLabel}寫「${m[0]}」，但活動日期是 ${actual}`)
  }
  return [...issues]
}

export interface BasicInfoInput {
  name: string
  date: string
  time: string
  timeEnd: string
  placeMode: 'physical' | 'online'
  address: string
  meetingUrl: string
  participantDesc: string
  remark: string
  headcount: { male: number; female: number; total: number }
}

const ONLINE_HINT = /線上|視訊|zoom|google\s*meet|teams|webex/i

/** 活動基本資料表單的防呆檢查。 */
export function checkBasicInfo(input: BasicInfoInput, today = new Date()): string[] {
  const issues: string[] = []
  for (const [text, label] of [
    [input.name, '活動名稱'],
    [input.participantDesc, '參加對象說明'],
    [input.remark, '備註'],
  ] as const) {
    issues.push(...dateMentionMismatches(text, input.date, label))
  }

  const d = parseDate(input.date)
  if (d) {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const days = Math.abs(d.getTime() - todayStart.getTime()) / 86_400_000
    if (days > 365) issues.push(`活動日期 ${input.date} 距今超過一年，請確認年份是否正確`)
    if (d < todayStart && !input.headcount.total) issues.push('活動日期已過，但合計人數還是 0')
  }
  if (input.time && input.timeEnd && input.timeEnd < input.time) {
    issues.push(`結束時間 ${input.timeEnd} 早於開始時間 ${input.time}`)
  }
  const { male, female, total } = input.headcount
  if (total < male + female) issues.push(`合計人數 ${total} 少於男女加總 ${male + female}`)
  if (input.placeMode === 'physical' && ONLINE_HINT.test(input.address)) {
    issues.push('地址看起來是線上會議，是否應改選「線上」？')
  }
  if (input.placeMode === 'online' && !input.meetingUrl.trim()) {
    issues.push('線上活動還沒填會議連結')
  }
  return issues
}

/** 存檔前確認彈窗的訊息（ConfirmDialogHost 以 pre-line 顯示換行）。 */
export function consistencyConfirmMessage(issues: string[]): string {
  return `以下 ${issues.length} 項可能有誤：\n・${issues.join('\n・')}\n\n確定要照目前內容儲存嗎？`
}

const HEADCOUNT_KPI = /人數|人次|參與|參加|出席|受益/

/** 成果補充（摘要、KPI）的防呆檢查。 */
export function checkResults(a: ActivityRecord, summary: string, kpis: { k: string; v: string; u: string }[]): string[] {
  const issues = dateMentionMismatches(summary, a.date, '成果摘要')
  const total = a.headcount.total
  for (const k of kpis) {
    const value = Number(String(k.v).replace(/,/g, ''))
    if (
      total &&
      HEADCOUNT_KPI.test(k.k) &&
      /^人$/.test(k.u.trim()) &&
      Number.isFinite(value) &&
      value !== total
    ) {
      issues.push(`KPI「${k.k}」是 ${k.v} 人，但基本資料的合計人數是 ${total} 人`)
    }
  }
  return issues
}
