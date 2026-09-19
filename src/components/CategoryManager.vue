<script setup lang="ts">
import { ref } from 'vue'
import { useDbStore } from '../stores/db'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import MultiSelectDropdown from './MultiSelectDropdown.vue'

const db = useDbStore()
const categoryName = ref('')
const categoryNameInput = ref<HTMLInputElement | null>(null)
const newCategoryPlanIds = ref<string[]>([])
const editingId = ref('')
const editingName = ref('')
const editingPlanIds = ref<string[]>([])

const planOptions = () => db.plans.map((p) => ({ id: p.id, label: p.name }))
const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

async function addCategory() {
  const n = categoryName.value.trim()
  if (!n) {
    pushToast('請先輸入分類名稱', 'error')
    categoryNameInput.value?.focus()
    return
  }
  try {
    await db.createCategory(n, newCategoryPlanIds.value)
    categoryName.value = ''
    newCategoryPlanIds.value = []
    pushToast('已新增分類')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  }
}

function startRename(id: string, name: string, planIds: string[]) {
  editingId.value = id
  editingName.value = name
  editingPlanIds.value = [...planIds]
}

function cancelRename() {
  editingId.value = ''
  editingName.value = ''
  editingPlanIds.value = []
}

async function saveRename() {
  const n = editingName.value.trim()
  if (!n) {
    pushToast('分類名稱不能為空', 'error')
    return
  }
  try {
    await db.renameCategory(editingId.value, n)
    await db.setCategoryPlans(editingId.value, editingPlanIds.value)
    pushToast('已更新分類')
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
  <p class="sub">活動分類（原「活動分類」下拉選單的選項）可以在這裡自訂新增、改名或刪除，調整不會影響已建立活動上已記錄的分類文字。分類可以指定所屬計畫：建立活動時先選計畫，分類清單就只會顯示對應的項目（沒有指定計畫的分類不受影響，任何計畫都看得到）。</p>
  <div class="card" style="margin-bottom:20px">
    <div class="row">
      <input ref="categoryNameInput" v-model="categoryName" placeholder="分類名稱，例如：理監事聯席會議" style="flex:1;min-width:220px" @keyup.enter="addCategory">
      <button class="btn" @click="addCategory">新增分類</button>
    </div>
    <div style="margin-top:10px">
      <label>所屬計畫（可複選，留空＝不限計畫）</label>
      <MultiSelectDropdown v-model="newCategoryPlanIds" :options="planOptions()" placeholder="不指定＝所有計畫都看得到" />
    </div>
  </div>

  <div v-for="c in db.categories" :key="c.id" class="card" style="margin-bottom:10px">
    <div v-if="editingId === c.id" style="display:flex;flex-direction:column;gap:10px">
      <input v-model="editingName" placeholder="分類名稱" @keyup.esc="cancelRename">
      <div>
        <label>所屬計畫（可複選，留空＝不限計畫）</label>
        <MultiSelectDropdown v-model="editingPlanIds" :options="planOptions()" placeholder="不指定＝所有計畫都看得到" />
      </div>
      <div class="row">
        <button class="btn sm" @click="saveRename">儲存</button>
        <button class="btn ghost sm" @click="cancelRename">取消</button>
      </div>
    </div>
    <div v-else class="row" style="justify-content:space-between">
      <div>
        <strong>{{ c.name }}</strong>
        <div class="meta" style="font-size:12px;color:var(--ink-soft)">
          {{ db.activities.filter(a => a.categories.includes(c.name)).length }} 場活動使用中
          　·　所屬計畫：{{ c.planIds.length ? c.planIds.map(planName).join('、') : '不限' }}
        </div>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" title="重新命名／調整所屬計畫" @click="startRename(c.id, c.name, c.planIds)">編輯</button>
        <button class="x" title="刪除分類" @click="removeCategory(c.id, c.name)">×</button>
      </div>
    </div>
  </div>
  <p v-if="!db.categories.length" class="empty" style="padding:0">還沒有分類。</p>
</template>
