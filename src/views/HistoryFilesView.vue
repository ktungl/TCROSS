<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { requestDownloadUrl } from '../lib/middleware'
import { attachmentSrc } from '../lib/attachments'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import { kb } from '../utils/activity'
import { UNRECORDED, actorLine } from '../utils/actor'
import StampLine from '../components/StampLine.vue'
import { downloadFiles, todayStamp } from '../utils/fileDownload'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityFiles, ActivityRecord, AttachmentKey, GenerationJobRecord, GenerationJobStatus } from '../types'

const router = useRouter()
const db = useDbStore()

const attachmentLabel = Object.fromEntries(ATTACHMENT_TYPES) as Record<AttachmentKey, string>

const statusLabels: Record<GenerationJobStatus, string> = {
  pending: '待處理',
  processing: '處理中',
  done: '已完成',
  error: '錯誤',
}

const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

onMounted(() => {
  db.fetchAllGenerationJobs().catch((e) => pushToast(errorMessage(e), 'error'))
})

function openDetail(id: string) {
  router.push({ name: 'detail', params: { id } })
}

/** 各區塊共用的多選狀態：用一組 key（字串）記錄目前選取的項目。 */
function useSelection() {
  const selected = ref<Set<string>>(new Set())
  function toggle(key: string) {
    const next = new Set(selected.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selected.value = next
  }
  function isSelected(key: string): boolean {
    return selected.value.has(key)
  }
  function selectAll(keys: string[]) {
    selected.value = new Set(keys)
  }
  function clear() {
    selected.value = new Set()
  }
  function allSelected(keys: string[]): boolean {
    return keys.length > 0 && keys.every((k) => selected.value.has(k))
  }
  return { selected, toggle, isSelected, selectAll, clear, allSelected }
}

/** ---------- 使用方上傳的檔案（各活動的 8 分類附件） ---------- */

const uPlan = ref('')
const uType = ref<AttachmentKey | ''>('')
const uKeyword = ref('')
const uView = ref<'list' | 'grid'>('grid')
const tView = ref<'list' | 'grid'>('grid')

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg']
function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}
function fileExt(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

interface FileRow {
  activityId: string
  activityName: string
  planIds: string[]
  type: AttachmentKey
  /** 在來源陣列（files[type] 或 trash[type]）裡的位置，刪除／復原都靠這個定位。 */
  index: number
  name: string
  size: number
  url: string
  deletedAt?: string
  uploadedByName?: string
  uploadedAt?: string
  deletedByName?: string
}

/** 選取狀態用 url 當 key，不用 index：單筆刪除／復原後陣列會位移，用 index 的話
 * 原本勾選的 key 會改指向別的檔案，批次動作就會作用在使用者沒選的檔案上。 */
function fileRowKey(r: FileRow): string {
  return `${r.activityId}:${r.type}:${r.url}`
}

/** source 決定要撈 files（現存）還是 trash（垃圾桶），兩邊欄位結構一樣。 */
function buildFileRows(source: (a: ActivityRecord) => ActivityFiles): FileRow[] {
  const rows: FileRow[] = []
  for (const a of db.activities) {
    for (const [key] of ATTACHMENT_TYPES) {
      const list = source(a)[key] ?? []
      list.forEach((f, index) => {
        rows.push({
          activityId: a.id,
          activityName: a.name,
          planIds: a.plans,
          type: key,
          index,
          name: f.name,
          size: f.size,
          url: f.url,
          deletedAt: f.deletedAt,
          uploadedByName: f.uploadedByName,
          uploadedAt: f.uploadedAt,
          deletedByName: f.deletedByName,
        })
      })
    }
  }
  return rows
}

const uploadedRows = computed<FileRow[]>(() => {
  const q = uKeyword.value.trim().toLowerCase()
  return buildFileRows((a) => a.files)
    .filter((r) => !uPlan.value || r.planIds.includes(uPlan.value))
    .filter((r) => !uType.value || r.type === uType.value)
    .filter((r) => !q || [r.activityName, r.name].some((s) => s.toLowerCase().includes(q)))
})

const trashedFileRows = computed<FileRow[]>(() =>
  buildFileRows((a) => a.trash).sort((x, y) => (y.deletedAt || '').localeCompare(x.deletedAt || '')),
)

const uploadedSel = useSelection()
const trashedFileSel = useSelection()

/** 方格檢視一次只渲染這麼多張，其餘按「顯示更多」再載入。原圖動輒數 MB，
 * 一次把幾十張都丟給瀏覽器下載會讓整頁卡住很久。 */
const GRID_PAGE_SIZE = 24
const uGridLimit = ref(GRID_PAGE_SIZE)
const tGridLimit = ref(GRID_PAGE_SIZE)
watch([uPlan, uType, uKeyword], () => (uGridLimit.value = GRID_PAGE_SIZE))
const visibleUploadedRows = computed(() => uploadedRows.value.slice(0, uGridLimit.value))
const visibleTrashedFileRows = computed(() => trashedFileRows.value.slice(0, tGridLimit.value))

/** 批次動作用 url 找回「當下」在陣列裡的位置，而不是沿用選取當下的 index——
 * 因為前一筆處理完，陣列可能已經因為刪除／復原而位移，index 會對不上。 */
function currentFileIndex(activityId: string, type: AttachmentKey, url: string, source: 'files' | 'trash'): number {
  const a = db.activities.find((x) => x.id === activityId)
  if (!a) return -1
  return a[source][type].findIndex((f) => f.url === url)
}

async function trashUploadedFile(row: FileRow) {
  if (!(await confirm(`確定要把「${row.name}」移到垃圾桶嗎？之後可以在下面的垃圾桶復原或永久刪除。`))) return
  try {
    await db.trashFile(row.activityId, row.type, row.index)
    pushToast('已移到垃圾桶')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function restoreUploadedFile(row: FileRow) {
  try {
    await db.restoreFile(row.activityId, row.type, row.index)
    pushToast('已復原')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function hardDeleteUploadedFile(row: FileRow) {
  if (!(await confirm(`確定要永久刪除「${row.name}」嗎？此動作無法復原。`))) return
  try {
    await db.hardDeleteFile(row.activityId, row.type, row.index)
    pushToast('已永久刪除')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function batchTrashUploaded() {
  const targets = uploadedRows.value.filter((r) => uploadedSel.isSelected(fileRowKey(r)))
  if (!targets.length) return
  if (!(await confirm(`確定要把選取的 ${targets.length} 個檔案移到垃圾桶嗎？`))) return
  let ok = 0
  for (const r of targets) {
    const idx = currentFileIndex(r.activityId, r.type, r.url, 'files')
    if (idx === -1) continue
    try {
      await db.trashFile(r.activityId, r.type, idx)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  uploadedSel.clear()
  if (ok) pushToast(`已移到垃圾桶（${ok} 個）`)
}

/** 下載中的進度文字（例如「下載中 3/12…」），空字串代表沒在下載 */
const downloadingSelected = ref('')

/** 勾一個直接下載原檔；勾多個打包成 zip，依「活動名稱／類型」分資料夾。 */
async function batchDownloadUploaded() {
  const targets = uploadedRows.value.filter((r) => uploadedSel.isSelected(fileRowKey(r)))
  if (!targets.length || downloadingSelected.value) return
  downloadingSelected.value = '準備下載…'
  try {
    const { failed } = await downloadFiles(
      targets.map((r) => ({
        name: r.name,
        url: r.url,
        folder: `${r.activityName || '未命名活動'}/${attachmentLabel[r.type]}`,
      })),
      `歷史檔案_${todayStamp()}`,
      (done, total) => (downloadingSelected.value = `下載中 ${done}/${total}…`),
    )
    if (failed.length) pushToast(`有 ${failed.length} 個檔案下載失敗：${failed.join('、')}`, 'error')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloadingSelected.value = ''
  }
}

async function batchRestoreFiles() {
  const targets = trashedFileRows.value.filter((r) => trashedFileSel.isSelected(fileRowKey(r)))
  if (!targets.length) return
  let ok = 0
  for (const r of targets) {
    const idx = currentFileIndex(r.activityId, r.type, r.url, 'trash')
    if (idx === -1) continue
    try {
      await db.restoreFile(r.activityId, r.type, idx)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  trashedFileSel.clear()
  if (ok) pushToast(`已復原（${ok} 個）`)
}

async function batchHardDeleteFiles() {
  const targets = trashedFileRows.value.filter((r) => trashedFileSel.isSelected(fileRowKey(r)))
  if (!targets.length) return
  if (!(await confirm(`確定要永久刪除選取的 ${targets.length} 個檔案嗎？此動作無法復原。`))) return
  let ok = 0
  for (const r of targets) {
    const idx = currentFileIndex(r.activityId, r.type, r.url, 'trash')
    if (idx === -1) continue
    try {
      await db.hardDeleteFile(r.activityId, r.type, idx)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  trashedFileSel.clear()
  if (ok) pushToast(`已永久刪除（${ok} 個）`)
}

/** ---------- 各計畫已有生成的匯出檔案（AI 成果報告 GenerationJob） ---------- */

const gPlan = ref('')
const gStatus = ref<GenerationJobStatus | ''>('')

function joinActivity(j: GenerationJobRecord) {
  return { job: j, activity: db.activities.find((a) => a.id === j.activityId) }
}

const generationRows = computed(() => {
  return db.generationJobs
    .filter((j) => !j.deletedAt)
    .map(joinActivity)
    .filter(({ activity }) => !gPlan.value || activity?.plans.includes(gPlan.value))
    .filter(({ job }) => !gStatus.value || job.status === gStatus.value)
    .sort((x, y) => (y.job.createdAt || '').localeCompare(x.job.createdAt || ''))
})

const trashedGenerationRows = computed(() => {
  return db.generationJobs
    .filter((j) => j.deletedAt)
    .map(joinActivity)
    .sort((x, y) => (y.job.deletedAt || '').localeCompare(x.job.deletedAt || ''))
})

const generationSel = useSelection()
const trashedGenerationSel = useSelection()

const downloadingId = ref<string | null>(null)

async function download(jobId: string, resultFile: string) {
  downloadingId.value = jobId
  try {
    const url = await requestDownloadUrl(resultFile)
    window.open(url, '_blank')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloadingId.value = null
  }
}

/** 「檢視」彈窗：不管工作是否完成都能看狀態／錯誤訊息／素材清單，完成的話還能直接下載。 */
const viewingJob = ref<{ job: GenerationJobRecord; activity: ActivityRecord | undefined } | null>(null)

function openJobView(entry: { job: GenerationJobRecord; activity: ActivityRecord | undefined }) {
  viewingJob.value = entry
}
function closeJobView() {
  viewingJob.value = null
}
function sourceFileName(path: string): string {
  return path.split('/').pop() || path
}

async function trashJob(job: GenerationJobRecord) {
  if (!(await confirm(`確定要把「${job.kind}」生成工作移到垃圾桶嗎？之後可以在下面的垃圾桶復原或永久刪除。`))) return
  try {
    await db.trashGenerationJob(job.id)
    pushToast('已移到垃圾桶')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function restoreJob(job: GenerationJobRecord) {
  try {
    await db.restoreGenerationJob(job.id)
    pushToast('已復原')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function hardDeleteJob(job: GenerationJobRecord) {
  if (!(await confirm(`確定要永久刪除「${job.kind}」生成工作嗎？已上傳的素材與產出檔案會一併從雲端清掉，此動作無法復原。`))) return
  try {
    await db.hardDeleteGenerationJob(job.id)
    pushToast('已永久刪除')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function batchTrashJobs() {
  const targets = generationRows.value.filter(({ job }) => generationSel.isSelected(job.id)).map((x) => x.job)
  if (!targets.length) return
  if (!(await confirm(`確定要把選取的 ${targets.length} 筆生成工作移到垃圾桶嗎？`))) return
  let ok = 0
  for (const job of targets) {
    try {
      await db.trashGenerationJob(job.id)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  generationSel.clear()
  if (ok) pushToast(`已移到垃圾桶（${ok} 筆）`)
}

async function batchRestoreJobs() {
  const targets = trashedGenerationRows.value.filter(({ job }) => trashedGenerationSel.isSelected(job.id)).map((x) => x.job)
  if (!targets.length) return
  let ok = 0
  for (const job of targets) {
    try {
      await db.restoreGenerationJob(job.id)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  trashedGenerationSel.clear()
  if (ok) pushToast(`已復原（${ok} 筆）`)
}

async function batchHardDeleteJobs() {
  const targets = trashedGenerationRows.value.filter(({ job }) => trashedGenerationSel.isSelected(job.id)).map((x) => x.job)
  if (!targets.length) return
  if (!(await confirm(`確定要永久刪除選取的 ${targets.length} 筆生成工作嗎？已上傳的素材與產出檔案會一併從雲端清掉，此動作無法復原。`))) return
  let ok = 0
  for (const job of targets) {
    try {
      await db.hardDeleteGenerationJob(job.id)
      ok++
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }
  trashedGenerationSel.clear()
  if (ok) pushToast(`已永久刪除（${ok} 筆）`)
}
</script>

<template>
  <h1>歷史檔案</h1>
  <p class="sub">彙整所有活動累積下來的檔案：使用方上傳的素材，以及系統已產出並保存的匯出檔案。刪除會先進垃圾桶，最後才能永久刪除。</p>

  <h2>使用方上傳的檔案</h2>
  <div class="card">
    <div class="row" style="margin-bottom:14px;justify-content:space-between">
      <div class="row">
        <input v-model="uKeyword" placeholder="搜尋活動名稱／檔案名稱" style="width:220px">
        <select v-model="uPlan" style="width:190px">
          <option value="">全部計畫</option>
          <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="uType" style="width:150px">
          <option value="">全部類型</option>
          <option v-for="[key, label] in ATTACHMENT_TYPES" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="view-toggle">
        <button type="button" :class="{ active: uView === 'grid' }" @click="uView = 'grid'">方格檢視</button>
        <button type="button" :class="{ active: uView === 'list' }" @click="uView = 'list'">列表檢視</button>
      </div>
    </div>

    <div class="row selection-bar" style="margin-bottom:10px">
      <label class="chk" style="margin:0">
        <input
          type="checkbox"
          :checked="uploadedSel.allSelected(uploadedRows.map(fileRowKey))"
          @change="($event.target as HTMLInputElement).checked ? uploadedSel.selectAll(uploadedRows.map(fileRowKey)) : uploadedSel.clear()"
        >全選
      </label>
      <span class="sub mono" style="margin:0">共 {{ uploadedRows.length }} 筆檔案</span>
      <template v-if="uploadedSel.selected.value.size">
        <span class="mono" style="font-size:12.5px">已選取 {{ uploadedSel.selected.value.size }} 項</span>
        <button
          class="btn sm"
          style="margin:0;width:auto;letter-spacing:0"
          :disabled="!!downloadingSelected"
          @click="batchDownloadUploaded"
        >{{ downloadingSelected || (uploadedSel.selected.value.size > 1 ? '下載（打包成 zip）' : '下載') }}</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchTrashUploaded">移到垃圾桶</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="uploadedSel.clear()">取消選取</button>
      </template>
    </div>

    <table class="out" v-if="uploadedRows.length && uView === 'list'">
      <thead>
        <tr><th></th><th>活動</th><th>對應計畫</th><th>類型</th><th>檔案名稱</th><th>大小</th><th>上傳者</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in uploadedRows" :key="`${fileRowKey(r)}:${r.index}`">
          <td><input type="checkbox" :checked="uploadedSel.isSelected(fileRowKey(r))" @change="uploadedSel.toggle(fileRowKey(r))"></td>
          <td><button class="link" @click="openDetail(r.activityId)">{{ r.activityName || '（未命名活動）' }}</button></td>
          <td>
            <span class="plans">
              <span v-for="pid in r.planIds" :key="pid" class="tag">{{ planName(pid) }}</span>
              <span v-if="!r.planIds.length">—</span>
            </span>
          </td>
          <td>{{ attachmentLabel[r.type] }}</td>
          <td>{{ r.name }}</td>
          <td class="mono">{{ kb(r.size) }}</td>
          <td><span class="actor-stamp">{{ actorLine(r.uploadedByName, r.uploadedAt) }}</span></td>
          <td>
            <div class="row" style="gap:10px;flex-wrap:nowrap">
              <a :href="attachmentSrc(r.url, r.name)" target="_blank" rel="noopener">開啟</a>
              <button class="x" title="移到垃圾桶" @click="trashUploadedFile(r)">×</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="file-grid" v-else-if="uploadedRows.length && uView === 'grid'">
      <div v-for="r in visibleUploadedRows" :key="`${fileRowKey(r)}:${r.index}`" class="file-cell">
        <span class="thumb-wrap file-thumb-wrap">
          <input
            type="checkbox"
            class="select-check"
            :checked="uploadedSel.isSelected(fileRowKey(r))"
            @click.stop
            @change="uploadedSel.toggle(fileRowKey(r))"
          >
          <a class="file-thumb" :href="attachmentSrc(r.url, r.name)" target="_blank" rel="noopener" :title="r.name">
            <img v-if="isImageFile(r.name)" :src="attachmentSrc(r.url, r.name)" :alt="r.name" loading="lazy" decoding="async">
            <span v-else class="file-icon">.{{ fileExt(r.name) || '—' }}</span>
          </a>
          <button class="x" title="移到垃圾桶" @click="trashUploadedFile(r)">×</button>
        </span>
        <span class="file-cell-body">
          <span class="file-cell-name">{{ r.name }}</span>
          <span class="file-cell-meta">{{ attachmentLabel[r.type] }}　{{ kb(r.size) }}</span>
          <span class="file-cell-meta">{{ r.activityName || '（未命名活動）' }}</span>
          <span class="file-cell-meta">上傳：{{ r.uploadedByName || UNRECORDED }}</span>
        </span>
      </div>
    </div>

    <p v-else class="empty">目前篩選條件下沒有檔案。</p>
    <div v-if="uView === 'grid' && uploadedRows.length > uGridLimit" class="row" style="justify-content:center;margin-top:14px">
      <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="uGridLimit += GRID_PAGE_SIZE">
        顯示更多（還有 {{ uploadedRows.length - uGridLimit }} 個）
      </button>
    </div>
  </div>

  <h2>各計畫已有生成的匯出檔案</h2>
  <div class="card">
    <p class="sub" style="margin:0 0 14px">
      這裡列出 AI 自動生成的成果報告（活動詳情頁「AI 自動生成成果報告」建立的工作）。
      大事紀 Excel／內政部結案 Word／簽到表／領據等在「匯出成果」頁下載的檔案是即時產生、不會保存在伺服器，因此不會出現在這裡。
    </p>
    <div class="row" style="margin-bottom:14px">
      <select v-model="gPlan" style="width:190px">
        <option value="">全部計畫</option>
        <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="gStatus" style="width:150px">
        <option value="">全部狀態</option>
        <option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>

    <div class="row selection-bar" style="margin-bottom:10px">
      <label class="chk" style="margin:0">
        <input
          type="checkbox"
          :checked="generationSel.allSelected(generationRows.map(({ job }) => job.id))"
          @change="($event.target as HTMLInputElement).checked ? generationSel.selectAll(generationRows.map(({ job }) => job.id)) : generationSel.clear()"
        >全選
      </label>
      <template v-if="generationSel.selected.value.size">
        <span class="mono" style="font-size:12.5px">已選取 {{ generationSel.selected.value.size }} 筆</span>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchTrashJobs">移到垃圾桶</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="generationSel.clear()">取消選取</button>
      </template>
    </div>

    <table class="out" v-if="generationRows.length">
      <thead>
        <tr><th></th><th>活動</th><th>對應計畫</th><th>種類</th><th>建立時間</th><th>狀態</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="{ job, activity } in generationRows" :key="job.id">
          <td><input type="checkbox" :checked="generationSel.isSelected(job.id)" @change="generationSel.toggle(job.id)"></td>
          <td>
            <button v-if="activity" class="link" @click="openDetail(activity.id)">{{ activity.name || '（未命名活動）' }}</button>
            <span v-else>—</span>
          </td>
          <td>
            <span class="plans">
              <span v-for="pid in activity?.plans ?? []" :key="pid" class="tag">{{ planName(pid) }}</span>
              <span v-if="!activity?.plans.length">—</span>
            </span>
          </td>
          <td>{{ job.kind }}</td>
          <td class="mono">
            {{ job.createdAt ? new Date(job.createdAt).toLocaleString() : '—' }}
            <span class="actor-stamp" style="display:table;margin-top:3px">建立者：{{ job.createdByName || UNRECORDED }}</span>
          </td>
          <td>{{ statusLabels[job.status] }}</td>
          <td>
            <div class="row" style="gap:10px;flex-wrap:nowrap">
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="openJobView({ job, activity })">檢視</button>
              <button
                v-if="job.status === 'done' && job.resultFile"
                class="btn ghost sm"
                style="margin:0;width:auto;letter-spacing:0"
                :disabled="downloadingId === job.id"
                @click="download(job.id, job.resultFile)"
              >
                {{ downloadingId === job.id ? '取得中…' : '下載' }}
              </button>
              <button class="x" title="移到垃圾桶" @click="trashJob(job)">×</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">目前篩選條件下沒有生成工作。</p>
  </div>

  <h2>垃圾桶</h2>
  <div class="card">
    <p class="sub" style="margin:0 0 14px">移到垃圾桶的檔案與生成工作列在這裡，可以復原，或永久刪除（無法復原）。</p>

    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">使用方上傳的檔案</label>
      <div class="view-toggle">
        <button type="button" :class="{ active: tView === 'grid' }" @click="tView = 'grid'">方格檢視</button>
        <button type="button" :class="{ active: tView === 'list' }" @click="tView = 'list'">列表檢視</button>
      </div>
    </div>

    <div class="row selection-bar" style="margin:10px 0">
      <label class="chk" style="margin:0">
        <input
          type="checkbox"
          :checked="trashedFileSel.allSelected(trashedFileRows.map(fileRowKey))"
          @change="($event.target as HTMLInputElement).checked ? trashedFileSel.selectAll(trashedFileRows.map(fileRowKey)) : trashedFileSel.clear()"
        >全選
      </label>
      <template v-if="trashedFileSel.selected.value.size">
        <span class="mono" style="font-size:12.5px">已選取 {{ trashedFileSel.selected.value.size }} 項</span>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchRestoreFiles">復原</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchHardDeleteFiles">永久刪除</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="trashedFileSel.clear()">取消選取</button>
      </template>
    </div>

    <table class="out" v-if="trashedFileRows.length && tView === 'list'">
      <thead>
        <tr><th></th><th>活動</th><th>對應計畫</th><th>類型</th><th>檔案名稱</th><th>移入垃圾桶時間</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in trashedFileRows" :key="`${fileRowKey(r)}:${r.index}`">
          <td><input type="checkbox" :checked="trashedFileSel.isSelected(fileRowKey(r))" @change="trashedFileSel.toggle(fileRowKey(r))"></td>
          <td>{{ r.activityName || '（未命名活動）' }}</td>
          <td>
            <span class="plans">
              <span v-for="pid in r.planIds" :key="pid" class="tag">{{ planName(pid) }}</span>
              <span v-if="!r.planIds.length">—</span>
            </span>
          </td>
          <td>{{ attachmentLabel[r.type] }}</td>
          <td>{{ r.name }}</td>
          <td class="mono">
            {{ r.deletedAt ? new Date(r.deletedAt).toLocaleString() : '—' }}
            <span class="actor-stamp" style="display:table;margin-top:3px">刪除者：{{ r.deletedByName || UNRECORDED }}</span>
          </td>
          <td>
            <div class="row" style="gap:8px;flex-wrap:nowrap">
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="restoreUploadedFile(r)">復原</button>
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="hardDeleteUploadedFile(r)">永久刪除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="file-grid" v-else-if="trashedFileRows.length && tView === 'grid'">
      <div v-for="r in visibleTrashedFileRows" :key="`${fileRowKey(r)}:${r.index}`" class="file-cell">
        <span class="thumb-wrap file-thumb-wrap">
          <input
            type="checkbox"
            class="select-check"
            :checked="trashedFileSel.isSelected(fileRowKey(r))"
            @click.stop
            @change="trashedFileSel.toggle(fileRowKey(r))"
          >
          <a class="file-thumb" :href="attachmentSrc(r.url, r.name)" target="_blank" rel="noopener" :title="r.name">
            <img v-if="isImageFile(r.name)" :src="attachmentSrc(r.url, r.name)" :alt="r.name" loading="lazy" decoding="async">
            <span v-else class="file-icon">.{{ fileExt(r.name) || '—' }}</span>
          </a>
        </span>
        <span class="file-cell-body">
          <span class="file-cell-name">{{ r.name }}</span>
          <span class="file-cell-meta">{{ attachmentLabel[r.type] }}　{{ r.activityName || '（未命名活動）' }}</span>
          <span class="file-cell-meta">{{ r.deletedAt ? new Date(r.deletedAt).toLocaleString() : '—' }}</span>
          <span class="file-cell-meta">刪除者：{{ r.deletedByName || UNRECORDED }}</span>
          <span class="file-cell-actions">
            <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="restoreUploadedFile(r)">復原</button>
            <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="hardDeleteUploadedFile(r)">永久刪除</button>
          </span>
        </span>
      </div>
    </div>

    <p v-else class="empty">垃圾桶裡沒有上傳的檔案。</p>
    <div v-if="tView === 'grid' && trashedFileRows.length > tGridLimit" class="row" style="justify-content:center;margin-top:14px">
      <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="tGridLimit += GRID_PAGE_SIZE">
        顯示更多（還有 {{ trashedFileRows.length - tGridLimit }} 個）
      </button>
    </div>

    <label style="margin-top:22px">已生成的匯出檔案</label>
    <div class="row selection-bar" style="margin:10px 0">
      <label class="chk" style="margin:0">
        <input
          type="checkbox"
          :checked="trashedGenerationSel.allSelected(trashedGenerationRows.map(({ job }) => job.id))"
          @change="($event.target as HTMLInputElement).checked ? trashedGenerationSel.selectAll(trashedGenerationRows.map(({ job }) => job.id)) : trashedGenerationSel.clear()"
        >全選
      </label>
      <template v-if="trashedGenerationSel.selected.value.size">
        <span class="mono" style="font-size:12.5px">已選取 {{ trashedGenerationSel.selected.value.size }} 筆</span>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchRestoreJobs">復原</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="batchHardDeleteJobs">永久刪除</button>
        <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="trashedGenerationSel.clear()">取消選取</button>
      </template>
    </div>
    <table class="out" v-if="trashedGenerationRows.length">
      <thead>
        <tr><th></th><th>活動</th><th>對應計畫</th><th>種類</th><th>移入垃圾桶時間</th><th>狀態</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="{ job, activity } in trashedGenerationRows" :key="job.id">
          <td><input type="checkbox" :checked="trashedGenerationSel.isSelected(job.id)" @change="trashedGenerationSel.toggle(job.id)"></td>
          <td>{{ activity?.name || '（未命名活動）' }}</td>
          <td>
            <span class="plans">
              <span v-for="pid in activity?.plans ?? []" :key="pid" class="tag">{{ planName(pid) }}</span>
              <span v-if="!activity?.plans.length">—</span>
            </span>
          </td>
          <td>{{ job.kind }}</td>
          <td class="mono">
            {{ job.deletedAt ? new Date(job.deletedAt).toLocaleString() : '—' }}
            <span class="actor-stamp" style="display:table;margin-top:3px">刪除者：{{ job.updatedByName || UNRECORDED }}</span>
          </td>
          <td>{{ statusLabels[job.status] }}</td>
          <td>
            <div class="row" style="gap:8px;flex-wrap:nowrap">
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="openJobView({ job, activity })">檢視</button>
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="restoreJob(job)">復原</button>
              <button class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0" @click="hardDeleteJob(job)">永久刪除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">垃圾桶裡沒有生成工作。</p>
  </div>

  <div v-if="viewingJob" class="modal" @click.self="closeJobView">
    <div class="card">
      <h2 style="margin-top:0">{{ viewingJob.job.kind }}</h2>
      <p class="sub" style="margin:0 0 14px">
        {{ viewingJob.activity?.name || '（未命名活動）' }}
        <span v-if="viewingJob.activity?.plans.length">　·　{{ viewingJob.activity.plans.map(planName).join('、') }}</span>
      </p>

      <p class="sub" style="margin:4px 0"><b>狀態</b>：{{ statusLabels[viewingJob.job.status] }}</p>
      <p class="sub" style="margin:4px 0">
        <b>建立時間</b>：{{ viewingJob.job.createdAt ? new Date(viewingJob.job.createdAt).toLocaleString() : '—' }}
      </p>
      <p class="sub" style="margin:4px 0"><StampLine :record="viewingJob.job" /></p>
      <p v-if="viewingJob.job.deletedAt" class="sub" style="margin:4px 0">
        <b>移入垃圾桶時間</b>：{{ new Date(viewingJob.job.deletedAt).toLocaleString() }}
      </p>
      <p v-if="viewingJob.job.status === 'error'" class="sub" style="margin:4px 0">
        <b>錯誤訊息</b>：{{ viewingJob.job.errorMessage || '（無訊息）' }}
      </p>

      <div v-if="viewingJob.job.sourceFiles.length" style="margin-top:14px">
        <label>素材檔案（{{ viewingJob.job.sourceFiles.length }} 件）</label>
        <ul class="files">
          <li v-for="p in viewingJob.job.sourceFiles" :key="p"><span class="fname">{{ sourceFileName(p) }}</span></li>
        </ul>
      </div>

      <div class="row" style="margin-top:20px">
        <button
          v-if="viewingJob.job.status === 'done' && viewingJob.job.resultFile"
          class="btn"
          :disabled="downloadingId === viewingJob.job.id"
          @click="download(viewingJob.job.id, viewingJob.job.resultFile)"
        >
          {{ downloadingId === viewingJob.job.id ? '取得下載網址中…' : '下載成果報告' }}
        </button>
        <button class="btn ghost" @click="closeJobView">關閉</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.link { background: none; border: 0; padding: 0; color: var(--ink); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.link:hover { color: var(--gold-600); }

.selection-bar { min-height: 30px; }
</style>
