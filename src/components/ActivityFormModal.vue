<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { errorMessage, pushToast } from '../composables/useToast'
import { confirm } from '../composables/useConfirm'
import type { ActivityCategory, ActivityRecord } from '../types'
import { loadGoogleMapsPlaces } from '../lib/googleMaps'
import MultiSelectDropdown from './MultiSelectDropdown.vue'

const props = defineProps<{ activity?: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const db = useDbStore()
const isNew = !props.activity

const name = ref(props.activity?.name ?? '')
const categories = ref<ActivityCategory[]>(props.activity ? [...props.activity.categories] : [])
const date = ref(props.activity?.date ?? '')
const time = ref(props.activity?.time ?? '')
const timeEnd = ref(props.activity?.timeEnd ?? '')
const place = ref(props.activity?.place ?? '')
const owner = ref(props.activity?.owner ?? '')
const attendees = ref(props.activity?.attendees ?? '')
const participantDesc = ref(props.activity?.participantDesc ?? '')
const male = ref(props.activity?.headcount.male ?? 0)
const female = ref(props.activity?.headcount.female ?? 0)
const total = ref(props.activity?.headcount.total ?? 0)
const remark = ref(props.activity?.remark ?? '')
const selectedPlans = ref<string[]>(props.activity ? [...props.activity.plans] : [])
const nameError = ref(false)

// 點到 modal 背景或按「取消」都會直接關閉、清掉整份還沒存檔的表單內容——
// 不小心點到旁邊就要整份重打。這裡記一份初始狀態，只要跟目前輸入不一樣
// （代表使用者已經動過表單），關閉前就跳出確認，而不是直接消失。
function snapshot() {
  return JSON.stringify({
    name: name.value,
    categories: categories.value,
    date: date.value,
    time: time.value,
    timeEnd: timeEnd.value,
    place: place.value,
    owner: owner.value,
    attendees: attendees.value,
    participantDesc: participantDesc.value,
    male: male.value,
    female: female.value,
    total: total.value,
    remark: remark.value,
    plans: selectedPlans.value,
  })
}
const initialSnapshot = snapshot()

async function requestClose() {
  if (snapshot() !== initialSnapshot && !(await confirm('這份活動還沒儲存，確定要放棄目前輸入的內容嗎？'))) {
    return
  }
  emit('close')
}

// 選了專案名稱後，分類清單只顯示那些專案底下的項目（沒有指定所屬專案的分類
// 不限，任何專案都會顯示）。沒選任何專案時顯示全部分類。
const categoryOptions = computed(() => {
  const selectedPlanIds = new Set(selectedPlans.value)
  const visible = selectedPlanIds.size
    ? db.categories.filter((c) => !c.planIds.length || c.planIds.some((id) => selectedPlanIds.has(id)))
    : db.categories
  return visible.map((c) => ({ id: c.name, label: c.name }))
})
const planOptions = () => db.plans.map((p) => ({ id: p.id, label: p.name }))

// 取消勾選專案後，原本跟著那個專案跳出來的分類選項也要一併從已選清單移除，
// 不然使用者會看到分類還留著，但選單裡其實已經找不到它。
watch(selectedPlans, () => {
  const validNames = new Set(categoryOptions.value.map((o) => o.id))
  categories.value = categories.value.filter((c) => validNames.has(c))
})

watch([male, female], ([m, f]) => {
  total.value = (Number(m) || 0) + (Number(f) || 0)
})

// 地點欄位的 Google 地址自動建議；沒設 VITE_GOOGLE_MAPS_API_KEY 時 loadGoogleMapsPlaces()
// 回傳 null，這裡就靜默略過，不影響地點欄位原本手動輸入的功能。
const placeInput = ref<HTMLInputElement | null>(null)
let placeAutocomplete: google.maps.places.Autocomplete | null = null

onMounted(async () => {
  const loading = loadGoogleMapsPlaces()
  if (!loading || !placeInput.value) return
  try {
    const g = await loading
    placeAutocomplete = new g.maps.places.Autocomplete(placeInput.value, {
      fields: ['formatted_address', 'name'],
      componentRestrictions: { country: 'tw' },
    })
    placeAutocomplete.addListener('place_changed', () => {
      const selected = placeAutocomplete!.getPlace()
      const address = selected.formatted_address || selected.name
      if (address) place.value = address
    })
  } catch {
    // 地址自動建議載入失敗時不影響手動輸入地點，靜默略過即可。
  }
})

onBeforeUnmount(() => {
  if (placeAutocomplete) google.maps.event.clearInstanceListeners(placeAutocomplete)
})

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    nameError.value = true
    return
  }
  const input = {
    name: trimmed,
    categories: categories.value,
    date: date.value,
    time: time.value,
    timeEnd: timeEnd.value,
    place: place.value.trim(),
    owner: owner.value.trim(),
    attendees: attendees.value.trim(),
    participantDesc: participantDesc.value.trim(),
    headcount: {
      male: Number(male.value) || 0,
      female: Number(female.value) || 0,
      total: Number(total.value) || 0,
    },
    plans: selectedPlans.value,
    remark: remark.value.trim(),
  }
  try {
    if (isNew) {
      const created = await db.createActivity(input)
      pushToast('已建立活動')
      emit('close')
      router.push({ name: 'detail', params: { id: created.id } })
    } else if (props.activity) {
      await db.updateActivity(props.activity.id, input)
      pushToast('已儲存')
      emit('close')
    }
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
</script>

<template>
  <div class="modal" @click.self="requestClose">
    <div class="card">
      <h2 style="margin-top:0">{{ isNew ? '建立活動' : '編輯基本資料' }}</h2>

      <div class="grid2">
        <div>
          <label>專案名稱（可複選）</label>
          <MultiSelectDropdown v-model="selectedPlans" :options="planOptions()" placeholder="請選擇專案名稱" />
        </div>
        <div>
          <label>活動分類（可複選）</label>
          <MultiSelectDropdown v-model="categories" :options="categoryOptions" placeholder="請選擇活動分類" />
          <p v-if="selectedPlans.length" class="meta" style="font-size:11.5px;margin:4px 0 0">依已選專案篩選相關項目</p>
        </div>
      </div>

      <div style="margin-top:12px">
        <label>活動名稱／事由</label>
        <input v-model="name" placeholder="例如：溪畔淨溪與生態導覽" @input="nameError = false">
        <p v-if="nameError" style="color:var(--stamp);font-size:12px;margin:4px 0 0">請輸入活動名稱</p>
      </div>

      <div class="grid3" style="margin-top:12px">
        <div><label>活動日期</label><input type="date" v-model="date"></div>
        <div><label>開始時間（選填）</label><input type="time" v-model="time"></div>
        <div><label>結束時間（選填，同一時間可留空）</label><input type="time" v-model="timeEnd"></div>
      </div>

      <div style="margin-top:12px">
        <label>地點</label>
        <input ref="placeInput" v-model="place" placeholder="輸入地址，會自動帶出建議" autocomplete="off">
      </div>

      <div class="grid2" style="margin-top:12px">
        <div><label>負責人</label><input v-model="owner"></div>
        <div><label>與會單位或成員</label><input v-model="attendees" placeholder="例如：○○里辦公室、○○協會"></div>
      </div>

      <label style="margin-top:14px">參加對象說明</label>
      <input v-model="participantDesc" placeholder="例如：社區長者及居民">

      <label style="margin-top:14px">與會人數統計</label>
      <div class="grid3">
        <div><label>男性人數</label><input type="number" min="0" v-model.number="male"></div>
        <div><label>女性人數</label><input type="number" min="0" v-model.number="female"></div>
        <div><label>合計人數</label><input type="number" min="0" v-model.number="total"></div>
      </div>

      <label style="margin-top:14px">備註</label>
      <input v-model="remark" placeholder="補充說明（如場次、申請事項）">

      <div class="row" style="margin-top:20px">
        <button class="btn" @click="submit">{{ isNew ? '建立' : '儲存' }}</button>
        <button class="btn ghost" @click="requestClose">取消</button>
      </div>
    </div>
  </div>
</template>
