<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { UNRECORDED, formatDateTime } from '../utils/actor'
import { GENERATION_STATUS_LABELS } from '../types'
import type { AuditAction, AuditChange, AuditLogRecord, GenerationJobStatus } from '../types'

defineProps<{
  logs: AuditLogRecord[]
  /** 在活動頁裡顯示時不用再連回同一個活動 */
  hideActivityLink?: boolean
}>()

const router = useRouter()
const db = useDbStore()
const expanded = ref(new Set<string>())

const ACTION_LABELS: Record<AuditAction, string> = {
  create: '建立',
  update: '修改',
  delete: '刪除',
  login: '登入',
  logout: '登出',
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
}

/** 把 AuditLog 裡存的原始值轉成看得懂的文字。 */
function formatValue(change: AuditChange, value: unknown): string {
  if (isEmpty(value)) return '（空白）'
  if (change.field === 'plans' && Array.isArray(value)) {
    return value.map((id) => db.plans.find((p) => p.id === id)?.name ?? '（已刪除的計畫）').join('、')
  }
  if (change.field === 'activity' && typeof value === 'string') {
    return db.activities.find((a) => a.id === value)?.name ?? '（已刪除的活動）'
  }
  if (change.field === 'status' && typeof value === 'string') return GENERATION_STATUS_LABELS[value as GenerationJobStatus] ?? value
  if (change.field === 'deletedAt') return typeof value === 'string' ? formatDateTime(value) : String(value)
  if (change.field === 'kpis' && Array.isArray(value)) {
    return value
      .map((k) => {
        const kpi = k as { k?: string; v?: string; u?: string }
        return `${kpi.k ?? ''} ${kpi.v ?? ''}${kpi.u ?? ''}`.trim()
      })
      .join('、')
  }
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function activityExists(id: string): boolean {
  return db.activities.some((a) => a.id === id)
}

</script>

<template>
  <ul v-if="logs.length" class="audit-list">
    <li v-for="log in logs" :key="log.id">
      <div class="audit-head">
        <span class="mono audit-time">{{ formatDateTime(log.createdAt) }}</span>
        <strong>{{ log.actorName || UNRECORDED }}</strong>
        <span class="tag">{{ ACTION_LABELS[log.action] ?? log.action }}</span>
        <button
          v-if="!hideActivityLink && log.activityId && activityExists(log.activityId)"
          class="link link-sm"
          @click="router.push({ name: 'detail', params: { id: log.activityId } })"
        >前往活動</button>
      </div>
      <div class="audit-summary">{{ log.summary }}</div>
      <template v-if="log.action === 'update' && log.changes.length">
        <button class="link link-sm" @click="toggle(log.id)">
          {{ expanded.has(log.id) ? '收合修改內容' : `查看修改內容（${log.changes.length} 個欄位）` }}
        </button>
        <table v-if="expanded.has(log.id)" class="audit-changes">
          <thead><tr><th>欄位</th><th>修改前</th><th>修改後</th></tr></thead>
          <tbody>
            <tr v-for="c in log.changes" :key="c.field">
              <td>{{ c.label }}</td>
              <td>{{ formatValue(c, c.before) }}</td>
              <td>{{ formatValue(c, c.after) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </li>
  </ul>
  <p v-else class="empty">沒有操作紀錄。</p>
</template>

<style scoped>
.audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.audit-list li {
  padding: 11px 15px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
}
.audit-list li:last-child {
  border-bottom: 0;
}
.audit-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.audit-time {
  font-size: 11.5px;
  color: var(--ink-faint);
}
.audit-summary {
  margin-top: 4px;
  white-space: pre-line;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}
.link-sm {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}
.audit-changes {
  width: 100%;
  margin-top: 6px;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
}
.audit-changes th,
.audit-changes td {
  text-align: left;
  vertical-align: top;
  padding: 5px 6px;
  border-bottom: 1px solid var(--line-soft);
  overflow-wrap: anywhere;
}
.audit-changes th {
  color: var(--ink-soft);
  font-weight: 500;
}
.audit-changes th:first-child {
  width: 30%;
}
</style>
