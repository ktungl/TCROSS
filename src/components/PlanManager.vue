<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'

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
  if (!(await confirm(`確定要刪除計畫「${name}」嗎？旗下活動不會被刪除，只會解除歸屬。`))) return
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
  <div class="card" style="margin-bottom:20px">
    <div class="row">
      <input ref="planNameInput" v-model="planName" placeholder="計畫名稱，例如：2026 社區共好計畫" style="flex:1;min-width:220px" @keyup.enter="addPlan">
      <button class="btn" @click="addPlan">新增計畫</button>
    </div>
  </div>

  <div v-for="p in db.plans" :key="p.id" class="card" style="margin-bottom:10px">
    <div v-if="editingId === p.id" class="row">
      <input v-model="editingName" style="flex:1;min-width:220px" @keyup.enter="saveRename" @keyup.esc="cancelRename">
      <button class="btn sm" @click="saveRename">儲存</button>
      <button class="btn ghost sm" @click="cancelRename">取消</button>
    </div>
    <div v-else class="row" style="justify-content:space-between">
      <button
        style="background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer"
        @click="router.push({ name: 'plan-detail', params: { id: p.id } })"
      >
        <strong>{{ p.name }}</strong>
        <div class="meta" style="font-size:12px;color:var(--ink-soft)">
          {{ db.activities.filter(a => a.plans.includes(p.id)).length }} 場活動　·
          {{ db.activities.filter(a => a.plans.includes(p.id) && gaps(a).length).length }} 場有缺漏
        </div>
      </button>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" title="重新命名" @click="startRename(p.id, p.name)">重新命名</button>
        <button class="x" title="刪除計畫" @click="removePlan(p.id, p.name)">×</button>
      </div>
    </div>
  </div>
  <p v-if="!db.plans.length" class="empty" style="padding:0">還沒有計畫。</p>
</template>
