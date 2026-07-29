<script setup lang="ts">
import { computed } from 'vue'
import { useDbStore } from '../stores/db'
import { averageScore, gaps, monthlyCounts } from '../utils/activity'

const db = useDbStore()

const totalActivities = computed(() => db.activities.length)
const gapCount = computed(() => db.activities.filter((a) => gaps(a).length).length)
const gapRate = computed(() =>
  totalActivities.value ? Math.round((gapCount.value / totalActivities.value) * 100) : 0,
)
const totalPlans = computed(() => db.plans.length)
const avgScore = computed(() => averageScore(db.activities))

const months = computed(() => monthlyCounts(db.activities, 6))
const maxCount = computed(() => Math.max(1, ...months.value.map((m) => m.count)))
</script>

<template>
  <h1>總覽</h1>
  <p class="sub">所有活動與計畫的整體狀態。</p>

  <div class="grid3" style="margin-bottom:20px">
    <div class="card">
      <label style="margin-bottom:8px">活動總數</label>
      <div class="mono" style="font-size:28px;font-weight:700">{{ totalActivities }}</div>
    </div>
    <div class="card">
      <label style="margin-bottom:8px">有缺漏場次</label>
      <div class="mono" style="font-size:28px;font-weight:700">
        {{ gapCount }}<span style="font-size:14px;font-weight:400;color:var(--ink-soft)"> ／ {{ gapRate }}%</span>
      </div>
    </div>
    <div class="card">
      <label style="margin-bottom:8px">計畫總數</label>
      <div class="mono" style="font-size:28px;font-weight:700">{{ totalPlans }}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <label style="margin-bottom:8px">平均完整度</label>
    <div class="mono" style="font-size:28px;font-weight:700">{{ avgScore }}%</div>
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
