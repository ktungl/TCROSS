<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  label: string
  countLabel: string
  pickLabel?: string
}>()
const emit = defineEmits<{ pick: [File[]]; drop: [File[]] }>()

const dragOver = ref(false)

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) emit('pick', files)
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) emit('drop', files)
}
</script>

<template>
  <div
    class="folder"
    :class="{ 'drag-over': dragOver }"
    @dragenter.prevent="dragOver = true"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <header>
      <h3>{{ label }} <span class="count">{{ countLabel }}</span></h3>
      <label class="btn ghost sm" style="margin:0;width:auto;letter-spacing:0">{{ pickLabel ?? '選擇檔案' }}
        <input type="file" multiple style="display:none" @change="onPick">
      </label>
    </header>
    <slot />
  </div>
</template>
