<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { errorMessage, pushToast } from '../composables/useToast'
import { confirm } from '../composables/useConfirm'
import { useEscape } from '../composables/useEscape'
import { ONLINE_PLACE_LABEL } from '../types'
import type { ActivityCategory, ActivityRecord, PlaceMode } from '../types'
import MultiSelectDropdown from './MultiSelectDropdown.vue'
import PlaceAutocompleteInput from './PlaceAutocompleteInput.vue'

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
const placeMode = ref<PlaceMode>(props.activity?.placeMode ?? 'physical')
// 地址與會議連結分開存，切換「實體／線上」時不會把另一邊已經輸入的內容清掉；
// 線上活動的 place 固定是「線上」，不是地址，編輯時地址欄從空白開始。
const address = ref(props.activity?.placeMode === 'online' ? '' : (props.activity?.place ?? ''))
const meetingUrl = ref(props.activity?.meetingUrl ?? '')
const meetingUrlError = ref('')
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
    placeMode: placeMode.value,
    address: address.value,
    meetingUrl: meetingUrl.value,
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
  if (snapshot() !== initialSnapshot && !(await confirm('這份活動還沒儲存，確定要放棄目前輸入的內容嗎？', '放棄'))) {
    return
  }
  emit('close')
}
useEscape(requestClose)

// 選了計畫後，分類清單只顯示那些計畫底下的項目（沒有指定所屬計畫的分類
// 不限，任何計畫都會顯示）。沒選任何計畫時顯示全部分類。
const categoryOptions = computed(() => {
  const selectedPlanIds = new Set(selectedPlans.value)
  const visible = selectedPlanIds.size
    ? db.categories.filter((c) => !c.planIds.length || c.planIds.some((id) => selectedPlanIds.has(id)))
    : db.categories
  return visible.map((c) => ({ id: c.name, label: c.name }))
})
const planOptions = () => db.plans.map((p) => ({ id: p.id, label: p.name }))

// 取消勾選計畫後，原本跟著那個計畫跳出來的分類選項也要一併從已選清單移除，
// 不然使用者會看到分類還留著，但選單裡其實已經找不到它。
watch(selectedPlans, () => {
  const validNames = new Set(categoryOptions.value.map((o) => o.id))
  categories.value = categories.value.filter((c) => validNames.has(c))
})

watch([male, female], ([m, f]) => {
  total.value = (Number(m) || 0) + (Number(f) || 0)
})

const submitting = ref(false)

async function submit() {
  // 存檔是非同步的，手機網路較慢時，畫面在請求完成前不會有明顯變化，很容易讓人
  // 以為沒點到而再點一次——尤其是「建立活動」，重複送出就是重複建立一筆新的
  // 活動。這裡擋掉還在送出中的重複呼叫。
  if (submitting.value) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    nameError.value = true
    return
  }
  const url = meetingUrl.value.trim()
  if (placeMode.value === 'online' && url && !/^https?:\/\//i.test(url)) {
    meetingUrlError.value = '會議連結要以 http:// 或 https:// 開頭'
    return
  }
  const online = placeMode.value === 'online'
  const input = {
    name: trimmed,
    categories: categories.value,
    date: date.value,
    time: time.value,
    timeEnd: timeEnd.value,
    placeMode: placeMode.value,
    place: online ? ONLINE_PLACE_LABEL : address.value.trim(),
    meetingUrl: online ? url : '',
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
  submitting.value = true
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
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="modal" @click.self="requestClose">
    <div class="card">
      <h2>{{ isNew ? '建立活動' : '編輯基本資料' }}</h2>

      <div class="grid2">
        <div>
          <label>對應計畫（可複選）</label>
          <MultiSelectDropdown v-model="selectedPlans" :options="planOptions()" placeholder="請選擇計畫" />
        </div>
        <div>
          <label>活動分類（可複選）</label>
          <MultiSelectDropdown v-model="categories" :options="categoryOptions" placeholder="請選擇活動分類" />
          <p v-if="selectedPlans.length" class="hint">依已選計畫篩選相關項目</p>
        </div>
      </div>

      <div class="field">
        <label>活動名稱／事由</label>
        <input v-model="name" placeholder="例如：溪畔淨溪與生態導覽" @input="nameError = false">
        <p v-if="nameError" class="field-error">請輸入活動名稱</p>
      </div>

      <div class="grid3 field">
        <div><label>活動日期</label><input type="date" v-model="date"></div>
        <div><label>開始時間（選填）</label><input type="time" v-model="time"></div>
        <div><label>結束時間（選填，同一時間可留空）</label><input type="time" v-model="timeEnd"></div>
      </div>

      <div class="field">
        <label>地點</label>
        <div class="row" style="gap:16px;margin-bottom:6px">
          <label class="chk"><input type="radio" value="physical" v-model="placeMode">實體</label>
          <label class="chk"><input type="radio" value="online" v-model="placeMode">線上</label>
        </div>
        <PlaceAutocompleteInput v-if="placeMode === 'physical'" v-model="address" placeholder="輸入地址，會自動帶出建議" />
        <template v-else>
          <input
            v-model="meetingUrl"
            type="url"
            inputmode="url"
            placeholder="會議連結，例如：https://meet.google.com/xxx-xxxx-xxx"
            @input="meetingUrlError = ''"
          >
          <p v-if="meetingUrlError" class="field-error">{{ meetingUrlError }}</p>
        </template>
      </div>

      <div class="field">
        <label>負責人</label>
        <input v-model="owner" maxlength="100" placeholder="例如：王小明">
        <p class="hint">產生公文時會作為聯絡人。</p>
      </div>

      <div class="field">
        <label>與會單位或成員</label>
        <input v-model="attendees" placeholder="例如：○○里辦公室、○○協會">
      </div>

      <label class="field">參加對象說明</label>
      <input v-model="participantDesc" placeholder="例如：社區長者及居民">

      <label class="field">與會人數統計</label>
      <div class="grid3">
        <div><label>男性人數</label><input type="number" min="0" v-model.number="male"></div>
        <div><label>女性人數</label><input type="number" min="0" v-model.number="female"></div>
        <div><label>合計人數</label><input type="number" min="0" v-model.number="total"></div>
      </div>

      <label class="field">備註</label>
      <input v-model="remark" placeholder="補充說明（如場次、申請事項）">

      <div class="row actions">
        <button class="btn" :disabled="submitting" @click="submit">
          {{ submitting ? '處理中…' : (isNew ? '建立' : '儲存') }}
        </button>
        <button class="btn ghost" @click="requestClose">取消</button>
      </div>
    </div>
  </div>
</template>
