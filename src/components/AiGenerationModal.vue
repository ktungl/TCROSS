<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { useGenerationJobPolling } from '../composables/useGenerationJobPolling'
import {
  deleteObjects,
  requestSignedUploadUrls,
  triggerGeneration,
  putToSignedUrl,
  UPLOAD_CONCURRENCY,
  type SignedUrlResponse,
} from '../lib/middleware'
import { contentTypeOf } from '../lib/attachments'
import { runPool } from '../utils/pool'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import { useReportDownload } from '../composables/useReportDownload'
import FolderDropzone from './FolderDropzone.vue'
import { UNRECORDED, formatDateTime } from '../utils/actor'
import { FOLDERS, GENERATION_STATUS_LABELS, fileUploadRejectionReason } from '../types'
import type { ActivityRecord, FolderKey, GenerationJobKind, GenerationJobRecord, GenerationJobStatus } from '../types'

const props = withDefaults(defineProps<{ activity: ActivityRecord; kind?: GenerationJobKind }>(), {
  kind: '成果報告',
})
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
/** 每筆生成工作的素材數量上限，要跟 server/main.py 的 MAX_SOURCE_FILES 一致——
 * 素材越多 Gemini 費用越高。 */
const MAX_SOURCE_FILES = 20
/** 停在「處理中」超過這麼久，視為後端中途中斷，允許重新觸發（同 server/main.py STALE_PROCESSING_AFTER）。 */
const STALE_PROCESSING_MS = 20 * 60 * 1000
const submitting = ref(false)
const activeJob = ref<GenerationJobRecord | null>(null)

const isMeeting = computed(() => props.kind === '會議紀錄')
/** 會議紀錄只收錄音；檔案數要跟 server/main.py MAX_MEETING_FILES 一致 */
const MAX_MEETING_FILES = 3
const MAX_MEETING_MINUTES = 60
const folders = computed(() => (isMeeting.value ? FOLDERS.filter(([key]) => key === 'audio') : FOLDERS))
const maxFiles = computed(() => (isMeeting.value ? MAX_MEETING_FILES : MAX_SOURCE_FILES))

const totalSelected = computed(() =>
  FOLDERS.reduce((n, [key]) => n + selected[key].length, 0),
)

/** 錄音長度（秒）；瀏覽器讀不出長度的檔案不會加進來，會議紀錄不收（無法確認有沒有超過上限） */
const durations = reactive(new Map<File, number>())
/** 讀長度的等待上限：有些瀏覽器／格式 loadedmetadata 與 error 都不觸發，不設上限會讓檔案永遠加不進來 */
const READ_DURATION_TIMEOUT_MS = 10_000
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    let settled = false
    const done = (v: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(v)
    }
    const timer = setTimeout(() => done(null), READ_DURATION_TIMEOUT_MS)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
    audio.onerror = () => done(null)
    audio.src = url
  })
}
/** 還在讀長度的檔案數；讀完前不能送出，避免送出後才讀完的檔案又跑回「已選」清單 */
const measuring = ref(0)
const totalMinutes = computed(() =>
  selected.audio.reduce((sum, f) => sum + (durations.get(f) ?? 0), 0) / 60,
)
function minutesLabel(file: File): string {
  const sec = durations.get(file)
  if (sec == null) return ''
  return sec < 60 ? '不到 1 分鐘' : `${Math.round(sec / 60)} 分鐘`
}

