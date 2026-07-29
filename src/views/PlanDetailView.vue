<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'
import ActivityEntry from '../components/ActivityEntry.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const db = useDbStore()

const plan = computed(() => db.plans.find((p) => p.id === props.id))
const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const activities = computed(() =>
  db.activities
    .filter((a) => a.plans.includes(props.id))
    .slice()
    .sort((x, y) => (y.date || '').localeCompare(x.date || '')),
)

function openDetail(id: string) {
  router.push({ name: 'detail', params: { id } })
}
</script>

<template>
  <div v-if="plan">
    <button class="back" @click="router.push({ name: 'plans' })">← 回計畫列表</button>
    <h1>{{ plan.name }}</h1>
    <p class="sub mono">
      {{ activities.length }} 場活動　·　{{ activities.filter((a) => gaps(a).length).length }} 場有缺漏
    </p>

    <div class="ledger">
      <ActivityEntry
        v-for="a in activities"
        :key="a.id"
        :activity="a"
        :plan-name="planName"
        @click="openDetail(a.id)"
      />
    </div>
    <p v-if="!activities.length" class="empty">這個計畫底下還沒有活動。</p>
  </div>
  <p v-else class="empty">{{ db.loading ? '載入中…' : '找不到這個計畫。' }}</p>
</template>
