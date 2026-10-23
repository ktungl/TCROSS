<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildActivityRecordXlsx,
  buildOfficialLetterDocx,
  buildReceiptXlsx,
  buildResultReportDocx,
  buildSignInSheetDocx,
  downloadBlob,
  generatedFormExtension,
  missingImagesMessage,
  ORGANIZER_NAME,
  SIGN_IN_LAYOUTS,
  takeImageLoadFailures,
  toChineseUpperAmount,
} from '../utils/exportDocs'
import type { GeneratedFormKind, OfficialLetterPurpose, ReceiptEntry, SignInLayout } from '../utils/exportDocs'
import { errorMessage, pushToast } from '../composables/useToast'
import { useEscape } from '../composables/useEscape'
import { isParsableRegistration, readParticipants } from '../utils/registration'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityRecord } from '../types'

const props = defineProps<{
  activity: ActivityRecord
  kind: GeneratedFormKind
  planName: (id: string) => string
}>()
const emit = defineEmits<{ close: [] }>()
useEscape(close)

const downloading = ref(false)

// 檔案還在產生時不讓對話框關掉，否則下載在背景完成卻沒有任何畫面回饋
function close() {
  if (downloading.value) return
  emit('close')
}

function readSaved(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function saveValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value.trim())
  } catch {
    // 無痕模式等情況存不了，不影響產生文件
  }
}

// 公文專用欄位；發文機關記在瀏覽器裡，下次不用重打
const ISSUER_KEY = 'tcross.letterIssuer'
const letterIssuer = ref(readSaved(ISSUER_KEY) || ORGANIZER_NAME)
const letterRecipient = ref('')
const letterPurpose = ref<OfficialLetterPurpose>('邀請參加')
// 公文「依據」、簽到表標題要列哪些計畫：活動上掛的計畫不一定都要寫進文件
// （例如「2026大事紀」），所以讓使用者自己勾，預設全勾
const planOptions = computed(() => props.activity.plans.map(props.planName))
const pickedPlans = ref<string[]>([...planOptions.value])
const pickedPlansInOrder = () => planOptions.value.filter((n) => pickedPlans.value.includes(n))

const signInLayout = ref<SignInLayout>('detailed')

// 領據：支付單位記在瀏覽器裡；一位講師（一個時段）一張，預設一張、時段帶活動時間
const RECEIPT_PAYER_KEY = 'tcross.receiptPayer'
const receiptPayer = ref(readSaved(RECEIPT_PAYER_KEY))
const receiptItem = ref('講師鐘點費')
const newReceiptEntry = (): ReceiptEntry => ({
  time: props.activity.time,
  timeEnd: props.activity.timeEnd,
  amount: 0,
  payeeName: '',
  payeeUnit: '',
})
const receiptEntries = ref<ReceiptEntry[]>([newReceiptEntry()])

// 簽到表可以從「參與者名單（報名表）」帶入單位／職稱／姓名；只有試算表格式讀得出欄位
const registrationFiles = computed(() => props.activity.files.registration ?? [])
const parsableRegistrations = computed(() => registrationFiles.value.filter(isParsableRegistration))
const registrationUrl = ref(parsableRegistrations.value[0]?.url ?? '')

const planNames = computed(() => props.activity.plans.map(props.planName).join('、'))

const summary = computed(() => {
  switch (props.kind) {
    case '簽到表': {
      const { perPage } = SIGN_IN_LAYOUTS[signInLayout.value]
      const pages = Math.ceil(Math.max(props.activity.headcount.total || 0, 1) / perPage)
      if (registrationUrl.value) {
        return `將產生 Word 簽到表，帶入報名表名單；頁數依名單人數與活動人數（${props.activity.headcount.total || 0} 人）較多者計算`
      }
      return `將產生 Word 簽到表，依活動人數（${props.activity.headcount.total || 0} 人）共 ${pages} 頁、${pages * perPage} 個簽到欄位`
    }
    case '領據':
      return `將產生 Excel 領據（比照「領據_單張」範本），每位講師／時段一張工作表，共 ${receiptEntries.value.length} 張；身分證字號、戶籍地址、電話留白由領款人填寫`
    case '活動紀錄表':
      return `將產生活動紀錄表 Excel 檔（含執行情形、附件統計：${ATTACHMENT_TYPES.map(([k, l]) => `${l} ${props.activity.files[k]?.length ?? 0}`).join('、')}）`
    case '成果報告':
      return '將產生一份 Word 成果報告：活動內容取自「活動流程」附件的文字與行程表，活動效益取自下方「儲存成果」的成果摘要與 KPI，另附照片圖說，並把「活動流程」「簽到表」的 PDF／圖片逐頁附在報告最後（不經過 AI）'
    case '公文':
      return '將產生一份 Word 公文（函），主旨與說明由活動資料帶入；發文日期、字號等請於下載後填寫'
  }
})

