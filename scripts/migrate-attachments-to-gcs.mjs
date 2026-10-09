// 把活動附件從 Back4App（parsefiles.back4app.com）複製到 GCS，並把 FileMeta.url 改成 gcs:…。
//
//   node scripts/migrate-attachments-to-gcs.mjs                 只列出要搬的檔案（唯讀）
//   node scripts/migrate-attachments-to-gcs.mjs --apply         實際搬遷
//   node scripts/migrate-attachments-to-gcs.mjs --restore-test  改對還原演練的測試 app（RESTORE_PARSE_*）
//
// - 只複製、不刪 Back4App 原檔：場域測試確認沒問題後再另外清除，期間隨時可以退回。
// - 同一個檔案被多個活動引用（歷史檔案）只上傳一次，各活動都指到同一個 GCS 物件。
// - 用 Master Key 寫回，並帶 X-Parse-Cloud-Context: attachmentMigration，cloud/main.js 會
//   保留原上傳者／最後修改者、不刪原檔，稽核只記一筆「附件搬移到 GCS」。
// - GCS 用本機 gcloud 登入的帳號上傳（gcloud auth print-access-token），需要主桶寫入權限。
// - 可以重跑：已經是 gcs: 的項目會略過；GCS 上用 ifGenerationMatch=0，不會覆蓋既有物件。
//
// 對照表寫到 backups/attachment-migration-<時間>.json（backups/ 不進 git）。
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const restoreTest = args.includes('--restore-test')
const bucketIdx = args.indexOf('--bucket')
const BUCKET = bucketIdx >= 0 ? args[bucketIdx + 1] : 'tcross-2026-project-80ac5e1a-2ea4-4000-9ff'

const APP_ID = restoreTest ? env.RESTORE_PARSE_APP_ID : env.VITE_PARSE_APP_ID
const MASTER_KEY = restoreTest ? env.RESTORE_PARSE_MASTER_KEY : env.PARSE_MASTER_KEY
const SERVER_URL = ((restoreTest ? env.RESTORE_PARSE_SERVER_URL : env.VITE_PARSE_SERVER_URL) || 'https://parseapi.back4app.com').replace(/\/$/, '')
if (!APP_ID || !MASTER_KEY) {
  console.error(`.env 缺少 ${restoreTest ? 'RESTORE_PARSE_APP_ID／RESTORE_PARSE_MASTER_KEY' : 'VITE_PARSE_APP_ID／PARSE_MASTER_KEY'}`)
  process.exit(1)
}

/** Activity 附件欄位 → GCS 路徑裡的分類（對應 server/utils.py ATTACHMENT_FOLDERS）。舊版 3 個欄位併到相近分類。 */
const FIELD_FOLDER = {
  registrationFiles: 'registration',
  photoFiles: 'photo',
  signInFiles: 'signIn',
  recordFiles: 'record',
  agendaFiles: 'agenda',
  documentFiles: 'document',
  receiptFiles: 'receipt',
  socialFiles: 'social',
  mediaFiles: 'media',
  audioFiles: 'media',
  videoFiles: 'media',
  docFiles: 'document',
}

const headers = { 'X-Parse-Application-Id': APP_ID, 'X-Parse-Master-Key': MASTER_KEY }
const isLegacy = (url) => typeof url === 'string' && /^https?:\/\//.test(url)

async function fetchActivities() {
  const rows = []
  let lastId = null
  for (;;) {
    const where = lastId ? { objectId: { $gt: lastId } } : {}
    const qs = new URLSearchParams({ where: JSON.stringify(where), order: 'objectId', limit: '1000', keys: ['name', ...Object.keys(FIELD_FOLDER)].join(',') })
    const res = await fetch(`${SERVER_URL}/classes/Activity?${qs}`, { headers })
    if (!res.ok) throw new Error(`讀取活動失敗 HTTP ${res.status} ${await res.text()}`)
    const { results } = await res.json()
    rows.push(...results)
    if (results.length < 1000) return rows
    lastId = results[results.length - 1].objectId
  }
}

/** 跟 server/utils.py sanitize_filename 同規則（保留副檔名） */
function sanitize(name) {
  const base = name.split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  const stem = (dot >= 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+|[._]+$/g, '') || 'file'
  const ext = dot >= 0 ? base.slice(dot + 1).replace(/[^A-Za-z0-9._-]/g, '') : ''
  return ext ? `${stem}.${ext}` : stem
}

let token = null
function gcsToken() {
  token ??= execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
  return token
}

