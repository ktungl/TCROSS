<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  label: string
  countLabel: string
  pickLabel?: string
  /** 標題下方的一行小字說明，例如可上傳格式 */
  hint?: string
  uploading?: { name: string; progress: number }[]
  /** 只有正式歸檔附件（DetailView 的 8 分類）需要「從歷史檔案選取」，
   * AI 生成素材（AiGenerationModal 的語音/影片/照片/文件）不適用，預設關閉。 */
  historyPickable?: boolean
  /** 唯讀（例如已封存的活動）：隱藏上傳按鈕，拖曳放檔也不接受 */
  readonly?: boolean
}>()
const emit = defineEmits<{ pick: [File[]]; drop: [File[]]; 'browse-history': [] }>()

const dragOver = ref(false)

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) emit('pick', files)
}
function onDragOver() {
  if (!props.readonly) dragOver.value = true
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  if (props.readonly) return
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) emit('drop', files)
}
</script>

<template>
  <div
    class="folder"
    :class="{ 'drag-over': dragOver }"
    @dragenter.prevent="onDragOver"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <header>
      <h3>{{ label }} <span class="count">{{ countLabel }}</span></h3>
      <div v-if="!readonly" class="row" style="gap:8px">
        <button
          v-if="historyPickable"
          type="button"
          class="btn ghost sm"
          style="margin:0;width:auto;letter-spacing:0"
          @click="emit('browse-history')"
        >從歷史檔案選取</button>
        <label class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0">{{ pickLabel ?? '選擇檔案' }}
          <input type="file" multiple style="display:none" @change="onPick">
        </label>
      </div>
    </header>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <ul v-if="uploading?.length" class="upload-list">
      <li v-for="u in uploading" :key="u.name">
        <div class="upload-row">
          <span class="fname">{{ u.name }}</span>
          <span class="pct mono">{{ Math.round(u.progress * 100) }}%</span>
        </div>
        <div class="progress"><span :style="{ width: `${Math.round(u.progress * 100)}%` }" /></div>
      </li>
    </ul>
    <slot />
  </div>
</template>