const pastJobs = computed(() =>
  db.generationJobs.filter(
    (j) =>
      j.activityId === props.activity.id &&
      j.kind === props.kind &&
      j.id !== activeJob.value?.id &&
      !j.deletedAt,
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
        j.kind === props.kind &&
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

// Gemini 能讀的文件格式（.docx 由後端先取出文字，見 server/report.py _source_part）
const AI_DOC_EXTENSIONS = /\.(pdf|docx|txt)$/i

async function addFiles(folder: FolderKey, files: File[]) {
  // 上傳中加進來的檔案不在這次送出的清單裡，送出成功清空「已選」時會被默默丟掉
  if (submitting.value) {
    pushToast('素材上傳中，請等這次送出完成再加入檔案', 'error')
    return
  }
  const accepted: File[] = []
  for (const file of files) {
    const reason =
      fileUploadRejectionReason(file) ??
      (folder === 'doc' && !AI_DOC_EXTENSIONS.test(file.name)
        ? `「${file.name}」AI 讀不了這種格式，文件請上傳 PDF、Word（.docx）或純文字檔`
        : null)
    if (reason) pushToast(reason, 'error')
    else accepted.push(file)
  }
  if (!isMeeting.value) {
    selected[folder] = [...selected[folder], ...accepted]
    return
  }
  measuring.value += accepted.length
  try {
    const secs = await Promise.all(accepted.map(readDuration))
    const measured = accepted.filter((file, i) => {
      const sec = secs[i]
      if (sec == null) {
        pushToast(`讀不出「${file.name}」的長度，請轉成 MP3 或 M4A 再上傳`, 'error')
        return false
      }
      durations.set(file, sec)
      return true
    })
    selected[folder] = [...selected[folder], ...measured]
  } finally {
    measuring.value -= accepted.length
  }
}
function removeSelected(folder: FolderKey, i: number) {
  durations.delete(selected[folder][i])
  selected[folder] = selected[folder].filter((_, idx) => idx !== i)
}

async function startGeneration() {
  if (measuring.value) {
    pushToast('還在讀取錄音長度，請稍候再送出', 'error')
    return
  }
  if (!totalSelected.value) {
    pushToast('請先選擇至少一個檔案', 'error')
    return
  }
  if (totalSelected.value > maxFiles.value) {
    pushToast(`一次最多 ${maxFiles.value} 個檔案，請減少素材`, 'error')
    return
  }
  if (isMeeting.value && totalMinutes.value > MAX_MEETING_MINUTES) {
    pushToast(`錄音合計約 ${Math.ceil(totalMinutes.value)} 分鐘，目前上限 ${MAX_MEETING_MINUTES} 分鐘，請剪短或分次整理`, 'error')
    return
  }
  submitting.value = true
  fileStates.clear()
  fileProgress.clear()
  const allFiles = folders.value.flatMap(([folder]) =>
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
        contentType: contentTypeOf(file),
        size: file.size,
      })),
    )
  } catch (e) {
    pushToast(errorMessage(e), 'error')
    submitting.value = false
    return
  }

  const objectPaths: (string | null)[] = new Array(allFiles.length).fill(null)
  try {
    // runPool 會等還在傳的檔案都結束才拋錯，下面 catch 清孤兒檔時才不會漏掉稍後才完成的。
    await runPool(allFiles, UPLOAD_CONCURRENCY, async ({ file }, i) => {
      const { uploadUrl, objectPath } = signedUrls[i]
      fileStates.set(file, 'uploading')
      try {
        await putToSignedUrl(uploadUrl, file, contentTypeOf(file), (fraction) => {
          fileProgress.set(file, fraction)
        })
        fileStates.set(file, 'uploaded')
        objectPaths[i] = objectPath
      } catch (e) {
        fileStates.set(file, 'error')
        throw e
      }
    })
    const job = await db.createGenerationJob(props.activity.id, props.kind, objectPaths as string[])
    activeJob.value = job
    FOLDERS.forEach(([key]) => (selected[key] = []))
    durations.clear()
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

const { downloading, download } = useReportDownload()

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
      <template v-if="isMeeting">
        <h2>AI 會議音檔轉錄紀錄</h2>
        <p class="sub">
          上傳會議錄音（最多 {{ MAX_MEETING_FILES }} 個、合計 {{ MAX_MEETING_MINUTES }} 分鐘內），AI 整理成摘要、決議與待辦的 Word 檔，約需 1～5 分鐘。
          決議、負責人與期限請與主持人確認後再發出。
        </p>
        <p v-if="selected.audio.length" class="hint">已選錄音合計約 {{ Math.round(totalMinutes) }} 分鐘</p>
      </template>
      <template v-else>
        <h2>AI 自動生成成果報告</h2>
        <p class="sub">選擇語音／影片／照片／文件素材，上傳後建立一筆生成工作。</p>
      </template>

      <FolderDropzone
        v-for="[key, label] in folders"
        :key="key"
        :label="label"
        :count-label="`已選 ${selected[key].length} 個`"
        @pick="(files) => addFiles(key, files)"
        @drop="(files) => addFiles(key, files)"
      >
        <ul v-if="selected[key].length" class="files">
          <li v-for="(f, i) in selected[key]" :key="i" style="flex-wrap:wrap">
            <span class="fname">{{ f.name }}<span v-if="isMeeting" class="actor-stamp block">{{ minutesLabel(f) }}</span></span>
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
        <div v-else-if="activeJob.resultFile" class="row" style="margin-top:8px;gap:8px">
          <button class="btn ghost sm" :disabled="!!downloading" @click="download(activeJob)">
            {{ downloading === `${activeJob.id}:docx` ? '取得中…' : '下載 Word' }}
          </button>
          <button class="btn ghost sm" :disabled="!!downloading" @click="download(activeJob, true)">
            {{ downloading === `${activeJob.id}:pdf` ? '取得中…' : '下載 PDF' }}
          </button>
        </div>
      </div>

      <div class="field" v-if="pastJobs.length">
        <label>過去的生成工作</label>
        <ul class="files">
          <li v-for="j in pastJobs" :key="j.id">
            <span>{{ j.kind }}　{{ statusLabel(j.status) }}<span class="actor-stamp" style="margin-left:6px">建立者：{{ j.createdByName || UNRECORDED }}</span></span>
            <span style="display:flex;align-items:center;gap:8px">
              <template v-if="j.status === 'done' && j.resultFile">
                <button class="btn ghost sm" :disabled="!!downloading" @click="download(j)">
                  {{ downloading === `${j.id}:docx` ? '取得中…' : 'Word' }}
                </button>
                <button class="btn ghost sm" :disabled="!!downloading" @click="download(j, true)">
                  {{ downloading === `${j.id}:pdf` ? '取得中…' : 'PDF' }}
                </button>
              </template>
              <span class="mono fsize">{{ formatDateTime(j.createdAt) }}</span>
              <button class="x" title="移到垃圾桶" :disabled="deletingJobId === j.id" @click="removeJob(j)">×</button>
            </span>
          </li>
        </ul>
      </div>

      <div class="row actions">
        <button class="btn" :disabled="submitting || measuring > 0 || !totalSelected" @click="startGeneration">
          {{ submitting ? '上傳中…' : measuring ? '讀取錄音長度中…' : '開始生成' }}
        </button>
        <button class="btn ghost" @click="close">關閉</button>
      </div>
    </div>
  </div>
</template>
