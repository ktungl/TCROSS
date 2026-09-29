<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { loadGoogleMapsPlaces } from '../lib/googleMaps'

// 地點欄位的 Google 地址自動建議（Places API (New) 的 AutocompleteSuggestion）。
// 刻意不用 Google 的 <gmp-place-autocomplete> 元件：它自帶 shadow DOM 輸入框，沒辦法
// v-model、帶入既有地點、沿用表單樣式，也讀不到使用者手動打、沒選建議的文字。
// 這裡保留原本的 <input>，只把建議清單換成新版 API 自己畫。
// 沒設 VITE_GOOGLE_MAPS_API_KEY、載入失敗或 API 回錯誤時就只是一般輸入框。
const model = defineModel<string>({ required: true })
defineProps<{ placeholder?: string }>()

type Suggestion = { prediction: google.maps.places.PlacePrediction; main: string; secondary: string }

let places: typeof google.maps.places | null = null
let sessionToken: google.maps.places.AutocompleteSessionToken | null = null
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let requestSeq = 0

const suggestions = ref<Suggestion[]>([])
const open = ref(false)
const active = ref(-1)

onMounted(async () => {
  const loading = loadGoogleMapsPlaces()
  if (!loading) return
  try {
    places = (await loading).maps.places
  } catch {
    // 地址自動建議載入失敗時不影響手動輸入地點，靜默略過即可。
  }
})

onBeforeUnmount(() => clearTimeout(debounceTimer))

function close() {
  open.value = false
  active.value = -1
}

function onInput() {
  clearTimeout(debounceTimer)
  const text = model.value.trim()
  if (!places || !text) {
    requestSeq++
    suggestions.value = []
    close()
    return
  }
  debounceTimer = setTimeout(() => fetchSuggestions(text), 250)
}

async function fetchSuggestions(text: string) {
  if (!places) return
  const seq = ++requestSeq
  sessionToken ??= new places.AutocompleteSessionToken()
  try {
    const { suggestions: result } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text,
      sessionToken,
      includedRegionCodes: ['tw'],
      language: 'zh-TW',
      region: 'tw',
    })
    // 打字很快時，較早送出的請求可能比較晚回來，只採用最後一次的結果。
    if (seq !== requestSeq) return
    suggestions.value = result.flatMap((s) => (s.placePrediction ? [{
      prediction: s.placePrediction,
      main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
      secondary: s.placePrediction.secondaryText?.text ?? '',
    }] : []))
    active.value = -1
    open.value = suggestions.value.length > 0
  } catch (err) {
    // 多半是 Google Cloud 專案沒啟用 Places API (New)，或金鑰的 API 限制沒勾它。
    // 之後就不再打 API，欄位退回一般手動輸入。
    console.warn('[地點建議] Places API (New) 呼叫失敗，改為手動輸入：', err)
    places = null
    suggestions.value = []
    close()
  }
}

async function select(s: Suggestion) {
  close()
  model.value = s.prediction.text.text
  try {
    const place = s.prediction.toPlace()
    await place.fetchFields({ fields: ['formattedAddress', 'displayName'] })
    const address = place.formattedAddress || place.displayName
    if (address) model.value = address
  } catch {
    // 取不到完整地址就沿用建議清單上的文字。
  }
  // 選定地點＝這次 session 結束，下次輸入要用新的 token（Google 計費規則）。
  sessionToken = null
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = suggestions.value.length
    active.value = e.key === 'ArrowDown' ? (active.value + 1) % n : (active.value - 1 + n) % n
  } else if (e.key === 'Enter' && active.value >= 0) {
    e.preventDefault()
    select(suggestions.value[active.value]!)
  } else if (e.key === 'Escape') {
    // 只關建議清單，不要連外層 modal 一起關掉。
    e.stopPropagation()
    close()
  }
}
</script>

<template>
  <div class="pac">
    <input
      v-model="model"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @keydown="onKeydown"
      @blur="close"
      @focus="open = suggestions.length > 0"
    >
    <!-- mousedown.prevent：不讓輸入框先 blur 把清單關掉，click 才點得到 -->
    <div v-if="open" class="pac-panel" @mousedown.prevent>
      <div
        v-for="(s, i) in suggestions"
        :key="s.prediction.placeId"
        class="pac-item"
        :class="{ active: i === active }"
        @mouseenter="active = i"
        @click="select(s)"
      >
        <span class="pac-main">{{ s.main }}</span>
        <span v-if="s.secondary" class="pac-sub">{{ s.secondary }}</span>
      </div>
      <div class="pac-logo">Google 提供</div>
    </div>
  </div>
</template>

<style scoped>
.pac{position:relative}
.pac-panel{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;
  max-height:260px;overflow:auto;background:var(--card);border:1px solid var(--line);
  border-radius:var(--r);box-shadow:0 6px 18px rgba(62,44,23,.15)}
.pac-item{padding:8px 11px;cursor:pointer;line-height:1.4}
.pac-item.active{background:var(--line-soft)}
.pac-main{display:block;color:var(--ink);font-size:14px}
.pac-sub{display:block;color:var(--ink-soft);font-size:12px}
.pac-logo{padding:4px 11px 6px;text-align:right;color:var(--ink-faint);font-size:11px}
</style>
