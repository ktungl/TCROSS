<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import StampLine from './StampLine.vue'

const router = useRouter()
const db = useDbStore()
const planName = ref('')
const planNameInput = ref<HTMLInputElement | null>(null)
const editingId = ref('')
const editingName = ref('')

async function addPlan() {
  const n = planName.value.trim()
  if (!n) {
    pushToast('請先輸入計畫名稱', 'error')
    planNameInput.value?.focus()
    return
  }
  try {
    await db.createPlan(n)
    planName.value = ''
    pushToast('已新增計畫')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

function startRename(id: string, name: string) {
  editingId.value = id
  editingName.value = name
}

function cancelRename() {
  editingId.value = ''
  editingName.value = ''
}

async function saveRename() {
  const n = editingName.value.trim()
  if (!n) {
    pushToast('計畫名稱不能為空', 'error')
    return
  }
  try {
    await db.renamePlan(editingId.value, n)
    pushToast('已更新計畫名稱')
    cancelRename()
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function removePlan(id: string, name: string) {
  if (!(await confirm(`確定要刪除計畫「${name}」嗎？旗下活動不會被刪除，只會解除歸屬。`, '刪除計畫', true))) return
  try {
    await db.deletePlan(id)
    pushToast('已刪除計畫')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
</script>

<template>
  <p class="sub">計畫是活動的收納夾，一個活動可以同時屬於多個計畫。</p>
  <div class="card section-gap">
    <div class="row">
      <input class="grow" ref="planNameInput" v-model="planName" placeholder="計畫名稱，例如：2026 社區共好計畫" @keyup.enter="addPlan">
      <button class="btn" @click="addPlan">新增計畫</button>
    </div>
  </div>

  <div v-for="p in db.plans" :key="p.id" class="card item-gap">
    <div v-if="editingId === p.id" class="row">
      <input class="grow" v-model="editingName" @keyup.enter="saveRename" @keyup.esc="cancelRename">
      <button class="btn sm" @click="saveRename">儲存</button>
      <button class="btn ghost sm" @click="cancelRename">取消</button>
    </div>
    <div v-else class="row between">
      <button
        class="bare-btn"
        @click="router.push({ name: 'plan-detail', params: { id: p.id } })"
      >
        <strong>{{ p.name }}</strong>
        <div class="card-meta">
          {{ db.activities.filter(a => a.plans.includes(p.id)).length }} 場活動　·
          {{ db.activities.filter(a => a.plans.includes(p.id) && gaps(a).length).length }} 場有缺漏
        </div>
        <StampLine :record="p" />
      </button>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" title="重新命名" @click="startRename(p.id, p.name)">編輯</button>
        <button class="x" title="刪除計畫" @click="removePlan(p.id, p.name)">×</button>
      </div>
    </div>
  </div>
  <p v-if="!db.plans.length" class="empty flush">還沒有計畫。</p>
</template>
