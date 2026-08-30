import { ATTACHMENT_TYPES, PHOTO_MIN } from '../types'
import type { ActivityRecord } from '../types'

export function kb(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function nFiles(a: ActivityRecord): number {
  return ATTACHMENT_TYPES.reduce((sum, [key]) => sum + (a.files[key]?.length ?? 0), 0)
}

/** 缺漏規則：五個必備項目 */
export function gaps(a: ActivityRecord): string[] {
  const g: string[] = []
  if (!a.plans.length) g.push('尚未對應計畫')
  if ((a.files.photo?.length ?? 0) < PHOTO_MIN) g.push(`照片未達 ${PHOTO_MIN} 張`)
  if (a.files.photo?.some((f) => !f.caption?.trim())) g.push('有照片未填圖說')
  if (!(a.files.signIn?.length ?? 0) && !(a.files.record?.length ?? 0)) g.push('沒有簽到表或成果紀錄')
  if (!a.summary.trim()) g.push('成果摘要空白')
  if (!a.kpis.length) g.push('未填 KPI')
  return g
}

const GAP_CHECK_COUNT = 6

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
