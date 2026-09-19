// 對照前端會寫入的欄位與 Back4App 上的 Activity schema，補上缺少的欄位。
//
// Back4App 不允許前端（JS Key）自動建欄位，會回 "Permission denied for action
// addField on class Activity"。這支腳本用 .env 裡的 PARSE_MASTER_KEY 建欄位，
// 只新增、不刪除也不改型別，所以不會動到既有資料。
//
//   node scripts/sync-schema.mjs           只列出差異（唯讀）
//   node scripts/sync-schema.mjs --apply   實際建立缺少的欄位
//
// 之後 src/models/Activity.ts 有新增欄位時，記得同步更新下面的 WANTED。
import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

const APP_ID = env.VITE_PARSE_APP_ID
const MASTER_KEY = env.PARSE_MASTER_KEY
const SERVER_URL = (env.VITE_PARSE_SERVER_URL || 'https://parseapi.back4app.com').replace(/\/$/, '')

if (!APP_ID || !MASTER_KEY) {
  console.error('.env 缺少 VITE_PARSE_APP_ID 或 PARSE_MASTER_KEY')
  process.exit(1)
}

const headers = {
  'X-Parse-Application-Id': APP_ID,
  'X-Parse-Master-Key': MASTER_KEY,
  'Content-Type': 'application/json',
}

/** 對應各 model 檔的 applyXRecord()／xToRecord()。key 是 Back4App 的 className。 */
const WANTED_BY_CLASS = {
  // src/models/Activity.ts
  Activity: {
    category: 'String',
    categories: 'Array',
    time: 'String',
    attendees: 'String',
    participantDesc: 'String',
    remark: 'String',
    maleCount: 'Number',
    femaleCount: 'Number',
    totalCount: 'Number',
    photoFiles: 'Array',
    signInFiles: 'Array',
    recordFiles: 'Array',
    agendaFiles: 'Array',
    documentFiles: 'Array',
    receiptFiles: 'Array',
    socialFiles: 'Array',
    mediaFiles: 'Array',
  },
  // src/models/Category.ts —— plans 是分類所屬的計畫（Pointer<Plan> 陣列，可複選可留空）
  Category: {
    plans: 'Array',
  },
}

const apply = process.argv.includes('--apply')
let anyMissing = false

for (const [className, WANTED] of Object.entries(WANTED_BY_CLASS)) {
  const res = await fetch(`${SERVER_URL}/schemas/${className}`, { headers })
  if (!res.ok) {
    console.error(`讀取 ${className} schema 失敗 (${res.status})：${await res.text()}`)
    process.exit(1)
  }
  const existing = (await res.json()).fields || {}

  const missing = Object.entries(WANTED).filter(([name]) => !existing[name])
  if (!missing.length) {
    console.log(`${className} schema 已經是最新的，沒有缺少的欄位。`)
    continue
  }
  anyMissing = true

  console.log(`${className}：前端需要但 Back4App 上不存在的欄位：`)
  for (const [name, type] of missing) console.log(`  ${name.padEnd(18)} ${type}`)

  if (!apply) continue

  const fields = {}
  for (const [name, type] of missing) fields[name] = { type }

  const put = await fetch(`${SERVER_URL}/schemas/${className}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ className, fields }),
  })
  if (!put.ok) {
    console.error(`\n建立 ${className} 欄位失敗 (${put.status})：${await put.text()}`)
    process.exit(1)
  }

  console.log(`\n已建立 ${missing.length} 個欄位。${className} 現有欄位：`)
  for (const [name, def] of Object.entries((await put.json()).fields || {})) {
    console.log(`  ${name.padEnd(18)} ${def.type}`)
  }
}

if (anyMissing && !apply) {
  console.log('\n唯讀模式，未變更任何東西。要實際建立請加上 --apply：')
  console.log('  node scripts/sync-schema.mjs --apply')
}
