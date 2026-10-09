<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { useGenerationJobPolling } from '../composables/useGenerationJobPolling'
import {
  deleteObjects,
  requestDownloadUrl,
  requestSignedUploadUrls,
  triggerGeneration,
  uploadToSignedUrl,
  type SignedUrlResponse,
} from '../lib/middleware'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import FolderDropzone from './FolderDropzone.vue'
import { UNRECORDED, formatDateTime } from '../utils/actor'
import { FOLDERS, GENERATION_STATUS_LABELS, fileUploadRejectionReason } from '../types'
import type { ActivityRecord, FolderKey, GenerationJobRecord, GenerationJobStatus } from '../types'

const props = defineProps<{ activity: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const db = useDbStore()
const { start: startPolling, stop: stopPolling } = useGenerationJobPolling()

function emptySelection(): Record<FolderKey, File[]> {
  return { photo: [], audio: [], video: [], doc: [] }
}

const selected = reactive(emptySelection())
const fileStates = reactive(new Map<File, 'queued' | 'uploading' | 'uploaded' | 'error'>())
const fileProgress = reactive(new Map<File, number>())
const FILE_STATE_LABELS = { queued: '待上傳', uploading: '上傳中', uploaded: '已上傳', error: '上傳失敗' } as const
/** 同時上傳的檔案數量上限，避免一次太多連線把伺服器或使用者頻寬打滿。 */
const UPLOAD_CONCURRENCY = 3
/** 每筆生成工作的素材數量上限，要跟 server/main.py 的 MAX_SOURCE_FILES 一致——
 * 素材越多 Gemini 費用越高。 */
const MAX_SOURCE_FILES = 20
/** 停在「處理中」超過這麼久，視為後端中途中斷，允許重新觸發（同 server/main.py STALE_PROCESSING_AFTER）。 */
const STALE_PROCESSING_MS = 20 * 60 * 1000
const submitting = ref(false)
const activeJob = ref<GenerationJobRecord | null>(null)

const totalSelected = computed(() =>
  FOLDERS.reduce((n, [key]) => n + selected[key].length, 0),
)

const pastJobs = computed(() =>
  db.generationJobs.filter(
    (j) => j.activityId === props.activity.id && j.id !== activeJob.value?.id && !j.deletedAt,
  ),
)

function statusLabel(status: GenerationJobStatus): string {
  return GENERATION_STATUS_LABELS[status]
}

const canRetrigger = computed(() => {
  const job = activeJob.value
  if (!job) return false
  if (job.status === 'pending') return true
  return job.status === 'processing' && Date.now() - new Date(job.updatedAt).getTime() > STALE_PROCESSING_MS
})

/** /generate 會在同一個請求裡把整份報告做完（可能要一兩分鐘），這裡不等它回應，
 * 結果一律靠輪詢 GenerationJob.status 取得；只有請求本身被拒（例如 409／403）才提示。 */
function fireGeneration(jobId: string) {
  triggerGeneration(jobId).catch((e) => pushToast(errorMessage(e), 'error'))
}

function retrigger() {
  const job = activeJob.value
  if (!job) return
  fireGeneration(job.id)
  startPolling(job.id, (r) => (activeJob.value = r))
  pushToast('已重新送出')
}

onMounted(async () => {
  try {
    await db.fetchGenerationJobs(props.activity.id)
    const unresolved = db.generationJobs.find(
      (j) =>
        j.activityId === props.activity.id &&
        (j.status === 'pending' || j.status === 'processing'),
    )
    if (unresolved) {
      activeJob.value = unresolved
      startPolling(unresolved.id, (r) => (activeJob.value = r))
    }
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
})

function addFiles(folder: FolderKey, files: File[]) {
  const accepted: File[] = []
  for (const file of files) {
    const reason = fileUploadRejectionReason(file)
    if (reason) pushToast(reason, 'error')
    else accepted.push(file)
  }
  selected[folder] = [...selected[folder], ...accepted]
}
function removeSelected(folder: FolderKey, i: number) {
  selected[folder] = selected[folder].filter((_, idx) => idx !== i)
}

async function startGeneration() {
  if (!totalSelected.value) {
    pushToast('請先選擇至少一個檔案', 'error')
    return
  }
  if (totalSelected.value > MAX_SOURCE_FILES) {
    pushToast(`一次最多 ${MAX_SOURCE_FILES} 個檔案，請減少素材`, 'error')
    return
  }
  submitting.value = true
  fileStates.clear()
  fileProgress.clear()
  const allFiles = FOLDERS.flatMap(([folder]) =>
    selected[folder].map((file) => ({ folder, file })),
  )
  allFiles.forEach(({ file }) => fileStates.set(file, 'queued'))

  let signedUrls: SignedUrlResponse[]
  try {
    signedUrls = await requestSignedUploadUrls(
      props.activity.id,
      allFiles.map(({ folder, file }) => ({
        folder,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      })),
    )
  } catch (e) {
    pushToast(errorMessage(e), 'error')
    submitting.value = false
    return
  }

  const objectPaths: (string | null)[] = new Array(allFiles.length).fill(null)
  let cursor = 0
  let aborted = false
  async function worker() {
    while (!aborted && cursor < allFiles.length) {
      const i = cursor++
      const { file } = allFiles[i]
      const { uploadUrl, objectPath } = signedUrls[i]
      fileStates.set(file, 'uploading')
      try {
        const contentType = file.type || 'application/octet-stream'
        await uploadToSignedUrl(uploadUrl, file, contentType, (fraction) => {
          fileProgress.set(file, fraction)
        })
        fileStates.set(file, 'uploaded')
        objectPaths[i] = objectPath
      } catch (e) {
        aborted = true
        fileStates.set(file, 'error')
        throw e
      }
    }
  }
  try {
    // 用 allSettled 等所有 worker 都停下來：Promise.all 在第一個失敗就 reject，其他還在傳的
    // 檔案稍後才完成，下面 catch 清孤兒檔時就會漏掉它們，留在 GCS 持續計費。
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, allFiles.length) }, worker),
    )
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    const job = await db.createGenerationJob(props.activity.id, '成果報告', objectPaths as string[])
    activeJob.value = job
    FOLDERS.forEach(([key]) => (selected[key] = []))
    startPolling(job.id, (r) => (activeJob.value = r))
    // 素材已上傳、job 已建立；觸發失敗時工作會停在「待處理」，可以按「重新觸發」再送一次。
    fireGeneration(job.id)
    pushToast('已送出，AI 正在處理中')
  } catch (e) {
    // 清掉已經上傳成功、但沒機會掛到 GenerationJob 上的孤兒檔案，避免留在 GCS 裡持續計費。
    // best-effort：清不掉就算了，不要蓋掉原本要顯示給使用者的錯誤訊息。
    const uploaded = objectPaths.filter((p): p is string => p !== null)
    if (uploaded.length) deleteObjects(uploaded, props.activity.id).catch(() => {})
    pushToast(errorMessage(e), 'error')
  } finally {
    submitting.value = false
  }
}

