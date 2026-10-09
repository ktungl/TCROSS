<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps, monthlyCounts } from '../utils/activity'
import { UNRECORDED } from '../utils/actor'

const db = useDbStore()
const router = useRouter()

const totalActivities = computed(() => db.activities.length)
const gapCount = computed(() => db.activities.filter((a) => gaps(a).length).length)
const totalPlans = computed(() => db.plans.length)

const gapActivities = computed(() =>
  db.activities
    .filter((a) => gaps(a).length)
    .slice()
    .sort((x, y) => (y.date || '').localeCompare(x.date || '')),
)

const months = computed(() => monthlyCounts(db.activities, 6))
const maxCount = computed(() => Math.max(1, ...months.value.map((m) => m.count)))

function openActivity(id: string) {
  router.push({ name: 'detail', params: { id } })
}
</script>

<template>
  <h1>總覽</h1>
  <p class="sub">所有活動與計畫的整體狀態。</p>

  <div class="grid3 section-gap">
    <button class="card stat stat-link" @click="router.push({ name: 'list' })">
      <span class="stat-label">活動總數</span>
      <span class="stat-num">{{ totalActivities }}</span>
      <span class="stat-go">查看活動列表 →</span>
    </button>
    <button class="card stat stat-link" @click="router.push({ name: 'list', query: { gap: '1' } })">
      <span class="stat-label">有缺漏活動</span>
      <span class="stat-num">{{ gapCount }}</span>
      <span class="stat-go">只看有缺漏的活動 →</span>
    </button>
    <button class="card stat stat-link" @click="router.push({ name: 'plans' })">
      <span class="stat-label">計畫總數</span>
      <span class="stat-num">{{ totalPlans }}</span>
      <span class="stat-go">管理計畫 →</span>
    </button>
  </div>

  <h2>各活動缺漏項目</h2>
  <div class="card section-gap">
    <p v-if="!gapActivities.length" class="empty flush">目前沒有活動有缺漏。</p>
    <div v-else class="gap-list">
      <button v-for="a in gapActivities" :key="a.id" class="gap-row" @click="openActivity(a.id)">
        <span class="gap-row-head">
          <span class="date mono">{{ a.date || '未定日期' }}</span>
          <span class="gap-row-name">{{ a.name }}</span>
          <span class="actor-stamp" style="margin-left:auto">建立者：{{ a.createdByName || UNRECORDED }}</span>
        </span>
        <span class="gap-row-items">
          <span v-for="g in gaps(a)" :key="g" class="tag">{{ g }}</span>
        </span>
      </button>
    </div>
  </div>

  <h2>近 6 個月活動量</h2>
  <div class="card">
    <div class="chart-bars" role="img" :aria-label="`近六個月活動量：${months.map((m) => `${m.label} ${m.count} 場`).join('、')}`">
      <div v-for="m in months" :key="m.month" class="chart-col">
        <span class="chart-value mono">{{ m.count }}</span>
        <div
          class="chart-bar"
          :style="{ height: (m.count / maxCount) * 100 + '%' }"
          :title="`${m.label}：${m.count} 場`"
        ></div>
      </div>
    </div>
    <div class="chart-labels">
      <span v-for="m in months" :key="m.month" class="chart-label mono">{{ m.label }}</span>
    </div>
  </div>
</template>
