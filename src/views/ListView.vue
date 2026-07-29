<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'
import ActivityFormModal from '../components/ActivityFormModal.vue'
import ActivityEntry from '../components/ActivityEntry.vue'

const router = useRouter()
const db = useDbStore()

const fPlan = ref('')
const fMonth = ref('')
const fGap = ref(false)
const keyword = ref('')
const showCreate = ref(false)

const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const rows = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return db.activities
    .filter((a) => !fPlan.value || a.plans.includes(fPlan.value))
    .filter((a) => !fMonth.value || (a.date || '').startsWith(fMonth.value))
    .filter((a) => !fGap.value || gaps(a).length)
    .filter((a) => !q || [a.name, a.place, a.owner].some((s) => s.toLowerCase().includes(q)))
    .slice()
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''))
})

function clearFilters() {
  fPlan.value = ''
  fMonth.value = ''
  fGap.value = false
  keyword.value = ''
}

function openDetail(id: string) {
  router.push({ name: 'detail', params: { id } })
}
</script>

<template>
  <h1>活動列表</h1>
  <p class="sub">一個活動建立一次，可掛在多個計畫底下重複使用。</p>
  <div class="row" style="margin-bottom:18px">
    <button class="btn" @click="showCreate = true">建立活動</button>
    <input v-model="keyword" placeholder="搜尋活動名稱／地點／負責人" style="width:220px">
    <select v-model="fPlan" style="width:190px">
      <option value="">全部計畫</option>
      <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <input type="month" v-model="fMonth" style="width:150px">
    <button class="btn ghost sm" @click="clearFilters">清除篩選</button>
    <label class="chk" style="margin:0 0 0 auto"><input type="checkbox" v-model="fGap">只看有缺漏</label>
  </div>

  <div class="ledger">
    <ActivityEntry
      v-for="a in rows"
      :key="a.id"
      :activity="a"
      :plan-name="planName"
      @click="openDetail(a.id)"
    />
  </div>
  <p v-if="!rows.length" class="empty">{{ db.loading ? '載入中…' : '這個條件下沒有活動。' }}</p>

  <ActivityFormModal v-if="showCreate" @close="showCreate = false" />
</template>