const downloading = ref<string | null>(null)

async function download(job: GenerationJobRecord) {
  if (!job.resultFile) return
  downloading.value = job.id
  try {
    const url = await requestDownloadUrl(job.resultFile)
    window.open(url, '_blank')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloading.value = null
  }
}

const deletingJobId = ref<string | null>(null)

async function removeJob(job: GenerationJobRecord) {
  if (!(await confirm(`確定要把這筆「${job.kind}」生成工作移到垃圾桶嗎？之後可以在「歷史檔案」頁復原或永久刪除。`, '移到垃圾桶'))) return
  deletingJobId.value = job.id
  try {
    await db.trashGenerationJob(job.id)
    if (activeJob.value?.id === job.id) {
      stopPolling()
      activeJob.value = null
    }
    pushToast('已移到垃圾桶')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    deletingJobId.value = null
  }
}

async function close() {
  if (submitting.value) {
    pushToast('素材還在上傳，請等上傳完成再關閉', 'error')
    return
  }
  if (totalSelected.value && !(await confirm('已選的素材還沒送出，確定要放棄嗎？', '放棄'))) return
  stopPolling()
  emit('close')
}
useEscape(close)
</script>

<template>
  <div class="modal" v-modal-focus @click.self="close">
    <div class="card">
      <h2>AI 自動生成成果報告</h2>
      <p class="sub">選擇語音／影片／照片／文件素材，上傳後建立一筆生成工作。</p>

      <FolderDropzone
        v-for="[key, label] in FOLDERS"
        :key="key"
        :label="label"
        :count-label="`已選 ${selected[key].length} 個`"
        @pick="(files) => addFiles(key, files)"
        @drop="(files) => addFiles(key, files)"
      >
        <ul v-if="selected[key].length" class="files">
          <li v-for="(f, i) in selected[key]" :key="i" style="flex-wrap:wrap">
            <span class="fname">{{ f.name }}</span>
            <span style="display:flex;align-items:center;gap:8px">
              <span class="mono fsize">
                {{ fileStates.get(f) === 'uploading'
                  ? `上傳中 ${Math.round((fileProgress.get(f) ?? 0) * 100)}%`
                  : FILE_STATE_LABELS[fileStates.get(f) ?? 'queued'] }}
              </span>
              <button class="x" title="移除" :disabled="submitting" @click="removeSelected(key, i)">×</button>
            </span>
            <div
              v-if="fileStates.get(f) === 'uploading'"
              class="progress"
              style="width:100%;margin-top:4px"
            >
              <span :style="{ width: `${Math.round((fileProgress.get(f) ?? 0) * 100)}%` }" />
            </div>
          </li>
        </ul>
        <p v-else class="empty">還沒有{{ label }}。拖曳檔案到這裡或按選擇檔案。</p>
      </FolderDropzone>

      <div v-if="activeJob" class="card field">
        <b>目前工作</b>：{{ activeJob.kind }}　狀態：{{ statusLabel(activeJob.status) }}
        <p v-if="activeJob.status !== 'done' && activeJob.status !== 'error'" class="sub kv">
          已送出，等待後端處理（此頁面每 5 秒自動查詢一次最新狀態）。
          <button v-if="canRetrigger" class="btn ghost sm" style="margin-left:8px" @click="retrigger">重新觸發</button>
        </p>
        <p v-else-if="activeJob.status === 'error'" class="sub kv">
          {{ activeJob.errorMessage || '生成失敗' }}
        </p>
        <button
          v-else-if="activeJob.resultFile"
          class="btn ghost sm"
          style="margin-top:8px"
          :disabled="downloading === activeJob.id"
          @click="download(activeJob)"
        >
          {{ downloading === activeJob.id ? '取得中…' : '下載' }}
        </button>
      </div>

      <div class="field" v-if="pastJobs.length">
        <label>過去的生成工作</label>
        <ul class="files">
          <li v-for="j in pastJobs" :key="j.id">
            <span>{{ j.kind }}　{{ statusLabel(j.status) }}<span class="actor-stamp" style="margin-left:6px">建立者：{{ j.createdByName || UNRECORDED }}</span></span>
            <span style="display:flex;align-items:center;gap:8px">
              <button
                v-if="j.status === 'done' && j.resultFile"
                class="btn ghost sm"
               
                :disabled="downloading === j.id"
                @click="download(j)"
              >
                {{ downloading === j.id ? '取得中…' : '下載' }}
              </button>
              <span class="mono fsize">{{ formatDateTime(j.createdAt) }}</span>
              <button class="x" title="移到垃圾桶" :disabled="deletingJobId === j.id" @click="removeJob(j)">×</button>
            </span>
          </li>
        </ul>
      </div>

      <div class="row actions">
        <button class="btn" :disabled="submitting || !totalSelected" @click="startGeneration">
          {{ submitting ? '上傳中…' : '開始生成' }}
        </button>
        <button class="btn ghost" @click="close">關閉</button>
      </div>
    </div>
  </div>
</template>