async function uploadToGcs(path, data, contentType) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(path)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gcsToken()}`, 'Content-Type': contentType },
    body: data,
  })
  if (!res.ok) throw new Error(`上傳 GCS 失敗 ${path}：HTTP ${res.status} ${await res.text()}`)
  const meta = await res.json()
  if (Number(meta.size) !== data.length) throw new Error(`GCS 大小不符 ${path}：${meta.size} ≠ ${data.length}`)
}

// ── 盤點 ─────────────────────────────────────────────
const activities = await fetchActivities()
const plan = [] // { activity, field, index, item }
for (const a of activities) {
  for (const field of Object.keys(FIELD_FOLDER)) {
    ;(a[field] || []).forEach((item, index) => {
      if (item && isLegacy(item.url)) plan.push({ activity: a, field, index, item })
    })
  }
}
const uniqueUrls = new Set(plan.map((p) => p.item.url))
const touched = new Set(plan.map((p) => p.activity.objectId))
console.log(`目標：${SERVER_URL}  App ID ${APP_ID.slice(0, 6)}…  →  gs://${BUCKET}/attachments/`)
console.log(`活動 ${activities.length} 筆，其中 ${touched.size} 筆有舊附件；附件項目 ${plan.length} 個（不重複檔案 ${uniqueUrls.size} 個）`)
if (!apply) {
  for (const p of plan) console.log(`  ${p.activity.objectId} ${p.field.padEnd(13)} ${p.item.name}`)
  console.log('唯讀檢查。加 --apply 實際搬遷。')
  process.exit(0)
}

// ── 搬遷 ─────────────────────────────────────────────
const urlMap = new Map() // 舊網址 → gcs:路徑（同一檔案只傳一次）
let n = 0
for (const p of plan) {
  if (urlMap.has(p.item.url)) continue
  const res = await fetch(p.item.url)
  if (!res.ok) throw new Error(`下載失敗 ${p.item.url}：HTTP ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  const path = `attachments/${p.activity.objectId}/${FIELD_FOLDER[p.field]}/${randomBytes(4).toString('hex')}_${sanitize(p.item.name)}`
  await uploadToGcs(path, data, res.headers.get('content-type') || 'application/octet-stream')
  urlMap.set(p.item.url, `gcs:${path}`)
  if (++n % 10 === 0 || n === uniqueUrls.size) console.log(`  已上傳 ${n}/${uniqueUrls.size}`)
}

for (const a of activities) {
  if (!touched.has(a.objectId)) continue
  const body = {}
  let moved = 0
  for (const field of Object.keys(FIELD_FOLDER)) {
    const list = a[field]
    if (!Array.isArray(list) || !list.some((f) => f && urlMap.has(f.url))) continue
    body[field] = list.map((f) => {
      if (!f || !urlMap.has(f.url)) return f
      moved++
      return { ...f, url: urlMap.get(f.url) }
    })
  }
  const res = await fetch(`${SERVER_URL}/classes/Activity/${a.objectId}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Parse-Cloud-Context': JSON.stringify({ attachmentMigration: { moved } }),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`寫回活動 ${a.objectId} 失敗：HTTP ${res.status} ${await res.text()}`)
  console.log(`  ✅ ${a.objectId} ${a.name || ''}：${moved} 個`)
}

// ── 核對 ─────────────────────────────────────────────
const after = await fetchActivities()
let legacyLeft = 0
let stampLost = 0
const beforeById = new Map(activities.map((a) => [a.objectId, a]))
for (const a of after) {
  for (const field of Object.keys(FIELD_FOLDER)) {
    ;(a[field] || []).forEach((f, i) => {
      if (f && isLegacy(f.url)) legacyLeft++
      const prev = beforeById.get(a.objectId)?.[field]?.[i]
      if (prev && (prev.uploadedByName !== f.uploadedByName || prev.uploadedAt !== f.uploadedAt || prev.caption !== f.caption)) stampLost++
    })
  }
}
const outDir = fileURLToPath(new URL('../backups/', import.meta.url))
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outFile = `${outDir}attachment-migration-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
writeFileSync(outFile, JSON.stringify({ migratedAt: new Date().toISOString(), appId: APP_ID, bucket: BUCKET, urlMap: Object.fromEntries(urlMap) }, null, 2), 'utf8')
console.log(`核對：剩餘舊網址 ${legacyLeft} 個；上傳者／時間／圖說有變動 ${stampLost} 個`)
console.log(`對照表：${outFile}`)
if (legacyLeft || stampLost) process.exit(1)
