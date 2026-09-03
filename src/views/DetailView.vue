<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps, kb } from '../utils/activity'
import { ATTACHMENT_TYPES, PHOTO_MAX, PHOTO_MIN } from '../types'
import type { AttachmentKey, Kpi } from '../types'
import type { GeneratedFormKind } from '../utils/download'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import ActivityFormModal from '../components/ActivityFormModal.vue'
import GeneratedDocModal from '../components/GeneratedDocModal.vue'
import AiGenerationModal from '../components/AiGenerationModal.vue'
import FolderDropzone from '../components/FolderDropzone.vue'

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
const showAiGenModal = ref(false)

async function togglePlan(planId: string, checked: boolean) {
  if (!activity.value) return
  const next = checked
    ? [...activity.value.plans, planId]
    : activity.value.plans.filter((p) => p !== planId)
  try {
    await db.setActivityPlans(activity.value.id, next)
    pushToast('已更新對應計畫')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
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
  try {
    await db.saveActivityResults(activity.value.id, summaryDraft.value, cleaned)
    pushToast('已儲存成果')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function upload(folder: AttachmentKey, files: File[]) {
  if (!activity.value || !files.length) return
  try {
    await db.uploadFiles(activity.value.id, folder, files)
    pushToast(`已上傳 ${files.length} 個檔案`)
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
async function onRemoveFile(folder: AttachmentKey, i: number) {
  if (!activity.value) return
  const name = activity.value.files[folder][i]?.name ?? '此檔案'
  if (!(await confirm(`確定要刪除「${name}」嗎？`))) return
  try {
    await db.removeFile(activity.value.id, folder, i)
    pushToast('已刪除檔案')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
async function onCaptionChange(folder: AttachmentKey, i: number, e: Event) {
  if (!activity.value) return
  const caption = (e.target as HTMLInputElement).value
  try {
    await db.updateFileMeta(activity.value.id, folder, i, { caption })
  } catch (e2) {
    pushToast(errorMessage(e2), 'error')
  }
}
async function onFeaturedToggle(folder: AttachmentKey, i: number, e: Event) {
  if (!activity.value) return
  const featured = (e.target as HTMLInputElement).checked
  try {
    await db.updateFileMeta(activity.value.id, folder, i, { featured })
  } catch (e2) {
    pushToast(errorMessage(e2), 'error')
  }
}

async function deleteActivity() {
  if (!activity.value) return
  if (!(await confirm(`確定要刪除「${activity.value.name}」嗎？此動作無法復原，所有附件與資料都會一併刪除。`))) return
  try {
    await db.deleteActivity(activity.value.id)
    pushToast('已刪除活動')
    router.push({ name: 'list' })
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function duplicateActivity() {
  if (!activity.value) return
  try {
    const created = await db.createActivity({
      name: `${activity.value.name}（複製）`,
      category: activity.value.category,
      date: '',
      dateEnd: '',
      place: activity.value.place,
      owner: activity.value.owner,
      attendees: activity.value.attendees,
      participantDesc: activity.value.participantDesc,
      headcount: { ...activity.value.headcount },
      plans: [...activity.value.plans],
      remark: activity.value.remark,
    })
    pushToast('已複製活動，請填寫新日期')
    router.push({ name: 'detail', params: { id: created.id } })
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
</script>

<template>
  <div v-if="activity">
    <button class="back" @click="router.push({ name: 'list' })">← 回活動列表</button>
    <h1>{{ activity.name }}</h1>
    <p class="sub mono">
      {{ activity.date || '未定日期' }}<template v-if="activity.dateEnd && activity.dateEnd !== activity.date">～{{ activity.dateEnd }}</template>
      　{{ activity.place }}　{{ activity.category || '未分類' }}　負責人 {{ activity.owner || '—' }}
      　男 {{ activity.headcount.male }}／女 {{ activity.headcount.female }}／合計 {{ activity.headcount.total }} 人
    </p>
    <p v-if="activity.attendees || activity.participantDesc" class="sub" style="margin-top:-8px">
      <template v-if="activity.attendees">與會單位或成員：{{ activity.attendees }}　</template>
      <template v-if="activity.participantDesc">參加對象：{{ activity.participantDesc }}</template>
    </p>
    <p v-if="activity.remark" class="sub" style="margin-top:-8px">備註：{{ activity.remark }}</p>

    <div class="row" style="margin-bottom:6px">
      <button class="btn ghost sm" @click="showEdit = true">編輯基本資料</button>
      <button class="btn ghost sm" @click="duplicateActivity">複製此活動</button>
      <button class="btn ghost sm" @click="genKind = '簽到表'">產生簽到表</button>
      <button class="btn ghost sm" @click="genKind = '領據'">產生領據</button>
      <button class="btn ghost sm" @click="genKind = '活動紀錄表'">產生活動紀錄表</button>
      <button class="btn ghost sm" @click="showAiGenModal = true">AI 自動生成成果報告</button>
      <button class="btn ghost sm" style="color:var(--stamp);margin-left:auto" @click="deleteActivity">刪除此活動</button>
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
      <FolderDropzone
        v-for="[key, label] in ATTACHMENT_TYPES"
        :key="key"
        :label="label"
        :count-label="
          key === 'photo'
            ? `${activity.files[key].length} 件（需 ${PHOTO_MIN}–${PHOTO_MAX} 張）`
            : `${activity.files[key].length} 件`
        "
        pick-label="上傳"
        @pick="(files) => upload(key, files)"
        @drop="(files) => upload(key, files)"
      >
        <ul v-if="activity.files[key].length" class="files">
          <li v-for="(f, i) in activity.files[key]" :key="i" :style="key === 'photo' ? 'flex-wrap:wrap' : ''">
            <span v-if="key === 'photo' && f.url" style="display:flex;align-items:center;gap:8px;overflow:hidden">
              <img :src="f.url" class="thumb" :alt="f.name">
              <span class="fname">{{ f.name }}</span>
            </span>
            <span v-else class="fname">{{ f.name }}</span>
            <span style="display:flex;align-items:center">
              <span class="fsize mono">{{ kb(f.size) }}</span>
              <button class="x" @click="onRemoveFile(key, i)">×</button>
            </span>
            <div v-if="key === 'photo'" style="display:flex;align-items:center;gap:10px;width:100%;margin-top:6px">
              <input
                :value="f.caption"
                placeholder="圖說（必填）"
                style="flex:1"
                @change="onCaptionChange(key, i, $event)"
              >
              <label class="chk" style="margin:0;white-space:nowrap">
                <input
                  type="checkbox"
                  :checked="f.featured"
                  @change="onFeaturedToggle(key, i, $event)"
                >精選照片
              </label>
            </div>
          </li>
        </ul>
        <p v-else class="empty">還沒有{{ label }}。拖曳檔案到這裡或按上傳。</p>
      </FolderDropzone>
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
    <AiGenerationModal v-if="showAiGenModal" :activity="activity" @close="showAiGenModal = false" />
  </div>
  <p v-else class="empty">{{ db.loading ? '載入中…' : '找不到這個活動。' }}</p>
</template>
