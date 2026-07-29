<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps, nFiles, score } from '../utils/activity'
import ActivityFormModal from '../components/ActivityFormModal.vue'

const router = useRouter()
const db = useDbStore()

const fPlan = ref('')
const fMonth = ref('')
const fGap = ref(false)
const showCreate = ref(false)

const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const rows = computed(() =>
  db.activities
    .filter((a) => !fPlan.value || a.plans.includes(fPlan.value))
    .filter((a) => !fMonth.value || (a.date || '').startsWith(fMonth.value))
    .filter((a) => !fGap.value || gaps(a).length)
    .slice()
    .sort((x, y) => (y.date || '').localeCompare(x.date || '')),
)

function clearFilters() {
  fPlan.value = ''
  fMonth.value = ''
  fGap.value = false
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
    <select v-model="fPlan" style="width:190px">
      <option value="">全部計畫</option>
      <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <input type="month" v-model="fMonth" style="width:150px">
    <button class="btn ghost sm" @click="clearFilters">清除篩選</button>
    <label class="chk" style="margin:0 0 0 auto"><input type="checkbox" v-model="fGap">只看有缺漏</label>
  </div>

  <div class="ledger">
    <button v-for="a in rows" :key="a.id" class="entry" @click="openDetail(a.id)">
      <span class="date mono">{{ a.date || '未定日期' }}</span>
      <span>
        <span class="name">{{ a.name }}</span>
        <span class="meta">{{ a.place || '—' }}　·　{{ a.owner || '未指定負責人' }}　·　檔案 {{ nFiles(a) }} 件</span>
      </span>
      <span class="plans">
        <template v-if="a.plans.length">
          <span v-for="pid in a.plans" :key="pid" class="tag">{{ planName(pid) }}</span>
        </template>
        <span v-else class="tag">未歸計畫</span>
      </span>
      <div class="dial">
        <div class="bars">
          <i v-for="i in 5" :key="i" :class="i - 1 < 5 - gaps(a).length ? 'on' : 'gap'"></i>
        </div>
        <span class="pct mono">{{ score(a) }}%</span>
      </div>
    </button>
  </div>
  <p v-if="!rows.length" class="empty">{{ db.loading ? '載入中…' : '這個條件下沒有活動。' }}</p>

  <ActivityFormModal v-if="showCreate" @close="showCreate = false" />
</template>
