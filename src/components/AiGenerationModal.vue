<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { useGenerationJobPolling } from '../composables/useGenerationJobPolling'
import { requestDownloadUrl, requestSignedUploadUrl, uploadToSignedUrl } from '../lib/middleware'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import FolderDropzone from './FolderDropzone.vue'
import { FOLDERS } from '../types'
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
const submitting = ref(false)
const activeJob = ref<GenerationJobRecord | null>(null)

const totalSelected = computed(() =>
  FOLDERS.reduce((n, [key]) => n + selected[key].length, 0),
)

const pastJobs = computed(() =>
  db.generationJobs.filter(
    (j) => j.activityId === props.activity.id && j.id !== activeJob.value?.id,
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
  selected[folder] = [...selected[folder], ...files]
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
  const allFiles = FOLDERS.flatMap(([folder]) =>
    selected[folder].map((file) => ({ folder, file })),
  )
  allFiles.forEach(({ file }) => fileStates.set(file, 'queued'))

  const objectPaths: string[] = []
  try {
    for (const { folder, file } of allFiles) {
      fileStates.set(file, 'uploading')
      const contentType = file.type || 'application/octet-stream'
      const { uploadUrl, objectPath } = await requestSignedUploadUrl({
        activityId: props.activity.id,
        folder,
        filename: file.name,
        contentType,
      })
      await uploadToSignedUrl(uploadUrl, file, contentType)
      fileStates.set(file, 'uploaded')
      objectPaths.push(objectPath)
    }
    const job = await db.createGenerationJob(props.activity.id, '成果報告', objectPaths)
    activeJob.value = job
    FOLDERS.forEach(([key]) => (selected[key] = []))
    pushToast('已送出，等待後端處理')
    startPolling(job.id, (r) => (activeJob.value = r))
  } catch (e) {
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
  if (!(await confirm(`確定要刪除這筆「${job.kind}」生成工作嗎？已上傳的素材與產出檔案會一併刪除。`))) return
  deletingJobId.value = job.id
  try {
    await db.deleteGenerationJob(job.id)
    if (activeJob.value?.id === job.id) {
      stopPolling()
      activeJob.value = null
    }
    pushToast('已刪除生成工作')
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
      <p class="flagbox" style="margin:0 0 16px">
        目前尚未接上自動生成後端，此工作會停在「待處理」狀態，之後才會由後端接手產生真正的檔案。
      </p>

      <FolderDropzone
        v-for="[key, label] in FOLDERS"
        :key="key"
        :label="label"
        :count-label="`已選 ${selected[key].length} 件`"
        @pick="(files) => addFiles(key, files)"
        @drop="(files) => addFiles(key, files)"
      >
        <ul v-if="selected[key].length" class="files">
          <li v-for="(f, i) in selected[key]" :key="i">
            <span class="fname">{{ f.name }}</span>
            <span style="display:flex;align-items:center;gap:8px">
              <span class="mono fsize">{{ fileStates.get(f) ?? '待上傳' }}</span>
              <button class="x" :disabled="submitting" @click="removeSelected(key, i)">×</button>
            </span>
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
              <button class="x" title="刪除這筆生成工作" :disabled="deletingJobId === j.id" @click="removeJob(j)">×</button>
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
