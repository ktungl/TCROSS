<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildActivityRecordXlsx,
  buildReceiptDocx,
  buildSignInSheetXlsx,
  downloadBlob,
  generatedFormExtension,
} from '../utils/download'
import type { GeneratedFormKind } from '../utils/download'
import { errorMessage, pushToast } from '../composables/useToast'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityRecord } from '../types'

const props = defineProps<{
  activity: ActivityRecord
  kind: GeneratedFormKind
  planName: (id: string) => string
}>()
const emit = defineEmits<{ close: [] }>()

const downloading = ref(false)

const planNames = computed(() => props.activity.plans.map(props.planName).join('、'))

const summary = computed(() => {
  switch (props.kind) {
    case '簽到表':
      return `將產生 ${Math.max(10, props.activity.headcount.total || 10)} 列簽到欄位的 Excel 檔`
    case '領據':
      return '將產生一份可列印簽章的 Word 領據'
    case '活動紀錄表':
      return `將產生活動紀錄表 Excel 檔（含執行情形、附件統計：${ATTACHMENT_TYPES.map(([k, l]) => `${l} ${props.activity.files[k]?.length ?? 0}`).join('、')}）`
  }
})

async function download() {
  downloading.value = true
  try {
    let blob: Blob
    switch (props.kind) {
      case '簽到表':
        blob = await buildSignInSheetXlsx(props.activity, planNames.value)
        break
      case '領據':
        blob = await buildReceiptDocx(props.activity, planNames.value)
        break
      case '活動紀錄表':
        blob = await buildActivityRecordXlsx(props.activity, planNames.value)
        break
    }
    downloadBlob(`${props.activity.name}_${props.kind}.${generatedFormExtension(props.kind)}`, blob)
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="card">
      <h2 style="margin-top:0">{{ kind }}</h2>
      <p class="sub">{{ summary }}</p>
      <div class="row" style="margin-top:20px">
        <button class="btn" :disabled="downloading" @click="download">{{ downloading ? '產生中…' : '下載' }}</button>
        <button class="btn ghost" @click="emit('close')">關閉</button>
      </div>
    </div>
  </div>
</template>
