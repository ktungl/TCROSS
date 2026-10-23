<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { attachmentSrc } from '../lib/attachments'
import { checkResults, consistencyConfirmMessage, gaps, googleMapsUrl, kb } from '../utils/activity'
import { actorLine } from '../utils/actor'
import { ATTACHMENT_HINTS, ATTACHMENT_TYPES, LEDGER_PHOTO_MAX, PHOTO_MAX, PHOTO_MIN } from '../types'
import type { AttachmentKey, AuditLogRecord, Kpi } from '../types'
import type { GeneratedFormKind } from '../utils/download'
import { confirm } from '../composables/useConfirm'
import { onClickOutside } from '../composables/useClickOutside'
import { downloadFiles } from '../utils/fileDownload'
import { errorMessage, pushToast } from '../composables/useToast'
import ActivityFormModal from '../components/ActivityFormModal.vue'
import GeneratedDocModal from '../components/GeneratedDocModal.vue'
import AiGenerationModal from '../components/AiGenerationModal.vue'
import RewriteModal from '../components/RewriteModal.vue'
import SignInReviewModal from '../components/SignInReviewModal.vue'
import DocumentDigestModal from '../components/DocumentDigestModal.vue'
import FolderDropzone from '../components/FolderDropzone.vue'
import HistoryFilePickerModal from '../components/HistoryFilePickerModal.vue'
import StampLine from '../components/StampLine.vue'
import AuditLogList from '../components/AuditLogList.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const db = useDbStore()

const activity = computed(() => db.activities.find((a) => a.id === props.id))
const ledgerCount = computed(() => activity.value?.files.photo.filter((f) => f.ledger).length ?? 0)
/** 精選照片依目前的呈現順序（= 照片陣列裡的先後） */
const featuredUrls = computed(() => activity.value?.files.photo.filter((f) => f.featured).map((f) => f.url) ?? [])
const savingOrder = ref(false)

/** 把這張精選照片移到第 position 位（1 起算），其他精選照片依序往前或往後挪 */
async function onFeaturedOrderChange(url: string, e: Event) {
  if (!activity.value) return
  const select = e.target as HTMLSelectElement
  const position = Number(select.value)
  const order = featuredUrls.value.filter((u) => u !== url)
  order.splice(position - 1, 0, url)
  savingOrder.value = true
  try {
    await db.reorderFeaturedPhotos(activity.value.id, order)
    // 精選勾選剛好被改掉時 store 會略過不存，不能顯示成功
    if (featuredUrls.value.join('\n') !== order.join('\n')) throw new Error('精選照片剛有變動，請重新調整順序')
    pushToast('已更新呈現順序')
  } catch (e2) {
    // 沒存成功時資料沒變，Vue 不會重畫下拉選單，要自己把顯示值改回目前的位置
    select.value = String(featuredUrls.value.indexOf(url) + 1)
    pushToast(errorMessage(e2), 'error')
  } finally {
    savingOrder.value = false
  }
}

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
const GEN_KINDS: GeneratedFormKind[] = ['簽到表', '領據', '活動紀錄表', '成果報告', '公文']
const genMenuOpen = ref(false)
const genMenuRoot = ref<HTMLElement | null>(null)
onClickOutside(genMenuRoot, () => (genMenuOpen.value = false))
const showAiGenModal = ref(false)
const showMeetingModal = ref(false)
const showRewriteModal = ref(false)
const showSignInModal = ref(false)
const showDocumentModal = ref(false)
const pickerFolder = ref<AttachmentKey | null>(null)

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
const resultIssues = computed(() =>
  activity.value ? checkResults(activity.value, summaryDraft.value, kpisDraft.value) : [],
)

