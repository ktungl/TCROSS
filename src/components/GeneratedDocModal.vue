<script setup lang="ts">
import { computed } from 'vue'
import { downloadFile, generatedFormBody, generatedFormHead, wrapDoc } from '../utils/download'
import type { GeneratedFormKind } from '../utils/download'
import type { ActivityRecord } from '../types'

const props = defineProps<{
  activity: ActivityRecord
  kind: GeneratedFormKind
  planName: (id: string) => string
}>()
const emit = defineEmits<{ close: [] }>()

const planNames = computed(() => props.activity.plans.map(props.planName).join('、'))
const head = computed(() => generatedFormHead(props.activity, props.kind, planNames.value))
const body = computed(() => generatedFormBody(props.activity, props.kind))

function download() {
  downloadFile(`${props.activity.name}_${props.kind}.html`, wrapDoc(props.kind, head.value + body.value))
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="card">
      <div v-html="head"></div>
      <div v-html="body"></div>
      <div class="row" style="margin-top:20px">
        <button class="btn" @click="download">下載</button>
        <button class="btn ghost" @click="emit('close')">關閉</button>
      </div>
    </div>
  </div>
</template>
