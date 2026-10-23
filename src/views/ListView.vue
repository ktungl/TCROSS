<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { useActivityActions } from '../composables/useActivityActions'
import { gaps } from '../utils/activity'
import ActivityFormModal from '../components/ActivityFormModal.vue'
import ActivityEntry from '../components/ActivityEntry.vue'

const route = useRoute()
const router = useRouter()
const db = useDbStore()
const { duplicate, toggleArchive } = useActivityActions()

const fPlan = ref('')
const fMonth = ref('')
// 從總覽「有缺漏活動」點進來時帶 ?gap=1，直接勾好「只看有缺漏」
const fGap = ref(route.query.gap === '1')
// 平常只看進行中的活動，封存的收起來；從總覽點進來時總覽的數字含封存活動，所以改看全部才對得上
type ArchiveFilter = 'all' | 'active' | 'archived'
const DEFAULT_ARCHIVE_FILTER: ArchiveFilter = 'active'
const fArchive = ref<ArchiveFilter>(fGap.value ? 'all' : DEFAULT_ARCHIVE_FILTER)
const keyword = ref('')
const showCreate = ref(false)

const archivedCount = computed(() => db.activities.filter((a) => a.archivedAt).length)

const rows = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return db.activities
    .filter((a) => fArchive.value === 'all' || (fArchive.value === 'archived') === !!a.archivedAt)
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
  fArchive.value = DEFAULT_ARCHIVE_FILTER
  keyword.value = ''
}

function openDetail(id: string) {
  router.push({ name: 'detail', params: { id } })
}
</script>

<template>
  <h1>活動列表</h1>
  <p class="sub">一個活動建立一次，可掛在多個計畫底下重複使用。</p>
  <div class="row toolbar">
    <button class="btn" @click="showCreate = true">建立活動</button>
    <input class="f-search" v-model="keyword" placeholder="搜尋活動名稱／地點／負責人">
    <select class="f-plan" v-model="fPlan">
      <option value="">全部計畫</option>
      <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <input class="f-narrow" type="month" v-model="fMonth">
    <select class="f-narrow" v-model="fArchive" aria-label="封存狀態">
      <option value="active">進行中</option>
      <option value="archived">已封存（{{ archivedCount }}）</option>
      <option value="all">全部</option>
    </select>
    <button class="btn ghost sm" @click="clearFilters">清除篩選</button>
    <label class="chk" style="margin-left:auto"><input type="checkbox" v-model="fGap">只看有缺漏</label>
  </div>

  <div class="ledger">
    <ActivityEntry
      v-for="a in rows"
      :key="a.id"
      :activity="a"
      :plan-name="db.planName"
      @click="openDetail(a.id)"
      @duplicate="duplicate(a.id)"
      @archive="toggleArchive(a)"
    />
  </div>
  <p v-if="!rows.length" class="empty">{{ db.loading ? '載入中…' : '目前篩選條件下沒有活動。' }}</p>
  <p v-if="!db.loading && fArchive === 'active' && archivedCount" class="hint">
    另有 {{ archivedCount }} 個已封存的活動沒有列出，<button type="button" class="link" @click="fArchive = 'all'">顯示全部</button>
  </p>

  <ActivityFormModal v-if="showCreate" @close="showCreate = false" />
</template>
