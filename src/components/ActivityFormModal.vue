<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { errorMessage, pushToast } from '../composables/useToast'
import { ACTIVITY_CATEGORIES } from '../types'
import type { ActivityCategory, ActivityRecord } from '../types'
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

const categoryOptions = ACTIVITY_CATEGORIES.map((c) => ({ id: c, label: c }))
const planOptions = () => db.plans.map((p) => ({ id: p.id, label: p.name }))

watch([male, female], ([m, f]) => {
  total.value = (Number(m) || 0) + (Number(f) || 0)
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
  <div class="modal" @click.self="emit('close')">
    <div class="card">
      <h2 style="margin-top:0">{{ isNew ? '建立活動' : '編輯基本資料' }}</h2>

      <div class="grid2">
        <div>
          <label>對應計畫（可複選）</label>
          <MultiSelectDropdown v-model="selectedPlans" :options="planOptions()" placeholder="請選擇對應計畫" />
        </div>
        <div>
          <label>活動分類（可複選）</label>
          <MultiSelectDropdown v-model="categories" :options="categoryOptions" placeholder="請選擇活動分類" />
        </div>
      </div>

      <div style="margin-top:12px">
        <label>活動名稱／事由</label>
        <input v-model="name" placeholder="例如：溪畔淨溪與生態導覽" @input="nameError = false">
        <p v-if="nameError" style="color:var(--stamp);font-size:12px;margin:4px 0 0">請輸入活動名稱</p>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div><label>活動日期</label><input type="date" v-model="date"></div>
        <div><label>活動時間（選填）</label><input type="time" v-model="time"></div>
      </div>

      <div class="grid3" style="margin-top:12px">
        <div><label>地點</label><input v-model="place"></div>
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
        <button class="btn ghost" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
