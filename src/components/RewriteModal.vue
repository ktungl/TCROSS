<script setup lang="ts">
import { computed, ref } from 'vue'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { requestRewrite } from '../lib/middleware'
import type { RewriteFormat, RewriteResult } from '../lib/middleware'
import { confirm } from '../composables/useConfirm'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import { downloadBlob } from '../utils/exportDocs'
import type { ActivityRecord } from '../types'

const props = defineProps<{ activity: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const FORMATS: { key: RewriteFormat; hint: string }[] = [
  { key: '新聞稿', hint: '對外發布用，含標題、導言與內文' },
  { key: '社群文案', hint: 'Facebook／Instagram 貼文，150～250 字＋hashtag' },
  { key: '主管摘要', hint: '一頁重點條列，1 分鐘看完' },
]

const format = ref<RewriteFormat>('新聞稿')
const loading = ref(false)
/** 產出後放進可編輯的文字框，複製與下載 Word 都用編輯後的內容 */
const text = ref('')
const producedFormat = ref<RewriteFormat | null>(null)

const BULLET = '・'

const thinData = computed(() => !props.activity.summary.trim())

function toText(r: RewriteResult): string {
  const blocks = [r.title, ...r.paragraphs]
  if (r.bullets.length) blocks.push(r.bullets.map((b) => `${BULLET}${b}`).join('\n'))
  if (r.hashtags.length) blocks.push(r.hashtags.map((h) => `#${h}`).join(' '))
  return blocks.filter((b) => b.trim()).join('\n\n')
}

async function generate() {
  if (loading.value) return
  if (text.value.trim() && !(await confirm('重新產生會覆蓋目前文字框裡的內容（包含你改過的地方），確定嗎？', '重新產生'))) {
    return
  }
  loading.value = true
  try {
    const result = await requestRewrite(props.activity.id, format.value)
    text.value = toText(result)
    producedFormat.value = result.format
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    loading.value = false
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    pushToast('已複製')
  } catch {
    pushToast('瀏覽器不允許複製，請手動選取文字複製', 'error')
  }
}

async function downloadWord() {
  const [title, ...rest] = text.value.trim().split('\n')
  const children = [new Paragraph({ text: title ?? '', heading: HeadingLevel.HEADING_1 })]
  for (const line of rest) {
    if (!line.trim()) continue
    children.push(
      line.startsWith(BULLET)
        ? new Paragraph({ text: line.slice(BULLET.length), bullet: { level: 0 } })
        : new Paragraph({ children: [new TextRun(line)], spacing: { after: 160 } }),
    )
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: '微軟正黑體', size: 24 } } } },
    sections: [{ children }],
  })
  const name = `${props.activity.name || '活動'}_${producedFormat.value ?? format.value}.docx`
  downloadBlob(name, await Packer.toBlob(doc))
}

async function requestClose() {
  if (text.value.trim() && !(await confirm('關閉後產生的文字不會保存，確定要關閉嗎？', '關閉'))) return
  emit('close')
}
useEscape(requestClose)
</script>

<template>
  <div class="modal" v-modal-focus @click.self="requestClose">
    <div class="card">
      <h2>AI 改寫文案</h2>
      <p class="sub">用這場活動已填的資料（基本資料、成果摘要、KPI、照片圖說）改寫成不同用途的文字。</p>

      <label>產出類型</label>
      <div class="row" style="gap:14px">
        <label v-for="f in FORMATS" :key="f.key" class="chk">
          <input v-model="format" type="radio" :value="f.key">{{ f.key }}
        </label>
      </div>
      <p class="hint">{{ FORMATS.find((f) => f.key === format)?.hint }}</p>
      <p v-if="thinData" class="warn-box field">
        這場活動的「成果摘要」還是空白，產出的內容會比較單薄。建議先到「成果補充」填寫摘要再產生。
      </p>

      <div class="row actions">
        <button class="btn" :disabled="loading" @click="generate">
          {{ loading ? '產生中…（約 10 秒）' : text ? '重新產生' : '產生' }}
        </button>
      </div>

      <template v-if="text">
        <label class="field">{{ producedFormat }}（可直接修改）</label>
        <textarea v-model="text" rows="14"></textarea>
        <p class="hint">AI 只會使用已填寫的資料，但仍可能寫錯，對外發布前請核對人數、日期與單位名稱。</p>
        <div class="row actions">
          <button class="btn ghost" @click="copy">複製文字</button>
          <button class="btn ghost" @click="downloadWord">下載 Word</button>
        </div>
      </template>

      <div class="row actions">
        <button class="btn ghost" :disabled="loading" @click="requestClose">關閉</button>
      </div>
    </div>
  </div>
</template>
