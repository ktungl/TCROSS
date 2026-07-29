import { FOLDERS } from '../types'
import type { ActivityRecord } from '../types'

export function kb(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function nFiles(a: ActivityRecord): number {
  return FOLDERS.reduce((sum, [key]) => sum + (a.files[key]?.length ?? 0), 0)
}

/** 缺漏規則：五個必備項目 */
export function gaps(a: ActivityRecord): string[] {
  const g: string[] = []
  if (!a.plans.length) g.push('尚未對應計畫')
  if (!(a.files.photo?.length ?? 0)) g.push('沒有照片')
  if (!(a.files.doc?.length ?? 0)) g.push('沒有簽到表或紀錄文件')
  if (!a.summary.trim()) g.push('成果摘要空白')
  if (!a.kpis.length) g.push('未填 KPI')
  return g
}

export function score(a: ActivityRecord): number {
  return Math.round(((5 - gaps(a).length) / 5) * 100)
}
