<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import type { ActivityRecord } from '../types'

const props = defineProps<{ activity?: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const db = useDbStore()
const isNew = !props.activity

const name = ref(props.activity?.name ?? '')
const date = ref(props.activity?.date ?? '')
const place = ref(props.activity?.place ?? '')
const owner = ref(props.activity?.owner ?? '')
const headcount = ref(props.activity?.headcount ?? 0)
const selectedPlans = ref<string[]>(props.activity ? [...props.activity.plans] : [])
const nameError = ref(false)

function togglePlan(id: string, checked: boolean) {
  selectedPlans.value = checked
    ? [...selectedPlans.value, id]
    : selectedPlans.value.filter((p) => p !== id)
}

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    nameError.value = true
    return
  }
  const input = {
    name: trimmed,
    date: date.value,
    place: place.value.trim(),
    owner: owner.value.trim(),
    headcount: Number(headcount.value) || 0,
    plans: selectedPlans.value,
  }
  if (isNew) {
    const created = await db.createActivity(input)
    emit('close')
    router.push({ name: 'detail', params: { id: created.id } })
  } else if (props.activity) {
    await db.updateActivity(props.activity.id, input)
    emit('close')
  }
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="card">
      <h2 style="margin-top:0">{{ isNew ? '建立活動' : '編輯基本資料' }}</h2>
      <div>
        <label>活動名稱</label>
        <input v-model="name" placeholder="例如：溪畔淨溪與生態導覽" @input="nameError = false">
        <p v-if="nameError" style="color:var(--stamp);font-size:12px;margin:4px 0 0">請輸入活動名稱</p>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div><label>日期</label><input type="date" v-model="date"></div>
        <div><label>地點</label><input v-model="place"></div>
        <div><label>負責人</label><input v-model="owner"></div>
        <div><label>預估參與人數</label><input type="number" v-model.number="headcount"></div>
      </div>
      <label style="margin-top:14px">對應計畫（可複選）</label>
      <div>
        <label v-for="p in db.plans" :key="p.id" class="chk" style="margin-bottom:5px">
          <input
            type="checkbox"
            :checked="selectedPlans.includes(p.id)"
            @change="togglePlan(p.id, ($event.target as HTMLInputElement).checked)"
          >{{ p.name }}
        </label>
        <span v-if="!db.plans.length" class="empty" style="padding:0">還沒有計畫，可先建活動之後再掛。</span>
      </div>
      <div class="row" style="margin-top:20px">
        <button class="btn" @click="submit">{{ isNew ? '建立' : '儲存' }}</button>
        <button class="btn ghost" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
