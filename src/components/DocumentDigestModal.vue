<script setup lang="ts">
import { computed, ref } from 'vue'
import { assistDocument } from '../lib/middleware'
import type { DocumentDigest } from '../lib/middleware'
import { resolveAttachmentUrl } from '../lib/attachments'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import { loadDocumentForAi } from '../utils/aiImages'
import { isImageFile, isPdfFile } from '../utils/file'
import type { ActivityRecord } from '../types'

const props = defineProps<{ activity: ActivityRecord }>()
const emit = defineEmits<{ close: [] }>()

const readable = computed(() =>
  props.activity.files.document.filter((f) => isPdfFile(f.name) || isImageFile(f.name)),
)
const picked = ref(readable.value[0]?.url ?? '')
const localFile = ref<File | null>(null)

const loading = ref(false)
const result = ref<DocumentDigest | null>(null)
const sourceName = ref('')

function onLocalPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  localFile.value = file
  if (file) picked.value = ''
}

async function read() {
  if (loading.value) return
  const meta = readable.value.find((f) => f.url === picked.value)
  if (!meta && !localFile.value) {
    pushToast('請選一份公文', 'error')
    return
  }
  loading.value = true
  try {
    let blob: Blob
    let name: string
    if (meta) {
      const res = await fetch(await resolveAttachmentUrl(meta.url, meta.name))
      if (!res.ok) throw new Error(`無法下載「${meta.name}」`)
      blob = await res.blob()
      name = meta.name
    } else {
      blob = localFile.value!
      name = localFile.value!.name
    }
    result.value = await assistDocument(props.activity.id, await loadDocumentForAi(blob, name))
    sourceName.value = name
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    loading.value = false
  }
}

const CHECK_ORDER = ['期限', '預算', '法規', '其他'] as const
const checkGroups = computed(() =>
  CHECK_ORDER.map((category) => ({
    category,
    items: (result.value?.checkItems ?? []).filter((c) => c.category === category),
  })).filter((g) => g.items.length),
)

function toText(r: DocumentDigest): string {
  const head = [
    r.subject && `主旨：${r.subject}`,
    [r.docType, r.issuer, r.docNumber].filter(Boolean).join('｜'),
  ].filter(Boolean)
  const blocks = [head.join('\n'), r.summary]
  if (r.keyPoints.length) blocks.push(`重點\n${r.keyPoints.map((p) => `・${p}`).join('\n')}`)
  if (r.checkItems.length) {
    blocks.push(
      `需人工核對\n${r.checkItems.map((c) => `・〔${c.category}〕${c.item}${c.source ? `（${c.source}）` : ''}`).join('\n')}`,
    )
  }
  blocks.push('※ AI 摘要僅供掌握方向，法規與預算請核對原文。')
  return blocks.filter((b) => b.trim()).join('\n\n')
}

async function copy() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(toText(result.value))
    pushToast('已複製')
  } catch {
    pushToast('瀏覽器不允許複製，請手動選取文字複製', 'error')
  }
}

function requestClose() {
  if (loading.value) return
  emit('close')
}
useEscape(requestClose)
</script>

<template>
  <div class="modal" v-modal-focus @click.self="requestClose">
    <div class="card wide">
      <h2>AI 公文快讀</h2>

      <template v-if="!result">
        <p class="sub">選一份公文或企劃書（PDF 或照片），AI 整理出重點與需要核對的期限、金額、法規。結果不會存檔。</p>
        <p v-if="!readable.length" class="empty flush">「公文」分類還沒有 PDF 或照片，可以先上傳，或直接從下方選檔案。</p>
        <div v-else class="pick-list">
          <label v-for="f in readable" :key="f.url" class="chk">
            <input v-model="picked" type="radio" :value="f.url" @change="localFile = null">{{ f.name }}
          </label>
        </div>
        <label class="field">或從裝置選檔案（只用來快讀，不會存成附件）</label>
        <input type="file" accept="application/pdf,image/*" @change="onLocalPick">
        <p class="hint">PDF 上限 10 MB；Word 檔請先另存成 PDF。</p>
        <div class="row actions">
          <button class="btn" :disabled="loading" @click="read">{{ loading ? '閱讀中…（約 10～30 秒）' : '開始快讀' }}</button>
          <button class="btn ghost" :disabled="loading" @click="requestClose">取消</button>
        </div>
      </template>

      <template v-else>
        <p class="warn-box">AI 摘要僅供掌握方向，法規與預算請核對原文（{{ sourceName }}）。</p>
        <p v-if="result.subject" class="field"><strong>主旨：</strong>{{ result.subject }}</p>
        <p v-if="result.docType || result.issuer || result.docNumber" class="hint">
          {{ [result.docType, result.issuer, result.docNumber].filter(Boolean).join('｜') }}
        </p>
        <p v-if="result.summary">{{ result.summary }}</p>

        <template v-if="result.keyPoints.length">
          <label class="field">重點</label>
          <ul class="points">
            <li v-for="(p, i) in result.keyPoints" :key="i">{{ p }}</li>
          </ul>
        </template>

        <label class="field">需人工核對</label>
        <p v-if="!checkGroups.length" class="empty flush">AI 沒有列出需要核對的項目，仍請自行看過原文。</p>
        <div v-for="g in checkGroups" :key="g.category" class="check-group">
          <span class="stamp">{{ g.category }}</span>
          <ul class="points">
            <li v-for="(c, i) in g.items" :key="i">
              {{ c.item }}<span v-if="c.source" class="hint">（{{ c.source }}）</span>
            </li>
          </ul>
        </div>

        <p v-if="result.notes" class="hint field">AI 備註：{{ result.notes }}</p>

        <div class="row actions">
          <button class="btn ghost" @click="copy">複製文字</button>
          <button class="btn ghost" @click="result = null">換一份</button>
          <button class="btn ghost" @click="requestClose">關閉</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.points{margin:4px 0 8px;padding-left:1.4em}
.points li{margin:2px 0}
.check-group{margin-top:6px}
</style>