async function saveResults() {
  if (!activity.value) return
  const issues = resultIssues.value
  if (issues.length && !(await confirm(consistencyConfirmMessage(issues), '仍要儲存'))) {
    return
  }
  // Cloud Code 要求 k/v/u 都必須是字串；舊資料或曾經用 REST API 寫入的 KPI 可能帶著數字型別的
  // v/u 混進來，這裡存檔前強制轉成字串，避免「kpis 陣列項目格式不正確」被伺服器擋下。
  const cleaned = kpisDraft.value
    .filter((k) => String(k.k ?? '').trim())
    .map((k) => ({ k: String(k.k ?? '').trim(), v: String(k.v ?? ''), u: String(k.u ?? '') }))
  try {
    await db.saveActivityResults(activity.value.id, summaryDraft.value, cleaned)
    pushToast('已儲存成果')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

const uploadingFiles = reactive<Record<AttachmentKey, { name: string; progress: number }[]>>({
  registration: [], content: [], photo: [], signIn: [], record: [], agenda: [], document: [], receipt: [], social: [], media: [],
})

async function upload(folder: AttachmentKey, files: File[]) {
  if (!activity.value || !files.length) return
  const items = files.map((file) => ({ name: file.name, progress: 0 }))
  uploadingFiles[folder] = items
  try {
    await db.uploadFiles(activity.value.id, folder, files, (file, fraction) => {
      const item = items[files.indexOf(file)]
      if (item) item.progress = fraction
    })
    pushToast(`已上傳 ${files.length} 個檔案`)
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    uploadingFiles[folder] = []
  }
}
async function onRemoveFile(folder: AttachmentKey, i: number) {
  if (!activity.value) return
  const name = activity.value.files[folder][i]?.name ?? '此檔案'
  if (!(await confirm(`確定要把「${name}」移到垃圾桶嗎？之後可以在「歷史檔案」頁復原或永久刪除。`, '移到垃圾桶'))) return
  try {
    await db.trashFile(activity.value.id, folder, i)
    pushToast('已移到垃圾桶')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
// 圖說草稿（key 是照片 url）：輸入框顯示草稿而不是已儲存的值，這樣別張照片存檔完成、
// 整份照片清單重畫時，正在打、還沒存的字不會被洗回舊值。
const CAPTION_AUTOSAVE_MS = 800
const captionDrafts = reactive(new Map<string, string>())
const captionStatus = reactive(new Map<string, 'saving' | 'saved' | 'error'>())
/** 每張照片還在跑的圖說存檔數量 */
const captionInFlight = new Map<string, number>()
const captionTimers = new Map<string, { folder: AttachmentKey; timer: ReturnType<typeof setTimeout> }>()

function onCaptionInput(folder: AttachmentKey, url: string, e: Event) {
  captionDrafts.set(url, (e.target as HTMLInputElement).value)
  captionStatus.delete(url)
  clearTimeout(captionTimers.get(url)?.timer)
  // 停止打字一小段時間就自動存，不用等離開輸入框
  captionTimers.set(url, { folder, timer: setTimeout(() => saveCaption(folder, url), CAPTION_AUTOSAVE_MS) })
}

async function saveCaption(folder: AttachmentKey, url: string) {
  clearTimeout(captionTimers.get(url)?.timer)
  captionTimers.delete(url)
  const caption = captionDrafts.get(url)
  if (caption === undefined || !activity.value) return
  const index = activity.value.files[folder].findIndex((f) => f.url === url)
  if (index < 0) {
    captionDrafts.delete(url)
    return
  }
  // 內容跟已儲存的一樣就不用存；但同一張還有存檔在跑時，已儲存的值還沒更新，不能省略
  if (!captionInFlight.get(url) && (activity.value.files[folder][index].caption ?? '') === caption) {
    captionDrafts.delete(url)
    return
  }
  captionStatus.set(url, 'saving')
  captionInFlight.set(url, (captionInFlight.get(url) ?? 0) + 1)
  try {
    await db.updateFileMeta(activity.value.id, folder, index, { caption })
    // 存檔期間又繼續打字的話保留草稿，交給下一次存檔
    if (captionDrafts.get(url) === caption) {
      captionDrafts.delete(url)
      captionStatus.set(url, 'saved')
    }
  } catch (e) {
    // 失敗時保留草稿，輸入框裡的字不會不見，使用者可以再離開輸入框重試
    captionStatus.set(url, 'error')
    pushToast(`圖說沒有儲存成功：${errorMessage(e)}`, 'error')
  } finally {
    const left = (captionInFlight.get(url) ?? 1) - 1
    if (left) captionInFlight.set(url, left)
    else captionInFlight.delete(url)
  }
}

// 離開頁面時，把還在等自動存檔的圖說立刻存掉
onBeforeUnmount(() => {
  for (const [url, { folder }] of [...captionTimers]) void saveCaption(folder, url)
})
async function onFeaturedToggle(folder: AttachmentKey, i: number, e: Event) {
  if (!activity.value) return
  const featured = (e.target as HTMLInputElement).checked
  try {
    await db.updateFileMeta(activity.value.id, folder, i, { featured })
    pushToast(featured ? '已設為精選照片' : '已取消精選照片')
  } catch (e2) {
    pushToast(errorMessage(e2), 'error')
  }
}

const downloadingAll = ref('')
const totalAttachments = computed(() =>
  activity.value ? ATTACHMENT_TYPES.reduce((n, [key]) => n + activity.value!.files[key].length, 0) : 0,
)

/** 一鍵下載這個活動所有附件（不含垃圾桶），依分類放進 zip 裡的資料夾。 */
async function downloadAllAttachments() {
  const a = activity.value
  if (!a || downloadingAll.value) return
  const items = ATTACHMENT_TYPES.flatMap(([key, label], i) =>
    a.files[key].map((f) => ({ name: f.name, url: f.url, folder: `${String(i + 1).padStart(2, '0')}_${label}` })),
  )
  if (!items.length) return
  downloadingAll.value = '準備下載…'
  try {
    const { failed } = await downloadFiles(
      items,
      `${a.date ? `${a.date}_` : ''}${a.name || '活動'}_附件`,
      (done, total) => (downloadingAll.value = `下載中 ${done}/${total}…`),
    )
    if (failed.length) pushToast(`有 ${failed.length} 個檔案下載失敗：${failed.join('、')}`, 'error')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloadingAll.value = ''
  }
}

async function onLedgerToggle(folder: AttachmentKey, i: number, e: Event) {
  if (!activity.value) return
  const input = e.target as HTMLInputElement
  const ledger = input.checked
  if (ledger && ledgerCount.value >= LEDGER_PHOTO_MAX) {
    input.checked = false
    pushToast(`大紀事照片最多 ${LEDGER_PHOTO_MAX} 張，請先取消其他照片`, 'error')
    return
  }
  try {
    await db.updateFileMeta(activity.value.id, folder, i, { ledger })
  } catch (e2) {
    input.checked = !ledger
    pushToast(errorMessage(e2), 'error')
  }
}

async function deleteActivity() {
  if (!activity.value) return
  if (!(await confirm(`確定要刪除「${activity.value.name}」嗎？此動作無法復原，活動會從系統中移除；已上傳的附件檔案與 AI 生成紀錄不會一併刪除。`, '刪除活動', true))) return
  try {
    await db.deleteActivity(activity.value.id)
    pushToast('已刪除活動')
    router.push({ name: 'list' })
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

const activityLogs = ref<AuditLogRecord[]>([])
const logsOpen = ref(false)
const logsLoading = ref(false)

async function loadActivityLogs() {
  if (!activity.value) return
  logsLoading.value = true
  try {
    activityLogs.value = await db.fetchAuditLogs({ activityId: activity.value.id, limit: 200 })
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    logsLoading.value = false
  }
}

function onLogsToggle(e: Event) {
  logsOpen.value = (e.target as HTMLDetailsElement).open
  if (logsOpen.value) loadActivityLogs()
}

// 紀錄展開時，這個活動一有修改就重新抓，剛做的動作馬上看得到
watch(
  () => activity.value?.updatedAt,
  () => {
    if (logsOpen.value) loadActivityLogs()
  },
)

const archived = computed(() => !!activity.value?.archivedAt)

async function toggleArchive() {
  if (!activity.value) return
  const next = !archived.value
  const message = next
    ? `確定要封存「${activity.value.name}」嗎？封存後內容仍可檢視，但不能編輯、上傳或刪除，需要時可再解除封存。`
    : `確定要解除封存「${activity.value.name}」嗎？解除後就可以再編輯。`
  if (!(await confirm(message, next ? '封存' : '解除封存'))) return
  try {
    await db.setActivityArchived(activity.value.id, next)
    pushToast(next ? '已封存活動' : '已解除封存，可以編輯了')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function duplicateActivity() {
  if (!activity.value) return
  try {
    const created = await db.duplicateActivity(activity.value.id)
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
      {{ activity.date || '未定日期' }}<template v-if="activity.time">　{{ activity.time }}<template v-if="activity.timeEnd && activity.timeEnd !== activity.time">～{{ activity.timeEnd }}</template></template>
      <template v-if="activity.placeMode === 'online'">　線上<template v-if="activity.meetingUrl">（<a :href="activity.meetingUrl" target="_blank" rel="noopener">會議連結</a>）</template></template>
      <template v-else>　<template v-if="activity.venue">{{ activity.venue }}　</template><a v-if="activity.place" :href="googleMapsUrl(activity.place)" target="_blank" rel="noopener">{{ activity.place }}</a><template v-else>—</template><template v-if="activity.placeMode === 'hybrid'">＋線上<template v-if="activity.meetingUrl">（<a :href="activity.meetingUrl" target="_blank" rel="noopener">會議連結</a>）</template></template></template>
      　{{ activity.categories.length ? activity.categories.join('、') : '未分類' }}　負責人 {{ activity.owner || '未指定' }}
      　男 {{ activity.headcount.male }}／女 {{ activity.headcount.female }}／合計 {{ activity.headcount.total }} 人
    </p>
    <p v-if="activity.attendees || activity.participantDesc" class="sub sub-extra">
      <template v-if="activity.attendees">與會單位或成員：{{ activity.attendees }}　</template>
      <template v-if="activity.participantDesc">參加對象：{{ activity.participantDesc }}</template>
    </p>
    <p v-if="activity.remark" class="sub sub-extra">備註：{{ activity.remark }}</p>
    <p class="sub sub-extra"><StampLine :record="activity" /></p>

    <div v-if="archived" class="flagbox">
      <b>已封存</b>　{{ actorLine(activity.archivedByName, activity.archivedAt) }}　內容只能檢視，要修改請按「解除封存」。
    </div>

    <!-- 一般操作在左、刪除獨立在右；換行時刪除自成一組，不會緊貼一般按鈕 -->
    <div class="row between detail-toolbar">
      <div class="row">
        <button class="btn sm" @click="showAiGenModal = true">AI 自動生成成果報告</button>
        <button class="btn ghost sm" @click="showRewriteModal = true">AI 改寫文案</button>
        <button class="btn ghost sm" @click="showMeetingModal = true">AI 會議音檔轉錄紀錄</button>
        <div ref="genMenuRoot" class="menu">
          <button
            class="btn ghost sm"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="genMenuOpen"
            @click="genMenuOpen = !genMenuOpen"
          >產生文件 ▾</button>
          <div v-if="genMenuOpen" class="menu-panel" role="menu">
            <button
              v-for="k in GEN_KINDS"
              :key="k"
              type="button"
              role="menuitem"
              @click="genKind = k; genMenuOpen = false"
            >{{ k }}</button>
          </div>
        </div>
        <button v-if="!archived" class="btn ghost sm" @click="showEdit = true">編輯基本資料</button>
        <button class="btn ghost sm" @click="duplicateActivity">複製此活動</button>
      </div>
      <div class="row">
        <button class="btn ghost sm" @click="toggleArchive">{{ archived ? '解除封存' : '封存此活動' }}</button>
        <button v-if="!archived" class="btn ghost sm danger" @click="deleteActivity">刪除此活動</button>
      </div>
    </div>

    <div v-if="gaps(activity).length" class="flagbox">
      <b>缺漏提醒</b>　{{ gaps(activity).join('、') }}
    </div>
    <div v-else class="flagbox ok">
      <b>資料齊全</b>　可直接納入成果報告。
    </div>

    <h2>對應計畫</h2>
    <div class="card">
      <label v-for="p in db.plans" :key="p.id" class="chk check-item">
        <input
          type="checkbox"
          :value="p.id"
          :checked="activity.plans.includes(p.id)"
          :disabled="archived"
          @change="togglePlan(p.id, ($event.target as HTMLInputElement).checked)"
        >{{ p.name }}
      </label>
      <span v-if="!db.plans.length" class="empty flush">還沒有計畫，先到「計畫與分類管理」頁新增。</span>
    </div>

    <div class="row between">
      <h2>活動資料</h2>
      <button
        class="btn ghost sm"
       
        :disabled="!totalAttachments || !!downloadingAll"
        :title="totalAttachments ? '依分類打包成 zip 下載（不含垃圾桶）' : '還沒有上傳任何檔案'"
        @click="downloadAllAttachments"
      >{{ downloadingAll || `一鍵下載所有附件（${totalAttachments}）` }}</button>
    </div>
    <div>
      <FolderDropzone
        v-for="[key, label] in ATTACHMENT_TYPES"
        :key="key"
        :label="label"
        :hint="ATTACHMENT_HINTS[key]"
        :count-label="
          key === 'photo'
            ? `${activity.files[key].length} 個（需 ${PHOTO_MIN}–${PHOTO_MAX} 張）　大紀事 ${ledgerCount}/${LEDGER_PHOTO_MAX}`
            : `${activity.files[key].length} 個`
        "
        pick-label="上傳"
        history-pickable
        :readonly="archived"
        :uploading="uploadingFiles[key]"
        @pick="(files) => upload(key, files)"
        @drop="(files) => upload(key, files)"
        @browse-history="pickerFolder = key"
      >
        <ul v-if="activity.files[key].length" class="files">
          <template v-for="(f, i) in activity.files[key]" :key="f.url || i">
            <li v-if="key === 'photo' && f.url" class="photo-item">
              <div class="thumb-wrap">
                <img :src="attachmentSrc(f.url, f.name)" class="thumb-lg" :alt="f.name">
                <button v-if="!archived" class="x" title="移到垃圾桶" @click="onRemoveFile(key, i)">×</button>
              </div>
              <div class="photo-body">
                <div class="photo-head">
                  <span class="fname">{{ f.name }}</span>
                  <span class="fsize mono">{{ kb(f.size) }}</span>
                </div>
                <div class="actor-stamp" style="margin-top:4px">上傳：{{ actorLine(f.uploadedByName, f.uploadedAt) }}</div>
                <div class="photo-caption">
                  <input
                    :value="captionDrafts.get(f.url) ?? f.caption ?? ''"
                    placeholder="圖說（必填）"
                    :readonly="archived"
                    style="flex:1"
                    @input="onCaptionInput(key, f.url, $event)"
                    @change="saveCaption(key, f.url)"
                  >
                  <label class="chk nowrap">
                    <input
                      type="checkbox"
                      :checked="f.featured"
                      :disabled="archived"
                      @change="onFeaturedToggle(key, i, $event)"
                    >精選照片
                  </label>
                  <label v-if="f.featured" class="chk nowrap" title="成果報告依這個順序放精選照片">呈現順序
                    <select
                      class="order-select"
                      :value="featuredUrls.indexOf(f.url) + 1"
                      :disabled="archived || savingOrder"
                      @change="onFeaturedOrderChange(f.url, $event)"
                    >
                      <option v-for="n in featuredUrls.length" :key="n" :value="n">{{ n }}</option>
                    </select>
                  </label>
                  <label class="chk nowrap" title="勾選的照片會放進大紀事 Excel，最多 3 張">
                    <input
                      type="checkbox"
                      :checked="f.ledger"
                      :disabled="archived"
                      @change="onLedgerToggle(key, i, $event)"
                    >大紀事照片
                  </label>
                </div>
                <div v-if="captionStatus.get(f.url)" class="actor-stamp" style="margin-top:4px">
                  {{ { saving: '圖說儲存中…', saved: '圖說已儲存', error: '圖說儲存失敗，離開輸入框可再試一次' }[captionStatus.get(f.url)!] }}
                </div>
              </div>
            </li>
            <li v-else>
              <span class="fname">{{ f.name }}<span class="actor-stamp block">上傳：{{ actorLine(f.uploadedByName, f.uploadedAt) }}</span></span>
              <span style="display:flex;align-items:center">
                <span class="fsize mono">{{ kb(f.size) }}</span>
                <button v-if="!archived" class="x" title="移到垃圾桶" @click="onRemoveFile(key, i)">×</button>
              </span>
            </li>
          </template>
        </ul>
        <p v-else class="empty">還沒有{{ label }}。<template v-if="!archived">拖曳檔案到這裡或按上傳。</template></p>
        <button v-if="key === 'signIn' && !archived" class="btn ghost sm" type="button" @click="showSignInModal = true">AI 辨識簽到表，帶入人數</button>
        <button v-if="key === 'document'" class="btn ghost sm" type="button" @click="showDocumentModal = true">AI 公文快讀</button>
      </FolderDropzone>
    </div>

    <h2>成果補充</h2>
    <div class="card">
      <label>成果摘要</label>
      <textarea v-model="summaryDraft" :readonly="archived" placeholder="這場活動做了什麼、達成什麼，三到五句。"></textarea>
      <label class="field">KPI</label>
      <div>
        <div v-for="(k, i) in kpisDraft" :key="i" class="kpi">
          <input v-model="k.k" :readonly="archived" placeholder="指標名稱，例如 受益人數">
          <input v-model="k.v" :readonly="archived" placeholder="數值，例如 30">
          <input v-model="k.u" :readonly="archived" placeholder="單位">
          <button v-if="!archived" class="x" title="刪除此列" @click="removeKpi(i)">×</button>
        </div>
        <p v-if="!kpisDraft.length" class="empty" style="padding:0 0 8px">還沒有 KPI。</p>
      </div>
      <button v-if="!archived" class="btn ghost sm" @click="addKpi">新增一列 KPI</button>
      <div v-if="resultIssues.length" class="warn-box field">
        <strong>請確認以下內容（不影響儲存）</strong>
        <ul>
          <li v-for="issue in resultIssues" :key="issue">{{ issue }}</li>
        </ul>
      </div>
      <div v-if="!archived" class="actions"><button class="btn" @click="saveResults">儲存成果</button></div>
    </div>

    <h2>操作紀錄</h2>
    <details class="card flush" @toggle="onLogsToggle">
      <summary style="padding:12px 15px;cursor:pointer">顯示這個活動的操作紀錄（含附件與 AI 生成）</summary>
      <p v-if="logsLoading && !activityLogs.length" class="empty">載入中…</p>
      <AuditLogList v-else :logs="activityLogs" hide-activity-link />
    </details>

    <ActivityFormModal v-if="showEdit" :activity="activity" @close="showEdit = false" />
    <GeneratedDocModal v-if="genKind" :activity="activity" :kind="genKind" :plan-name="db.planName" @close="genKind = null" />
    <AiGenerationModal v-if="showAiGenModal" :activity="activity" @close="showAiGenModal = false" />
    <AiGenerationModal v-if="showMeetingModal" :activity="activity" kind="會議紀錄" @close="showMeetingModal = false" />
    <RewriteModal v-if="showRewriteModal" :activity="activity" @close="showRewriteModal = false" />
    <SignInReviewModal v-if="showSignInModal" :activity="activity" @close="showSignInModal = false" />
    <DocumentDigestModal v-if="showDocumentModal" :activity="activity" @close="showDocumentModal = false" />
    <HistoryFilePickerModal
      v-if="pickerFolder"
      :activity-id="activity.id"
      :folder="pickerFolder"
      @close="pickerFolder = null"
    />
  </div>
  <p v-else class="empty">{{ db.loading ? '載入中…' : '找不到這個活動。' }}</p>
</template>
