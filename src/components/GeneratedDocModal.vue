<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildActivityRecordXlsx,
  buildOfficialLetterDocx,
  buildReceiptDocx,
  buildResultReportDocx,
  buildSignInSheetDocx,
  downloadBlob,
  generatedFormExtension,
  ORGANIZER_NAME,
  SIGN_IN_LAYOUTS,
} from '../utils/download'
import type { GeneratedFormKind, OfficialLetterPurpose, SignInLayout } from '../utils/download'
import { errorMessage, pushToast } from '../composables/useToast'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityRecord } from '../types'

const props = defineProps<{
  activity: ActivityRecord
  kind: GeneratedFormKind
  planName: (id: string) => string
}>()
const emit = defineEmits<{ close: [] }>()

const downloading = ref(false)

// 公文專用欄位；發文機關記在瀏覽器裡，下次不用重打
const ISSUER_KEY = 'tcross.letterIssuer'
function readIssuer(): string {
  try {
    return localStorage.getItem(ISSUER_KEY) ?? ''
  } catch {
    return ''
  }
}
const letterIssuer = ref(readIssuer() || ORGANIZER_NAME)
const letterRecipient = ref('')
const letterPurpose = ref<OfficialLetterPurpose>('邀請參加')
// 公文「依據」、簽到表標題要列哪些專案：活動上掛的專案不一定都是計畫
// （例如「2026大事紀」），所以讓使用者自己勾，預設全勾
const planOptions = computed(() => props.activity.plans.map(props.planName))
const pickedPlans = ref<string[]>([...planOptions.value])
const pickedPlansInOrder = () => planOptions.value.filter((n) => pickedPlans.value.includes(n))

const signInLayout = ref<SignInLayout>('detailed')

const planNames = computed(() => props.activity.plans.map(props.planName).join('、'))

const summary = computed(() => {
  switch (props.kind) {
    case '簽到表': {
      const { perPage } = SIGN_IN_LAYOUTS[signInLayout.value]
      const pages = Math.ceil(Math.max(props.activity.headcount.total || 0, 1) / perPage)
      return `將產生 Word 簽到表，依活動人數（${props.activity.headcount.total || 0} 人）共 ${pages} 頁、${pages * perPage} 個簽到欄位`
    }
    case '領據':
      return '將產生一份可列印簽章的 Word 領據'
    case '活動紀錄表':
      return `將產生活動紀錄表 Excel 檔（含執行情形、附件統計：${ATTACHMENT_TYPES.map(([k, l]) => `${l} ${props.activity.files[k]?.length ?? 0}`).join('、')}）`
    case '成果報告':
      return '將產生一份 Word 成果報告，內容取自下方「儲存成果」填寫的摘要、KPI 與照片圖說（不經過 AI）'
    case '公文':
      return '將產生一份 Word 公文（函），主旨與說明由活動資料帶入；發文日期、字號等請於下載後填寫'
  }
})

async function download() {
  downloading.value = true
  try {
    let blob: Blob
    switch (props.kind) {
      case '簽到表':
        blob = await buildSignInSheetDocx(props.activity, { titlePlans: pickedPlansInOrder(), layout: signInLayout.value })
        break
      case '領據':
        blob = await buildReceiptDocx(props.activity, planNames.value)
        break
      case '活動紀錄表':
        blob = await buildActivityRecordXlsx(props.activity, planNames.value)
        break
      case '成果報告':
        blob = await buildResultReportDocx(props.activity, planNames.value)
        break
      case '公文':
        try {
          localStorage.setItem(ISSUER_KEY, letterIssuer.value.trim())
        } catch {
          // 無痕模式等情況存不了，不影響產生公文
        }
        blob = await buildOfficialLetterDocx(props.activity, {
          issuer: letterIssuer.value,
          recipient: letterRecipient.value,
          purpose: letterPurpose.value,
          basisPlans: pickedPlansInOrder(),
        })
        break
    }
    downloadBlob(`${props.activity.name}_${props.kind}.${generatedFormExtension(props.kind)}`, blob)
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="card">
      <h2 style="margin-top:0">{{ kind }}</h2>
      <p class="sub">{{ summary }}</p>
      <template v-if="kind === '公文'">
        <label>公文用途</label>
        <select v-model="letterPurpose">
          <option value="邀請參加">邀請參加活動</option>
          <option value="檢送成果">檢送活動成果</option>
        </select>
        <label style="margin-top:12px">發文機關（全銜）</label>
        <input v-model="letterIssuer" placeholder="例：社團法人○○協會">
        <label style="margin-top:12px">受文者</label>
        <input v-model="letterRecipient" placeholder="例：內政部">
      </template>
      <template v-if="kind === '簽到表'">
        <label>版型</label>
        <select v-model="signInLayout">
          <option v-for="(l, key) in SIGN_IN_LAYOUTS" :key="key" :value="key">{{ l.label }}</option>
        </select>
      </template>
      <template v-if="(kind === '公文' || kind === '簽到表') && planOptions.length">
        <label style="margin-top:12px">{{ kind === '公文' ? '說明「依據」的專案（不勾＝不寫依據）' : '標題顯示的專案（不勾＝不顯示）' }}</label>
        <div class="row" style="gap:14px">
          <label v-for="n in planOptions" :key="n" class="chk">
            <input v-model="pickedPlans" type="checkbox" :value="n">{{ n }}
          </label>
        </div>
      </template>
      <div class="row" style="margin-top:20px">
        <button class="btn" :disabled="downloading" @click="download">{{ downloading ? '產生中…' : '下載' }}</button>
        <button class="btn ghost" @click="emit('close')">關閉</button>
      </div>
    </div>
  </div>
</template>
