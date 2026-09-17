<script setup lang="ts">
import { ref } from 'vue'
import { useDbStore } from '../stores/db'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'

const db = useDbStore()
const categoryName = ref('')
const categoryNameInput = ref<HTMLInputElement | null>(null)
const editingId = ref('')
const editingName = ref('')

async function addCategory() {
  const n = categoryName.value.trim()
  if (!n) {
    pushToast('請先輸入分類名稱', 'error')
    categoryNameInput.value?.focus()
    return
  }
  try {
    await db.createCategory(n)
    categoryName.value = ''
    pushToast('已新增分類')
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
    pushToast('分類名稱不能為空', 'error')
    return
  }
  try {
    await db.renameCategory(editingId.value, n)
    pushToast('已更新分類名稱')
    cancelRename()
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

async function removeCategory(id: string, name: string) {
  if (!(await confirm(`確定要刪除分類「${name}」嗎？已建立活動上記錄的分類文字不會被移除，只是往後新增/編輯活動時不會再看到這個選項。`))) return
  try {
    await db.deleteCategory(id)
    pushToast('已刪除分類')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}
</script>

<template>
  <h1>分類管理</h1>
  <p class="sub">活動分類（原「活動分類」下拉選單的選項）可以在這裡自訂新增、改名或刪除，調整不會影響已建立活動上已記錄的分類文字。</p>
  <div class="card" style="margin-bottom:20px">
    <div class="row">
      <input ref="categoryNameInput" v-model="categoryName" placeholder="分類名稱，例如：居場所" style="flex:1;min-width:220px" @keyup.enter="addCategory">
      <button class="btn" @click="addCategory">新增分類</button>
    </div>
  </div>

  <div v-for="c in db.categories" :key="c.id" class="card" style="margin-bottom:10px">
    <div v-if="editingId === c.id" class="row">
      <input v-model="editingName" style="flex:1;min-width:220px" @keyup.enter="saveRename" @keyup.esc="cancelRename">
      <button class="btn sm" @click="saveRename">儲存</button>
      <button class="btn ghost sm" @click="cancelRename">取消</button>
    </div>
    <div v-else class="row" style="justify-content:space-between">
      <div>
        <strong>{{ c.name }}</strong>
        <div class="meta" style="font-size:12px;color:var(--ink-soft)">
          {{ db.activities.filter(a => a.categories.includes(c.name)).length }} 場活動使用中
        </div>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" title="重新命名" @click="startRename(c.id, c.name)">重新命名</button>
        <button class="x" title="刪除分類" @click="removeCategory(c.id, c.name)">×</button>
      </div>
    </div>
  </div>
  <p v-if="!db.categories.length" class="empty" style="padding:0">還沒有分類。</p>
</template>
