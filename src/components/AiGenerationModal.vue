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
import FolderDropzone from './FolderDropzone.vue'
import { FOLDERS, fileUploadRejectionReason } from '../types'
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
/** 同時上傳的檔案數量上限，避免一次太多連線把伺服器或使用者頻寬打滿。 */
const UPLOAD_CONCURRENCY = 3
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

const statusLabels: Record<GenerationJobStatus, string> = {
  pending: '待處理',
  processing: '處理中',
  done: '已完成',
  error: '錯誤',
}
function statusLabel(status: GenerationJobStatus): string {
  return statusLabels[status]
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
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, allFiles.length) }, worker),
    )
    const job = await db.createGenerationJob(props.activity.id, '成果報告', objectPaths as string[])
    activeJob.value = job
    FOLDERS.forEach(([key]) => (selected[key] = []))
    startPolling(job.id, (r) => (activeJob.value = r))
    try {
      await triggerGeneration(job.id)
      pushToast('已送出，AI 正在處理中')
    } catch (e) {
      // 素材已上傳、job 已建立，只是觸發生成這一步失敗——工作會停在「待處理」，
      // 不要把已完成的上傳流程當成整體失敗來處理。
      pushToast(errorMessage(e), 'error')
    }
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
  if (!(await confirm(`確定要把這筆「${job.kind}」生成工作移到垃圾桶嗎？之後可以在「歷史檔案」頁復原或永久刪除。`))) return
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

function close() {
  stopPolling()
  emit('close')
}
</script>

<template>
  <div class="modal" @click.self="close">
    <div class="card">
      <h2 style="margin-top:0">AI 自動生成成果報告</h2>
      <p class="sub">選擇語音／影片／照片／文件素材，上傳後建立一筆生成工作。</p>

      <FolderDropzone
        v-for="[key, label] in FOLDERS"
        :key="key"
        :label="label"
        :count-label="`已選 ${selected[key].length} 件`"
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
                  : fileStates.get(f) ?? '待上傳' }}
              </span>
              <button class="x" :disabled="submitting" @click="removeSelected(key, i)">×</button>
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

      <div v-if="activeJob" class="card" style="margin-top:14px">
        <b>目前工作</b>：{{ activeJob.kind }}　狀態：{{ statusLabel(activeJob.status) }}
        <p v-if="activeJob.status !== 'done' && activeJob.status !== 'error'" class="sub" style="margin:6px 0 0">
          已送出，等待後端處理（此頁面每 5 秒自動查詢一次最新狀態）。
        </p>
        <p v-else-if="activeJob.status === 'error'" class="sub" style="margin:6px 0 0">
          {{ activeJob.errorMessage || '生成失敗' }}
        </p>
        <button
          v-else-if="activeJob.resultFile"
          class="btn ghost sm"
          style="margin-top:8px;width:auto;letter-spacing:0"
          :disabled="downloading === activeJob.id"
          @click="download(activeJob)"
        >
          {{ downloading === activeJob.id ? '取得下載網址中…' : '下載檔案' }}
        </button>
      </div>

      <div v-if="pastJobs.length" style="margin-top:14px">
        <label>過去的生成工作</label>
        <ul class="files">
          <li v-for="j in pastJobs" :key="j.id">
            <span>{{ j.kind }}　{{ statusLabel(j.status) }}</span>
            <span style="display:flex;align-items:center;gap:8px">
              <button
                v-if="j.status === 'done' && j.resultFile"
                class="btn ghost sm"
                style="margin:0;width:auto;letter-spacing:0"
                :disabled="downloading === j.id"
                @click="download(j)"
              >
                {{ downloading === j.id ? '取得中…' : '下載' }}
              </button>
              <span class="mono fsize">{{ new Date(j.createdAt).toLocaleString() }}</span>
              <button class="x" title="移到垃圾桶" :disabled="deletingJobId === j.id" @click="removeJob(j)">×</button>
            </span>
          </li>
        </ul>
      </div>

      <div class="row" style="margin-top:20px">
        <button class="btn" :disabled="submitting || !totalSelected" @click="startGeneration">
          {{ submitting ? '上傳中…' : '開始生成' }}
        </button>
        <button class="btn ghost" @click="close">關閉</button>
      </div>
    </div>
  </div>
</template>
