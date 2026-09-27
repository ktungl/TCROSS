<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { errorMessage } from '../composables/useToast'
import AuditLogList from '../components/AuditLogList.vue'
import type { AuditLogRecord } from '../types'

const db = useDbStore()

const logs = ref<AuditLogRecord[]>([])
const loading = ref(false)
const loadError = ref('')

const actorFilter = ref('')
const classFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const keyword = ref('')

const CLASS_OPTIONS: [string, string][] = [
  ['Activity', '活動（含附件）'],
  ['Plan', '計畫'],
  ['Category', '分類'],
  ['GenerationJob', 'AI 生成任務'],
  ['_User', '登入／登出'],
]

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    logs.value = await db.fetchAuditLogs({ limit: 1000 })
  } catch (e) {
    loadError.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const actors = computed(() => [...new Set(logs.value.map((l) => l.actorName).filter(Boolean))].sort())

/** createdAt 是 ISO（UTC），篩選日期用本地日期比較 */
function localDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return logs.value.filter((l) => {
    if (actorFilter.value && l.actorName !== actorFilter.value) return false
    if (classFilter.value && l.targetClass !== classFilter.value) return false
    const day = localDate(l.createdAt)
    if (dateFrom.value && day < dateFrom.value) return false
    if (dateTo.value && day > dateTo.value) return false
    if (kw && !`${l.targetName}\n${l.summary}`.toLowerCase().includes(kw)) return false
    return true
  })
})
</script>

<template>
  <h1>操作紀錄</h1>
  <p class="sub">所有人對計畫、分類、活動、附件與 AI 生成任務的新增、修改、刪除，以及登入登出，都會自動記錄在這裡，無法修改或刪除。</p>

  <div class="card" style="margin-bottom:16px">
    <div class="filters">
      <div>
        <label>人員</label>
        <select v-model="actorFilter">
          <option value="">全部</option>
          <option v-for="a in actors" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>
      <div>
        <label>資料類型</label>
        <select v-model="classFilter">
          <option value="">全部</option>
          <option v-for="[value, label] in CLASS_OPTIONS" :key="value" :value="value">{{ label }}</option>
        </select>
      </div>
      <div>
        <label>起日</label>
        <input v-model="dateFrom" type="date">
      </div>
      <div>
        <label>迄日</label>
        <input v-model="dateTo" type="date">
      </div>
      <div class="kw">
        <label>關鍵字</label>
        <input v-model="keyword" placeholder="活動名稱、檔名…">
      </div>
    </div>
    <div class="row" style="margin-top:12px;justify-content:space-between">
      <span style="font-size:11.5px;color:var(--ink-faint)">顯示 {{ filtered.length }} ／ 共 {{ logs.length }} 筆（最近 1000 筆）</span>
      <button class="btn ghost sm" :disabled="loading" @click="load">{{ loading ? '載入中…' : '重新整理' }}</button>
    </div>
  </div>

  <p v-if="loadError" class="flagbox"><b>讀取失敗</b>　{{ loadError }}</p>
  <div class="card" style="padding:0">
    <p v-if="loading && !logs.length" class="empty">載入中…</p>
    <AuditLogList v-else :logs="filtered" />
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.filters select,
.filters input {
  width: 100%;
  box-sizing: border-box;
}
</style>
