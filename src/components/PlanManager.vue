<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDbStore } from '../stores/db'
import { gaps } from '../utils/activity'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import StampLine from './StampLine.vue'
import type { PlanRecord } from '../types'

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

// 排序模式：先在 draftOrder 上調整，按「儲存排序」才寫入資料庫，取消就直接丟掉
const sorting = ref(false)
const savingOrder = ref(false)
const draftOrder = ref<PlanRecord[]>([])
const dragIndex = ref(-1)

function startSorting() {
  cancelRename()
  draftOrder.value = [...db.plans]
  sorting.value = true
}

function cancelSorting() {
  sorting.value = false
  draftOrder.value = []
  dragIndex.value = -1
}

function movePlan(from: number, to: number) {
  if (to < 0 || to >= draftOrder.value.length || from === to) return
  const list = [...draftOrder.value]
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  draftOrder.value = list
}

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index
  // Firefox 沒設資料就不會開始拖移
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

// 拖到別張卡片上就即時換位，讓使用者看到放下後的結果
function onDragEnter(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return
  movePlan(dragIndex.value, index)
  dragIndex.value = index
}

function onDragEnd() {
  dragIndex.value = -1
}

async function saveSorting() {
  savingOrder.value = true
  try {
    await db.reorderPlans(draftOrder.value.map((p) => p.id))
    pushToast('已更新計畫排序')
    cancelSorting()
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    savingOrder.value = false
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

  <template v-if="sorting">
    <p class="sub" style="margin-bottom:10px">拖移卡片左側的「⠿」調整順序（手機請用 ↑ ↓），完成後按「儲存排序」。</p>
    <div
      v-for="(p, i) in draftOrder"
      :key="p.id"
      class="card"
      :style="{ marginBottom: '10px', opacity: dragIndex === i ? 0.4 : 1 }"
      draggable="true"
      @dragstart="onDragStart(i, $event)"
      @dragenter.prevent="onDragEnter(i)"
      @dragover.prevent
      @drop.prevent
      @dragend="onDragEnd"
    >
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
        <div class="row" style="gap:10px;flex-wrap:nowrap;min-width:0">
          <span aria-hidden="true" style="cursor:grab;color:var(--ink-soft);font-size:18px;user-select:none">⠿</span>
          <strong>{{ p.name }}</strong>
        </div>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          <button class="btn ghost sm" title="上移" :disabled="i === 0" @click="movePlan(i, i - 1)">↑</button>
          <button class="btn ghost sm" title="下移" :disabled="i === draftOrder.length - 1" @click="movePlan(i, i + 1)">↓</button>
        </div>
      </div>
    </div>
    <div class="row" style="gap:6px">
      <button class="btn" :disabled="savingOrder" @click="saveSorting">{{ savingOrder ? '儲存中…' : '儲存排序' }}</button>
      <button class="btn ghost" :disabled="savingOrder" @click="cancelSorting">取消</button>
    </div>
  </template>

  <template v-else>
  <div v-if="db.plans.length > 1" class="row" style="justify-content:flex-end;margin-bottom:10px">
    <button class="btn ghost sm" @click="startSorting">編輯排序</button>
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
        <StampLine :record="p" />
      </button>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" title="重新命名" @click="startRename(p.id, p.name)">重新命名</button>
        <button class="x" title="刪除計畫" @click="removePlan(p.id, p.name)">×</button>
      </div>
    </div>
  </div>
  <p v-if="!db.plans.length" class="empty" style="padding:0">還沒有計畫。</p>
  </template>
</template>
