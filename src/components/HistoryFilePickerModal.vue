<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { errorMessage, pushToast } from '../composables/useToast'
import { kb } from '../utils/activity'
import { ATTACHMENT_TYPES } from '../types'
import type { AttachmentKey } from '../types'

const props = defineProps<{ activityId: string; folder: AttachmentKey }>()
const emit = defineEmits<{ close: [] }>()

const db = useDbStore()
const attachmentLabel = Object.fromEntries(ATTACHMENT_TYPES) as Record<AttachmentKey, string>
const planName = (id: string) => db.plans.find((p) => p.id === id)?.name ?? '—'

const pPlan = ref('')
const pType = ref<AttachmentKey | ''>(props.folder)
const pKeyword = ref('')
const pView = ref<'grid' | 'list'>('grid')

interface PickRow {
  activityId: string
  activityName: string
  planIds: string[]
  type: AttachmentKey
  name: string
  size: number
  url: string
}

/** 排除「本來就在這個活動這個分類裡」的檔案——那些直接看得到，不需要再挑一次。 */
const rows = computed<PickRow[]>(() => {
  const q = pKeyword.value.trim().toLowerCase()
  const rows: PickRow[] = []
  for (const a of db.activities) {
    for (const [key] of ATTACHMENT_TYPES) {
      if (pType.value && key !== pType.value) continue
      if (a.id === props.activityId && key === props.folder) continue
      for (const f of a.files[key] ?? []) {
        rows.push({ activityId: a.id, activityName: a.name, planIds: a.plans, type: key, name: f.name, size: f.size, url: f.url })
      }
    }
  }
  return rows
    .filter((r) => !pPlan.value || r.planIds.includes(pPlan.value))
    .filter((r) => !q || [r.activityName, r.name].some((s) => s.toLowerCase().includes(q)))
})

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg']
function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}
function fileExt(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

function rowKey(r: PickRow): string {
  return `${r.activityId}:${r.type}:${r.url}`
}

const selected = ref<Set<string>>(new Set())
function toggle(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const attaching = ref(false)

async function attach() {
  const targets = rows.value.filter((r) => selected.value.has(rowKey(r)))
  if (!targets.length) return
  attaching.value = true
  try {
    await db.attachExistingFiles(
      props.activityId,
      props.folder,
      targets.map((r) => ({ name: r.name, size: r.size, url: r.url })),
    )
    pushToast(`已加入 ${targets.length} 個檔案`)
    emit('close')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    attaching.value = false
  }
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="card" style="max-width:760px">
      <h2 style="margin-top:0">從歷史檔案選取（{{ attachmentLabel[folder] }}）</h2>
      <p class="sub">挑選其他活動已經上傳過的檔案，直接加進這個活動的「{{ attachmentLabel[folder] }}」，不用重新上傳。</p>

      <div class="row" style="margin-bottom:14px;justify-content:space-between">
        <div class="row">
          <input v-model="pKeyword" placeholder="搜尋活動名稱／檔案名稱" style="width:200px">
          <select v-model="pPlan" style="width:170px">
            <option value="">全部計畫</option>
            <option v-for="p in db.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-model="pType" style="width:150px">
            <option value="">全部類型</option>
            <option v-for="[key, label] in ATTACHMENT_TYPES" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div class="view-toggle">
          <button type="button" :class="{ active: pView === 'grid' }" @click="pView = 'grid'">方格</button>
          <button type="button" :class="{ active: pView === 'list' }" @click="pView = 'list'">列表</button>
        </div>
      </div>

      <p class="sub mono" style="margin:0 0 10px">共 {{ rows.length }} 筆可選　·　已選取 {{ selected.size }} 筆</p>

      <div style="max-height:400px;overflow:auto">
        <table class="out" v-if="rows.length && pView === 'list'">
          <thead><tr><th></th><th>活動</th><th>類型</th><th>檔案名稱</th><th>大小</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="rowKey(r)" style="cursor:pointer" @click="toggle(rowKey(r))">
              <td><input type="checkbox" :checked="selected.has(rowKey(r))" @click.stop @change="toggle(rowKey(r))"></td>
              <td>{{ r.activityName || '（未命名活動）' }}</td>
              <td>{{ attachmentLabel[r.type] }}</td>
              <td>{{ r.name }}</td>
              <td class="mono">{{ kb(r.size) }}</td>
            </tr>
          </tbody>
        </table>

        <div class="file-grid" v-else-if="rows.length && pView === 'grid'">
          <div
            v-for="r in rows"
            :key="rowKey(r)"
            class="file-cell"
            :class="{ picked: selected.has(rowKey(r)) }"
            style="cursor:pointer"
            @click="toggle(rowKey(r))"
          >
            <span class="thumb-wrap file-thumb-wrap">
              <input type="checkbox" class="select-check" :checked="selected.has(rowKey(r))" @click.stop @change="toggle(rowKey(r))">
              <span class="file-thumb">
                <img v-if="isImageFile(r.name)" :src="r.url" :alt="r.name" loading="lazy">
                <span v-else class="file-icon">.{{ fileExt(r.name) || '—' }}</span>
              </span>
            </span>
            <span class="file-cell-body">
              <span class="file-cell-name">{{ r.name }}</span>
              <span class="file-cell-meta">{{ attachmentLabel[r.type] }}　{{ r.activityName || '（未命名活動）' }}</span>
              <span class="file-cell-meta">{{ r.planIds.map(planName).join('、') || '—' }}</span>
            </span>
          </div>
        </div>

        <p v-else class="empty">沒有符合條件的歷史檔案。</p>
      </div>

      <div class="row" style="margin-top:20px">
        <button class="btn" :disabled="!selected.size || attaching" @click="attach">
          {{ attaching ? '加入中…' : `加入選取的 ${selected.size} 個檔案` }}
        </button>
        <button class="btn ghost" @click="emit('close')">關閉</button>
      </div>
    </div>
  </div>
</template>
