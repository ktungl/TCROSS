<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { errorMessage, pushToast } from '../composables/useToast'
import { confirm } from '../composables/useConfirm'
import { useEscape } from '../composables/useEscape'
import { checkBasicInfo, consistencyConfirmMessage } from '../utils/activity'
import { ONLINE_PLACE_LABEL, hasOnline, hasPhysical } from '../types'
import type { ActivityCategory, ActivityRecord, PlaceMode } from '../types'
import MultiSelectDropdown from './MultiSelectDropdown.vue'
import PlaceAutocompleteInput from './PlaceAutocompleteInput.vue'
import PosterAssist from './PosterAssist.vue'
import ClassifySuggest from './ClassifySuggest.vue'
import type { PosterField } from '../lib/middleware'

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
const venue = ref(props.activity?.venue ?? '')
const meetingUrl = ref(props.activity?.meetingUrl ?? '')
const meetingUrlError = ref('')

// 實體、線上可以複選（實體＋線上同時進行就是 hybrid），至少要勾一個
const isPhysical = computed({
  get: () => hasPhysical(placeMode.value),
  set: (on) => setPlaceMode(on, isOnline.value),
})
const isOnline = computed({
  get: () => hasOnline(placeMode.value),
  set: (on) => setPlaceMode(isPhysical.value, on),
})
function setPlaceMode(physical: boolean, online: boolean) {
  if (!physical && !online) return
  placeMode.value = physical && online ? 'hybrid' : physical ? 'physical' : 'online'
}
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
    venue: venue.value,
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

// 合計原本等於男＋女時才跟著自動加總；使用者手動改過合計（例如有未填性別的人）
// 就不再覆蓋，改在欄位下方提示兩者不一致。
const sumMF = () => (Number(male.value) || 0) + (Number(female.value) || 0)
watch([male, female], ([m, f], [om, of]) => {
  if ((Number(total.value) || 0) === (Number(om) || 0) + (Number(of) || 0)) {
    total.value = (Number(m) || 0) + (Number(f) || 0)
  }
})
const totalMismatch = computed(() => (Number(total.value) || 0) !== sumMF())

// AI 輔助（doc/AI_UPGRADE_PLAN.md 2-1、2-2）：只產生建議，使用者勾選／點選後才寫進表單
const posterDescription = ref('')
const posterCurrent = computed<Record<PosterField, string>>(() => ({
  name: name.value,
  date: date.value,
  time: time.value,
  timeEnd: timeEnd.value,
  placeMode: placeMode.value,
  place: address.value,
  venue: venue.value,
  participantDesc: participantDesc.value,
  attendees: attendees.value,
}))
function applyPoster(fields: Partial<Record<PosterField, string>>) {
  if (fields.name) {
    name.value = fields.name
    nameError.value = false
  }
  if (fields.date) date.value = fields.date
  if (fields.time) time.value = fields.time
  if (fields.timeEnd) timeEnd.value = fields.timeEnd
  if (fields.placeMode === 'online' || fields.placeMode === 'physical') placeMode.value = fields.placeMode
  if (fields.place) address.value = fields.place
  if (fields.venue) venue.value = fields.venue
  if (fields.participantDesc) participantDesc.value = fields.participantDesc
  if (fields.attendees) attendees.value = fields.attendees
}
const classifyText = computed(() =>
  [
    name.value && `活動名稱：${name.value}`,
    posterDescription.value && `活動簡述：${posterDescription.value}`,
    participantDesc.value && `參加對象：${participantDesc.value}`,
    attendees.value && `與會單位：${attendees.value}`,
    remark.value && `備註：${remark.value}`,
  ]
    .filter(Boolean)
    .join('\n'),
)
function addSuggested(planIds: string[], cats: string[]) {
  selectedPlans.value = [...new Set([...selectedPlans.value, ...planIds])]
  categories.value = [...new Set([...categories.value, ...cats])]
}

// 防呆：前後矛盾（例如名稱寫週六、日期選成週五）即時列出，存檔前再確認一次
const consistencyIssues = computed(() =>
  checkBasicInfo({
    name: name.value,
    date: date.value,
    time: time.value,
    timeEnd: timeEnd.value,
    placeMode: placeMode.value,
    address: address.value,
    meetingUrl: meetingUrl.value,
    participantDesc: participantDesc.value,
    remark: remark.value,
    headcount: { male: Number(male.value) || 0, female: Number(female.value) || 0, total: Number(total.value) || 0 },
  }),
)

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
  if (isOnline.value && url && !/^https?:\/\//i.test(url)) {
    meetingUrlError.value = '會議連結要以 http:// 或 https:// 開頭'
    return
  }
  const issues = consistencyIssues.value
  if (issues.length && !(await confirm(consistencyConfirmMessage(issues), '仍要儲存'))) {
    return
  }
  const physical = isPhysical.value
  const input = {
    name: trimmed,
    categories: categories.value,
    date: date.value,
    time: time.value,
    timeEnd: timeEnd.value,
    placeMode: placeMode.value,
    place: physical ? address.value.trim() : ONLINE_PLACE_LABEL,
    venue: physical ? venue.value.trim() : '',
    meetingUrl: isOnline.value ? url : '',
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
  <div class="modal" v-modal-focus @click.self="requestClose">
    <div class="card">
      <h2>{{ isNew ? '建立活動' : '編輯基本資料' }}</h2>
      <PosterAssist v-if="isNew" :current="posterCurrent" @apply="applyPoster" @description="posterDescription = $event" />

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
      <ClassifySuggest :text="classifyText" :categories="categories" :plans="selectedPlans" @add="addSuggested" />

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
          <label class="chk"><input type="checkbox" v-model="isPhysical" :disabled="isPhysical && !isOnline">實體</label>
          <label class="chk"><input type="checkbox" v-model="isOnline" :disabled="isOnline && !isPhysical">線上</label>
          <span class="hint" style="margin:0">可複選（實體＋線上同時進行）</span>
        </div>
        <template v-if="isPhysical">
          <PlaceAutocompleteInput v-model="address" placeholder="輸入地址，會自動帶出建議" />
          <input v-model="venue" class="field" maxlength="100" placeholder="場地名稱（選填），例如：南投清流部落共生之家">
          <p class="hint">場地名稱會用在領據摘要；沒填就改用地址。</p>
        </template>
        <template v-if="isOnline">
          <input
            v-model="meetingUrl"
            :class="{ field: isPhysical }"
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
      <p class="hint">
        <template v-if="totalMismatch">合計與男女加總（{{ sumMF() }}）不同，以合計人數為準。<button type="button" class="link" @click="total = sumMF()">改回加總</button></template>
        <template v-else>合計會依男女人數自動加總，也可以手動修改。</template>
      </p>

      <label class="field">備註</label>
      <input v-model="remark" placeholder="補充說明（如場次、申請事項）">

      <div v-if="consistencyIssues.length" class="warn-box field">
        <strong>請確認以下內容（不影響儲存）</strong>
        <ul>
          <li v-for="issue in consistencyIssues" :key="issue">{{ issue }}</li>
        </ul>
      </div>

      <div class="row actions">
        <button class="btn" :disabled="submitting" @click="submit">
          {{ submitting ? '處理中…' : (isNew ? '建立' : '儲存') }}
        </button>
        <button class="btn ghost" @click="requestClose">取消</button>
      </div>
    </div>
  </div>
</template>
