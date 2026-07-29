<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { gaps, nFiles, score } from '../utils/activity'
import { buildCsv, downloadFile, escapeHtml, wrapDoc } from '../utils/download'
import { FOLDERS } from '../types'

const db = useDbStore()

const xPlan = ref('')
const xFrom = ref('')
const xTo = ref('')
const previewVisible = ref(false)

const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const picked = computed(() =>
  db.activities
    .filter(
      (a) =>
        (!xPlan.value || a.plans.includes(xPlan.value)) &&
        (!xFrom.value || a.date >= xFrom.value) &&
        (!xTo.value || a.date <= xTo.value),
    )
    .slice()
    .sort((x, y) => (x.date || '').localeCompare(y.date || '')),
)

function doPreview() {
  previewVisible.value = true
}

function doCsv() {
  const rows = [
    ['日期', '活動名稱', '地點', '負責人', '參與人數', '對應計畫', '成果摘要', 'KPI', '檔案數', '缺漏'],
    ...picked.value.map((a) => [
      a.date,
      a.name,
      a.place,
      a.owner,
      a.headcount,
      a.plans.map(planName).join('；'),
      a.summary,
      a.kpis.map((k) => `${k.k} ${k.v}${k.u}`).join('；'),
      nFiles(a),
      gaps(a).join('；'),
    ]),
  ]
  downloadFile('成果清單.csv', buildCsv(rows), 'text/csv')
}

function doDoc() {
  const pn = xPlan.value ? planName(xPlan.value) : '全部計畫'
  const inner = `<h1>成果報告草稿</h1>
    <p>計畫範圍：${escapeHtml(pn)}　　期間：${escapeHtml(xFrom.value || '不限')} 至 ${escapeHtml(xTo.value || '不限')}<br>
    活動場次：${picked.value.length} 場　　累計參與：${picked.value.reduce((s, a) => s + (Number(a.headcount) || 0), 0)} 人次</p>
    ${picked.value
      .map(
        (a, i) => `<h2>${i + 1}. ${escapeHtml(a.name)}</h2>
      <p>${escapeHtml(a.date)}｜${escapeHtml(a.place)}｜負責人 ${escapeHtml(a.owner)}｜參與 ${escapeHtml(a.headcount)} 人</p>
      <p>${escapeHtml(a.summary) || '（成果摘要待補）'}</p>
      ${
        a.kpis.length
          ? `<table><tr><th>指標</th><th>數值</th></tr>${a.kpis
              .map((k) => `<tr><td>${escapeHtml(k.k)}</td><td>${escapeHtml(k.v)} ${escapeHtml(k.u)}</td></tr>`)
              .join('')}</table>`
          : ''
      }
      <p>附件：${FOLDERS.map(([k, l]) => `${l} ${a.files[k]?.length ?? 0}`).join('　')}</p>`,
      )
      .join('')}`
  downloadFile('成果報告草稿.html', wrapDoc('成果報告草稿', inner))
}
</script>

<template>
  <h1>匯出成果</h1>
  <p class="sub">挑計畫或期間，產出成果清單與成果報告草稿。</p>
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
    <div class="row" style="margin-top:16px">
      <button class="btn" @click="doPreview">產生預覽</button>
      <button class="btn ghost" @click="doCsv">下載成果清單 CSV</button>
      <button class="btn ghost" @click="doDoc">下載成果報告草稿</button>
    </div>
  </div>

  <div v-if="previewVisible">
    <h2>成果清單預覽（{{ picked.length }} 場）</h2>
    <div class="card" style="overflow:auto">
      <table class="out">
        <thead>
          <tr><th>日期</th><th>活動</th><th>地點</th><th>人數</th><th>KPI</th><th>檔案</th><th>完整度</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in picked" :key="a.id">
            <td class="mono">{{ a.date }}</td>
            <td>{{ a.name }}</td>
            <td>{{ a.place }}</td>
            <td class="mono">{{ a.headcount }}</td>
            <td>{{ a.kpis.map(k => `${k.k} ${k.v}${k.u}`).join('；') || '—' }}</td>
            <td class="mono">{{ nFiles(a) }}</td>
            <td class="mono">{{ score(a) }}%<span v-if="gaps(a).length" class="stamp">待補</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
