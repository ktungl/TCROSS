<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps, kb } from '../utils/activity'
import { FOLDERS } from '../types'
import type { Kpi } from '../types'
import type { GeneratedFormKind } from '../utils/download'
import ActivityFormModal from '../components/ActivityFormModal.vue'
import GeneratedDocModal from '../components/GeneratedDocModal.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const db = useDbStore()

const activity = computed(() => db.activities.find((a) => a.id === props.id))
const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const summaryDraft = ref('')
const kpisDraft = ref<Kpi[]>([])

watch(
  activity,
  (a) => {
    if (a) {
      summaryDraft.value = a.summary
      kpisDraft.value = a.kpis.map((k) => ({ ...k }))
    }
  },
  { immediate: true },
)

const showEdit = ref(false)
const genKind = ref<GeneratedFormKind | null>(null)

async function togglePlan(planId: string, checked: boolean) {
  if (!activity.value) return
  const next = checked
    ? [...activity.value.plans, planId]
    : activity.value.plans.filter((p) => p !== planId)
  await db.setActivityPlans(activity.value.id, next)
}

function addKpi() {
  kpisDraft.value.push({ k: '', v: '', u: '' })
}
function removeKpi(i: number) {
  kpisDraft.value.splice(i, 1)
}
async function saveResults() {
  if (!activity.value) return
  const cleaned = kpisDraft.value.filter((k) => k.k.trim())
  await db.saveActivityResults(activity.value.id, summaryDraft.value, cleaned)
}

async function onUpload(folder: (typeof FOLDERS)[number][0], e: Event) {
  if (!activity.value) return
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) await db.uploadFiles(activity.value.id, folder, files)
}
async function onRemoveFile(folder: (typeof FOLDERS)[number][0], i: number) {
  if (!activity.value) return
  await db.removeFile(activity.value.id, folder, i)
}
</script>

<template>
  <div v-if="activity">
    <button class="back" @click="router.push({ name: 'list' })">← 回活動列表</button>
    <h1>{{ activity.name }}</h1>
    <p class="sub mono">{{ activity.date || '未定日期' }}　{{ activity.place }}　負責人 {{ activity.owner || '—' }}　參與 {{ activity.headcount || 0 }} 人</p>

    <div class="row" style="margin-bottom:6px">
      <button class="btn ghost sm" @click="showEdit = true">編輯基本資料</button>
      <button class="btn ghost sm" @click="genKind = '簽到表'">產生簽到表</button>
      <button class="btn ghost sm" @click="genKind = '領據'">產生領據</button>
      <button class="btn ghost sm" @click="genKind = '活動紀錄表'">產生活動紀錄表</button>
    </div>

    <div v-if="gaps(activity).length" class="flagbox">
      <b>缺漏提醒</b>　{{ gaps(activity).join('、') }}
    </div>
    <div v-else class="flagbox" style="border-color:var(--ok);background:#EDF4F1">
      <b style="color:var(--ok)">資料齊全</b>　可直接納入成果報告。
    </div>

    <h2>對應計畫</h2>
    <div class="card">
      <label v-for="p in db.plans" :key="p.id" class="chk" style="margin-bottom:6px">
        <input
          type="checkbox"
          :value="p.id"
          :checked="activity.plans.includes(p.id)"
          @change="togglePlan(p.id, ($event.target as HTMLInputElement).checked)"
        >{{ p.name }}
      </label>
      <span v-if="!db.plans.length" class="empty" style="padding:0">還沒有計畫，先到「計畫」頁新增。</span>
    </div>

    <h2>活動資料</h2>
    <div>
      <div v-for="[key, label] in FOLDERS" :key="key" class="folder">
        <header>
          <h3>{{ label }} <span class="count">{{ activity.files[key].length }} 件</span></h3>
          <label class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0">上傳
            <input type="file" multiple style="display:none" @change="onUpload(key, $event)">
          </label>
        </header>
        <ul v-if="activity.files[key].length" class="files">
          <li v-for="(f, i) in activity.files[key]" :key="i">
            <span class="fname">{{ f.name }}</span>
            <span style="display:flex;align-items:center">
              <span class="fsize mono">{{ kb(f.size) }}</span>
              <button class="x" @click="onRemoveFile(key, i)">×</button>
            </span>
          </li>
        </ul>
        <p v-else class="empty">還沒有{{ label }}。</p>
      </div>
    </div>

    <h2>成果補充</h2>
    <div class="card">
      <label>成果摘要</label>
      <textarea v-model="summaryDraft" placeholder="這場活動做了什麼、達成什麼，三到五句。"></textarea>
      <label style="margin-top:16px">KPI</label>
      <div>
        <div v-for="(k, i) in kpisDraft" :key="i" class="kpi">
          <input v-model="k.k" placeholder="指標名稱，例如 受益人數">
          <input v-model="k.v" placeholder="數值" type="number">
          <input v-model="k.u" placeholder="單位">
          <button class="x" title="刪除" @click="removeKpi(i)">×</button>
        </div>
        <p v-if="!kpisDraft.length" class="empty" style="padding:0 0 8px">還沒有 KPI。</p>
      </div>
      <button class="btn ghost sm" @click="addKpi">新增一列 KPI</button>
      <div style="margin-top:16px"><button class="btn" @click="saveResults">儲存成果</button></div>
    </div>

    <ActivityFormModal v-if="showEdit" :activity="activity" @close="showEdit = false" />
    <GeneratedDocModal v-if="genKind" :activity="activity" :kind="genKind" :plan-name="planName" @close="genKind = null" />
  </div>
  <p v-else class="empty">{{ db.loading ? '載入中…' : '找不到這個活動。' }}</p>
</template>
