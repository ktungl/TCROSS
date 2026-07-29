<script setup lang="ts">
import { ref } from 'vue'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'

const db = useDbStore()
const planName = ref('')

async function addPlan() {
  const n = planName.value.trim()
  if (!n) return
  await db.createPlan(n)
  planName.value = ''
}

async function removePlan(id: string) {
  await db.deletePlan(id)
}
</script>

<template>
  <h1>計畫</h1>
  <p class="sub">計畫是活動的收納夾，一個活動可以同時屬於多個計畫。</p>
  <div class="card" style="margin-bottom:20px">
    <div class="row">
      <input v-model="planName" placeholder="計畫名稱，例如：2026 社區共好計畫" style="flex:1;min-width:220px" @keyup.enter="addPlan">
      <button class="btn" @click="addPlan">新增計畫</button>
    </div>
  </div>

  <div v-for="p in db.plans" :key="p.id" class="card" style="margin-bottom:10px">
    <div class="row" style="justify-content:space-between">
      <div>
        <strong>{{ p.name }}</strong>
        <div class="meta" style="font-size:12px;color:var(--ink-soft)">
          {{ db.activities.filter(a => a.plans.includes(p.id)).length }} 場活動　·
          {{ db.activities.filter(a => a.plans.includes(p.id) && gaps(a).length).length }} 場有缺漏
        </div>
      </div>
      <button class="x" title="刪除計畫" @click="removePlan(p.id)">×</button>
    </div>
  </div>
  <p v-if="!db.plans.length" class="empty" style="padding:0">還沒有計畫。</p>
</template>
