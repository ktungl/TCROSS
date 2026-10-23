<script setup lang="ts">
import { computed, ref } from 'vue'
import { assistPoster } from '../lib/middleware'
import type { PosterField, PosterSuggestion } from '../lib/middleware'
import { errorMessage, pushToast } from '../composables/useToast'
import { prepareImageForAi } from '../utils/aiImages'
import { localDateString } from '../utils/date'

/** 表單目前的值（只用來顯示「目前 → 建議」與決定預設勾選） */
const props = defineProps<{ current: Record<PosterField, string> }>()
const emit = defineEmits<{
  apply: [fields: Partial<Record<PosterField, string>>]
  /** 海報上的活動簡述，給「AI 推薦分類」當參考 */
  description: [text: string]
}>()

const FIELD_LABELS: [PosterField, string][] = [
  ['name', '活動名稱'],
  ['date', '活動日期'],
  ['time', '開始時間'],
  ['timeEnd', '結束時間'],
  ['placeMode', '實體／線上'],
  ['place', '地址'],
  ['venue', '場地名稱'],
  ['participantDesc', '參加對象'],
  ['attendees', '與會單位或成員'],
]

const loading = ref(false)
const suggestion = ref<Partial<Record<PosterField, string>> | null>(null)
const checked = ref<PosterField[]>([])

function toFields(s: PosterSuggestion): Partial<Record<PosterField, string>> {
  const fields: Partial<Record<PosterField, string>> = {
    name: s.name,
    date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : '',
    time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '',
    timeEnd: /^\d{2}:\d{2}$/.test(s.timeEnd) ? s.timeEnd : '',
    placeMode: s.online ? 'online' : s.place || s.venue ? 'physical' : '',
    place: s.online ? '' : s.place,
    venue: s.online ? '' : s.venue,
    participantDesc: s.participantDesc,
    attendees: s.attendees,
  }
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Record<PosterField, string>>
}

const rows = computed(() =>
  suggestion.value
    ? FIELD_LABELS.filter(([key]) => suggestion.value?.[key]).map(([key, label]) => ({
        key,
        label,
        current: props.current[key],
        next: suggestion.value![key]!,
      }))
    : [],
)

function display(key: PosterField, value: string): string {
  if (key === 'placeMode') return value === 'online' ? '線上' : value === 'physical' ? '實體' : value === 'hybrid' ? '實體＋線上' : ''
  return value
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  loading.value = true
  let previewUrl = ''
  try {
    const image = await prepareImageForAi(file)
    previewUrl = image.previewUrl
    const result = await assistPoster({ data: image.data, mimeType: image.mimeType }, localDateString())
    suggestion.value = toFields(result)
    // 表單已經有值的欄位預設不勾，避免蓋掉使用者打好的內容
    checked.value = rows.value.filter((r) => !r.current || (r.key === 'placeMode' && r.next === r.current)).map((r) => r.key)
    if (result.description) emit('description', result.description)
    if (!rows.value.length) pushToast('海報上沒有辨識出活動資訊', 'error')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    loading.value = false
  }
}

function apply() {
  if (!suggestion.value) return
  const picked = Object.fromEntries(checked.value.map((k) => [k, suggestion.value![k]!]))
  emit('apply', picked)
  suggestion.value = null
  pushToast(`已帶入 ${checked.value.length} 個欄位，請再檢查一次`)
}
</script>

<template>
  <div class="poster-assist">
    <label class="btn ghost sm" :class="{ disabled: loading }">
      {{ loading ? '辨識海報中…' : '從海報／邀請函帶入' }}
      <input type="file" accept="image/*" hidden :disabled="loading" @change="onPick">
    </label>
    <span class="hint">上傳活動海報照片，AI 會建議活動名稱、日期、地點等欄位（圖片不會存檔）</span>

    <div v-if="rows.length" class="warn-box field">
      <strong>海報辨識結果：勾選要帶入的欄位</strong>
      <label v-for="r in rows" :key="r.key" class="chk suggest-row">
        <input v-model="checked" type="checkbox" :value="r.key">
        <span><b>{{ r.label }}</b>：{{ display(r.key, r.next) }}<span v-if="r.current && r.current !== r.next" class="hint">（目前：{{ display(r.key, r.current) }}）</span></span>
      </label>
      <div class="row actions">
        <button class="btn sm" type="button" :disabled="!checked.length" @click="apply">帶入勾選的欄位</button>
        <button class="btn ghost sm" type="button" @click="suggestion = null">不用了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.poster-assist{margin-bottom:14px}
.poster-assist .hint{margin-left:8px}
.suggest-row{display:flex;gap:6px;align-items:flex-start;margin-top:6px}
</style>
