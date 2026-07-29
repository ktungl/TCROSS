import { FOLDERS } from '../types'
import type { ActivityRecord } from '../types'

/**
 * These generated strings become raw HTML files served for download, not Vue
 * template output, so Vue's auto-escaping doesn't apply here — escape by hand.
 */
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ESCAPE_MAP[c])
}

export function downloadFile(name: string, text: string, type: 'text/html' | 'text/csv' = 'text/html'): void {
  const blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function wrapDoc(title: string, inner: string): string {
  return `<!DOCTYPE html><html lang="zh-Hant"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font-family:"Noto Sans TC",sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.8;color:#14202B}
  table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #999;padding:8px 10px;text-align:left}
  th{background:#F2F0EA;font-weight:500}h1,h2{letter-spacing:.2em}hr{border:0;border-top:1px solid #999;margin:16px 0}</style>
  ${inner}</html>`
}

export function buildCsv(rows: (string | number)[][]): string {
  const q = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return rows.map((row) => row.map(q).join(',')).join('\n')
}

export type GeneratedFormKind = '簽到表' | '領據' | '活動紀錄表'

export function generatedFormHead(a: ActivityRecord, kind: GeneratedFormKind, planNames: string): string {
  return `<h2 style="text-align:center;letter-spacing:.3em;border:0">${kind}</h2>
    <p class="mono" style="font-size:12px">活動名稱：${escapeHtml(a.name)}　　日期：${escapeHtml(a.date)}<br>
    地點：${escapeHtml(a.place)}　　負責人：${escapeHtml(a.owner)}<br>
    對應計畫：${planNames || '—'}</p><hr>`
}

export function generatedFormBody(a: ActivityRecord, kind: GeneratedFormKind): string {
  switch (kind) {
    case '簽到表':
      return `<table class="out"><tr><th>編號</th><th>姓名</th><th>單位／身分</th><th>聯絡方式</th><th>簽名</th></tr>${Array.from(
        { length: Math.max(10, a.headcount || 10) },
        (_, i) => `<tr><td class="mono">${i + 1}</td><td></td><td></td><td></td><td></td></tr>`,
      ).join('')}</table>`
    case '領據':
      return `<p>茲收到　　　　　　　　　　撥付之「${escapeHtml(a.name)}」活動經費，金額新臺幣　　　　　　　　元整，特立此據。</p>
      <p style="margin-top:40px">立據人（簽章）：　　　　　　　　　　　身分證字號：</p>
      <p>地址：</p><p>日期：中華民國　　年　　月　　日</p>`
    case '活動紀錄表':
      return `<table class="out">
      <tr><th style="width:110px">參與人數</th><td>${a.headcount || ''}</td></tr>
      <tr><th>活動流程</th><td style="height:90px"></td></tr>
      <tr><th>執行情形</th><td style="height:90px">${escapeHtml(a.summary)}</td></tr>
      <tr><th>檢討與建議</th><td style="height:90px"></td></tr>
      <tr><th>附件</th><td>${FOLDERS.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0} 件`).join('　')}</td></tr></table>`
  }
}