async function download() {
  downloading.value = true
  takeImageLoadFailures()
  try {
    let blob: Blob
    switch (props.kind) {
      case '簽到表': {
        const source = parsableRegistrations.value.find((f) => f.url === registrationUrl.value)
        const participants = source ? await readParticipants(source) : []
        blob = await buildSignInSheetDocx(props.activity, {
          titlePlans: pickedPlansInOrder(),
          layout: signInLayout.value,
          participants,
        })
        if (source) pushToast(`已從報名表帶入 ${participants.length} 位參加者`)
        break
      }
      case '領據':
        saveValue(RECEIPT_PAYER_KEY, receiptPayer.value)
        blob = await buildReceiptXlsx(props.activity, {
          payer: receiptPayer.value,
          item: receiptItem.value,
          plans: pickedPlansInOrder(),
          entries: receiptEntries.value,
        })
        break
      case '活動紀錄表':
        blob = await buildActivityRecordXlsx(props.activity, planNames.value)
        break
      case '成果報告':
        blob = await buildResultReportDocx(props.activity, planNames.value)
        break
      case '公文':
        saveValue(ISSUER_KEY, letterIssuer.value)
        blob = await buildOfficialLetterDocx(props.activity, {
          issuer: letterIssuer.value,
          recipient: letterRecipient.value,
          purpose: letterPurpose.value,
          basisPlans: pickedPlansInOrder(),
        })
        break
    }
    downloadBlob(`${props.activity.name}_${props.kind}.${generatedFormExtension(props.kind)}`, blob)
    const missing = missingImagesMessage()
    if (missing) pushToast(missing, 'error')
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="modal" v-modal-focus @click.self="close">
    <div class="card">
      <h2>{{ kind }}</h2>
      <p class="sub">{{ summary }}</p>
      <template v-if="kind === '公文'">
        <label>公文用途</label>
        <select v-model="letterPurpose">
          <option value="邀請參加">邀請參加活動</option>
          <option value="檢送成果">檢送活動成果</option>
        </select>
        <label class="field">發文機關（全銜）</label>
        <input v-model="letterIssuer" placeholder="例：社團法人○○協會">
        <label class="field">受文者</label>
        <input v-model="letterRecipient" placeholder="例：內政部">
      </template>
      <template v-if="kind === '簽到表'">
        <label>版型</label>
        <select v-model="signInLayout">
          <option v-for="(l, key) in SIGN_IN_LAYOUTS" :key="key" :value="key">{{ l.label }}</option>
        </select>
        <label class="field">從參與者名單（報名表）帶入</label>
        <select v-model="registrationUrl">
          <option value="">不帶入（空白簽到表）</option>
          <option v-for="f in parsableRegistrations" :key="f.url" :value="f.url">{{ f.name }}</option>
        </select>
        <p class="hint">
          <template v-if="!registrationFiles.length">這個活動還沒有上傳報名表。</template>
          <template v-else-if="!parsableRegistrations.length">已上傳的報名表不是 Excel／CSV 格式，無法自動帶入。</template>
          <template v-else>依表頭的「單位／職稱／姓名」欄位帶入（雙欄版型只帶姓名），名單之外依活動人數保留空白列。</template>
        </p>
      </template>
      <template v-if="kind === '領據'">
        <label>支付單位</label>
        <input v-model="receiptPayer" placeholder="例：社團法人○○協會">
        <label class="field">款項名稱</label>
        <input v-model="receiptItem" placeholder="例：講師鐘點費">
        <div v-for="(entry, i) in receiptEntries" :key="i" class="receipt-entry">
          <div class="row between">
            <strong>第 {{ i + 1 }} 張</strong>
            <button v-if="receiptEntries.length > 1" class="btn ghost sm" type="button" @click="receiptEntries.splice(i, 1)">移除</button>
          </div>
          <div class="grid2">
            <div>
              <label class="field">時段</label>
              <div class="row">
                <input v-model="entry.time" type="time" class="time-input">～<input v-model="entry.timeEnd" type="time" class="time-input">
              </div>
            </div>
            <div>
              <label class="field">金額（元，留 0 則空白手寫）</label>
              <input v-model.number="entry.amount" type="number" min="0" step="100">
              <p v-if="entry.amount > 0" class="hint">新台幣 {{ toChineseUpperAmount(entry.amount) }} 元整</p>
            </div>
            <div>
              <label class="field">領款人姓名（選填）</label>
              <input v-model="entry.payeeName">
            </div>
            <div>
              <label class="field">單位（選填）</label>
              <input v-model="entry.payeeUnit">
            </div>
          </div>
        </div>
        <button class="btn ghost sm field" type="button" @click="receiptEntries.push(newReceiptEntry())">＋ 再加一張</button>
      </template>
      <template v-if="(kind === '公文' || kind === '簽到表' || kind === '領據') && planOptions.length">
        <label class="field">{{ kind === '公文' ? '說明「依據」的計畫（不勾＝不寫依據）' : kind === '領據' ? '摘要顯示的計畫（不勾＝不顯示）' : '標題顯示的計畫（不勾＝不顯示）' }}</label>
        <div class="row" style="gap:14px">
          <label v-for="n in planOptions" :key="n" class="chk">
            <input v-model="pickedPlans" type="checkbox" :value="n">{{ n }}
          </label>
        </div>
      </template>
      <div class="row actions">
        <button class="btn" :disabled="downloading" @click="download">{{ downloading ? '產生中…' : '下載' }}</button>
        <button class="btn ghost" :disabled="downloading" @click="close">關閉</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.receipt-entry{margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r)}
.time-input{width:auto;flex:1}
</style>
