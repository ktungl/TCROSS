<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { gaps, nFiles, score } from '../utils/activity'
import { buildCsv, buildLedgerXlsx, buildNeimuReportDocx, downloadBlob, downloadFile } from '../utils/download'
import { errorMessage, pushToast } from '../composables/useToast'
import type { ActivityCategory } from '../types'

const db = useDbStore()

const xPlan = ref('')
const xFrom = ref('')
const xTo = ref('')
const xCategories = ref<ActivityCategory[]>([])
const wantLedger = ref(true)
const wantNeimu = ref(true)
const exporting = ref(false)
const previewVisible = ref(false)

const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

function toggleCategory(c: ActivityCategory, checked: boolean) {
  xCategories.value = checked ? [...xCategories.value, c] : xCategories.value.filter((x) => x !== c)
}

const picked = computed(() =>
  db.activities
    .filter(
      (a) =>
        (!xPlan.value || a.plans.includes(xPlan.value)) &&
        (!xFrom.value || a.date >= xFrom.value) &&
        (!xTo.value || a.date <= xTo.value) &&
        (!xCategories.value.length || a.categories.some((c) => xCategories.value.includes(c))),
    )
    .slice()
    .sort((x, y) => (x.date || '').localeCompare(y.date || '')),
)

function doPreview() {
  previewVisible.value = true
}

function doCsv() {
  const rows = [
    ['日期', '活動名稱', '分類', '地點', '負責人', '男性人數', '女性人數', '合計人數', '對應計畫', '成果摘要', 'KPI', '檔案數', '缺漏'],
    ...picked.value.map((a) => [
      a.date,
      a.name,
      a.categories.join('、'),
      a.place,
      a.owner,
      a.headcount.male,
      a.headcount.female,
      a.headcount.total,
      a.plans.map(planName).join('；'),
      a.summary,
      a.kpis.map((k) => `${k.k} ${k.v}${k.u}`).join('；'),
      nFiles(a),
      gaps(a).join('；'),
    ]),
  ]
  downloadFile('成果清單.csv', buildCsv(rows), 'text/csv')
}

async function doExport() {
  if (!wantLedger.value && !wantNeimu.value) {
    pushToast('請至少勾選一種匯出格式', 'error')
    return
  }
  if (!picked.value.length) {
    pushToast('目前篩選條件下沒有活動', 'error')
    return
  }
  const pn = xPlan.value ? planName(xPlan.value) : '全部計畫'
  exporting.value = true
  try {
    if (wantLedger.value) {
      const blob = await buildLedgerXlsx(picked.value)
      downloadBlob('大紀事.xlsx', blob)
    }
    if (wantNeimu.value) {
      const blob = await buildNeimuReportDocx(picked.value, pn)
      downloadBlob('內政部核銷成果報告.docx', blob)
    }
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <h1>匯出成果</h1>
  <p class="sub">挑計畫、期間或分類，產出大紀事 Excel 與內政部結案 Word。</p>
  <div class="card">
    <div class="grid3">
      <div>
        <label>計畫</label>
        <select v-model="xPlan">
          <option value="">全部計畫</option>
          <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div><label>起</label><input type="date" v-model="xFrom"></div>
      <div><label>訖</label><input type="date" v-model="xTo"></div>
    </div>

    <label style="margin-top:14px">活動分類（不勾選＝全部）</label>
    <div class="row" style="gap:14px">
      <label v-for="c in db.categories" :key="c.id" class="chk">
        <input
          type="checkbox"
          :checked="xCategories.includes(c.name)"
          @change="toggleCategory(c.name, ($event.target as HTMLInputElement).checked)"
        >{{ c.name }}
      </label>
    </div>

    <label style="margin-top:14px">匯出檔案類型</label>
    <div class="row">
      <label class="chk"><input type="checkbox" v-model="wantLedger">大紀事 Excel</label>
      <label class="chk"><input type="checkbox" v-model="wantNeimu">內政部結案 Word</label>
    </div>

    <div class="row" style="margin-top:16px">
      <button class="btn" :disabled="exporting" @click="doExport">{{ exporting ? '產生中…' : '下載匯出檔案' }}</button>
      <button class="btn ghost" @click="doPreview">產生預覽</button>
      <button class="btn ghost" @click="doCsv">下載成果清單 CSV</button>
    </div>
  </div>

  <div v-if="previewVisible">
    <h2>成果清單預覽（{{ picked.length }} 場）</h2>
    <div class="card" style="overflow:auto">
      <table class="out">
        <thead>
          <tr><th>日期</th><th>活動</th><th>分類</th><th>地點</th><th>人數</th><th>KPI</th><th>檔案</th><th>完整度</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in picked" :key="a.id">
            <td class="mono">{{ a.date }}</td>
            <td>{{ a.name }}</td>
            <td>{{ a.categories.join('、') || '—' }}</td>
            <td>{{ a.place }}</td>
            <td class="mono">{{ a.headcount.total }}</td>
            <td>{{ a.kpis.map(k => `${k.k} ${k.v}${k.u}`).join('；') || '—' }}</td>
            <td class="mono">{{ nFiles(a) }}</td>
            <td class="mono">{{ score(a) }}%<span v-if="gaps(a).length" class="stamp">待補</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
