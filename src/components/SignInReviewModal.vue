<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { assistSignIn } from '../lib/middleware'
import type { SignInRow } from '../lib/middleware'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import { loadAttachmentForAi, prepareImageForAi } from '../utils/aiImages'
import { isImageFile, isPdfFile } from '../utils/file'
import type { AiImage } from '../utils/aiImages'
import type { ActivityRecord, FileMeta } from '../types'

const props = defineProps<{ activity: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const db = useDbStore()

/** 跟 server/assist.py MAX_SIGN_IN_IMAGES 一致 */
const MAX_PAGES = 6

const readable = computed(() =>
  props.activity.files.signIn.filter((f) => isImageFile(f.name) || isPdfFile(f.name)),
)
const picked = ref<string[]>(readable.value.map((f) => f.url))
const localFiles = ref<File[]>([])

type Step = 'pick' | 'loading' | 'review'
const step = ref<Step>('pick')
const pages = ref<AiImage[]>([])
const currentPage = ref(1)
const rows = reactive<SignInRow[]>([])
const notes = ref('')

function onLocalPick(e: Event) {
  const input = e.target as HTMLInputElement
  localFiles.value = [...localFiles.value, ...Array.from(input.files ?? [])]
  input.value = ''
}

function releasePages() {
  pages.value.forEach((p) => URL.revokeObjectURL(p.previewUrl))
  pages.value = []
}
onBeforeUnmount(releasePages)

async function recognize() {
  const files: FileMeta[] = readable.value.filter((f) => picked.value.includes(f.url))
  if (!files.length && !localFiles.value.length) {
    pushToast('請至少選一張簽到表', 'error')
    return
  }
  step.value = 'loading'
  releasePages()
  try {
    const images: AiImage[] = []
    for (const f of files) {
      if (images.length >= MAX_PAGES) break
      images.push(...(await loadAttachmentForAi(f, MAX_PAGES - images.length)))
    }
    for (const f of localFiles.value) {
      if (images.length >= MAX_PAGES) break
      images.push(await prepareImageForAi(f))
    }
    pages.value = images
    const result = await assistSignIn(
      props.activity.id,
      images.map((i) => ({ data: i.data, mimeType: i.mimeType })),
    )
    rows.splice(0, rows.length, ...result.rows)
    notes.value = result.notes
    currentPage.value = 1
    step.value = 'review'
  } catch (e) {
    pushToast(errorMessage(e), 'error')
    step.value = 'pick'
  }
}

function addRow() {
  rows.push({ page: currentPage.value, unit: '', title: '', name: '', gender: '', uncertain: false })
}
function removeRow(i: number) {
  rows.splice(i, 1)
}

// 人數一律由程式依名單計算，不採用 AI 自己算的數字
const counted = computed(() => {
  const listed = rows.filter((r) => r.name.trim() || r.unit.trim())
  return {
    total: listed.length,
    male: listed.filter((r) => r.gender === '男').length,
    female: listed.filter((r) => r.gender === '女').length,
    unknown: listed.filter((r) => !r.gender).length,
    uncertain: listed.filter((r) => r.uncertain).length,
  }
})
const units = computed(() => [...new Set(rows.map((r) => r.unit.trim()).filter(Boolean))].join('、'))

const applyHeadcount = ref(true)
const applyUnits = ref(!props.activity.attendees.trim())
const saving = ref(false)

async function apply() {
  if (!applyHeadcount.value && !applyUnits.value) {
    pushToast('請至少勾選一項要寫入的資料', 'error')
    return
  }
  if (counted.value.uncertain && !(await confirm(`還有 ${counted.value.uncertain} 列標示為「不確定」，確定已對照原圖核對過了嗎？`, '已核對，寫入'))) {
    return
  }
  const hc = applyHeadcount.value
    ? { male: counted.value.male, female: counted.value.female, total: counted.value.total }
    : props.activity.headcount
  saving.value = true
  try {
    await db.saveAttendance(props.activity.id, hc, applyUnits.value ? units.value : undefined)
    pushToast('已寫入活動資料')
    emit('close')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    saving.value = false
  }
}

async function requestClose() {
  if (step.value === 'loading') return
  if (step.value === 'review' && !(await confirm('辨識結果還沒寫入，確定要關閉嗎？', '關閉'))) return
  emit('close')
}
useEscape(requestClose)
</script>

<template>
  <div class="modal" v-modal-focus @click.self="requestClose">
    <div class="card signin-card">
      <h2>AI 辨識簽到表</h2>

      <template v-if="step === 'pick'">
        <p class="sub">選擇要辨識的簽到表（照片或 PDF，合計最多 {{ MAX_PAGES }} 頁）。辨識結果會先給你對照原圖確認，確認後才寫入。</p>
        <p v-if="!readable.length" class="empty flush">「簽到表」分類還沒有照片或 PDF，可以先上傳，或直接從下方選手機照片。</p>
        <div v-else class="pick-list">
          <label v-for="f in readable" :key="f.url" class="chk">
            <input v-model="picked" type="checkbox" :value="f.url">{{ f.name }}
          </label>
        </div>
        <label class="field">或從裝置選照片（只用來辨識，不會存成附件）</label>
        <input type="file" accept="image/*" multiple @change="onLocalPick">
        <p v-if="localFiles.length" class="hint">已選 {{ localFiles.length }} 張：{{ localFiles.map((f) => f.name).join('、') }}</p>
        <div class="row actions">
          <button class="btn" @click="recognize">開始辨識</button>
          <button class="btn ghost" @click="requestClose">取消</button>
        </div>
      </template>

      <p v-else-if="step === 'loading'" class="sub">辨識中，約需 10～30 秒…</p>

      <template v-else>
        <p class="sub">左邊是原圖、右邊是辨識結果。黃色列是 AI 不確定的地方，請對照原圖修正；點列可切換到對應的那一頁。</p>
        <p v-if="notes" class="hint">AI 備註：{{ notes }}</p>
        <div class="review">
          <div class="review-image">
            <div v-if="pages.length > 1" class="row" style="gap:6px;margin-bottom:6px">
              <button
                v-for="(_, i) in pages"
                :key="i"
                class="btn sm"
                :class="{ ghost: currentPage !== i + 1 }"
                type="button"
                @click="currentPage = i + 1"
              >第 {{ i + 1 }} 頁</button>
            </div>
            <a v-if="pages[currentPage - 1]" :href="pages[currentPage - 1].previewUrl" target="_blank" rel="noopener" title="在新分頁開啟原圖放大">
              <img :src="pages[currentPage - 1].previewUrl" alt="簽到表原圖">
            </a>
          </div>
          <div class="review-table">
            <table class="out">
              <thead><tr><th>頁</th><th>單位</th><th>職稱</th><th>姓名</th><th>性別</th><th></th></tr></thead>
              <tbody>
                <tr
                  v-for="(r, i) in rows"
                  :key="i"
                  :class="{ uncertain: r.uncertain }"
                  @click="currentPage = Math.min(Math.max(1, r.page), pages.length)"
                >
                  <td class="mono">{{ r.page }}</td>
                  <td><input v-model="r.unit"></td>
                  <td><input v-model="r.title"></td>
                  <td><input v-model="r.name"></td>
                  <td>
                    <select v-model="r.gender">
                      <option value="">—</option><option value="男">男</option><option value="女">女</option>
                    </select>
                  </td>
                  <td>
                    <button v-if="r.uncertain" class="btn ghost sm" type="button" title="已核對" @click.stop="r.uncertain = false">✓</button>
                    <button class="x" type="button" title="刪除此列" @click.stop="removeRow(i)">×</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!rows.length" class="empty">沒有辨識出任何簽名。</p>
            <button class="btn ghost sm field" type="button" @click="addRow">＋ 新增一列</button>
          </div>
        </div>

        <div class="card field">
          <p class="flush-m">
            名單共 <strong>{{ counted.total }}</strong> 人：男 {{ counted.male }}、女 {{ counted.female }}<template v-if="counted.unknown">、未填性別 {{ counted.unknown }}</template>
            <span v-if="counted.uncertain" class="stamp">{{ counted.uncertain }} 列待核對</span>
          </p>
          <label class="chk">
            <input v-model="applyHeadcount" type="checkbox">
            更新與會人數（目前：合計 {{ activity.headcount.total }}、男 {{ activity.headcount.male }}、女 {{ activity.headcount.female }} → 合計 {{ counted.total }}、男 {{ counted.male }}、女 {{ counted.female }}）
          </label>
          <label class="chk">
            <input v-model="applyUnits" type="checkbox">
            更新與會單位（{{ units || '名單沒有單位' }}）<template v-if="activity.attendees.trim()">，會取代目前的「{{ activity.attendees }}」</template>
          </label>
        </div>

        <div class="row actions">
          <button class="btn" :disabled="saving" @click="apply">{{ saving ? '寫入中…' : '確認寫入活動資料' }}</button>
          <button class="btn ghost" :disabled="saving" @click="step = 'pick'">重新選擇</button>
          <button class="btn ghost" :disabled="saving" @click="requestClose">關閉</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.signin-card{max-width:1100px;width:100%}
.review{display:grid;grid-template-columns:1fr 1.2fr;gap:16px;margin-top:10px}
.review-image img{width:100%;border:1px solid var(--line);border-radius:var(--r)}
.review-table{overflow:auto;max-height:70vh}
.review-table input,.review-table select{min-width:0;width:100%;padding:4px 6px}
.review-table tr{cursor:pointer}
.review-table tr.uncertain td{background:var(--gold-100)}
@media (max-width:760px){.review{grid-template-columns:1fr}}
</style>
