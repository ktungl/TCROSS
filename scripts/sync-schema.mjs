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

/** 對應 src/models/Activity.ts 的 applyActivityRecord()／activityToRecord() */
const WANTED = {
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
}

const res = await fetch(`${SERVER_URL}/schemas/Activity`, { headers })
if (!res.ok) {
  console.error(`讀取 schema 失敗 (${res.status})：${await res.text()}`)
  process.exit(1)
}
const existing = (await res.json()).fields || {}

const missing = Object.entries(WANTED).filter(([name]) => !existing[name])
if (!missing.length) {
  console.log('Activity schema 已經是最新的，沒有缺少的欄位。')
  process.exit(0)
}

console.log('前端需要但 Back4App 上不存在的欄位：')
for (const [name, type] of missing) console.log(`  ${name.padEnd(18)} ${type}`)

if (!process.argv.includes('--apply')) {
  console.log('\n唯讀模式，未變更任何東西。要實際建立請加上 --apply：')
  console.log('  node scripts/sync-schema.mjs --apply')
  process.exit(0)
}

const fields = {}
for (const [name, type] of missing) fields[name] = { type }

const put = await fetch(`${SERVER_URL}/schemas/Activity`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ className: 'Activity', fields }),
})
if (!put.ok) {
  console.error(`\n建立欄位失敗 (${put.status})：${await put.text()}`)
  process.exit(1)
}

console.log(`\n已建立 ${missing.length} 個欄位。Activity 現有欄位：`)
for (const [name, def] of Object.entries((await put.json()).fields || {})) {
  console.log(`  ${name.padEnd(18)} ${def.type}`)
}
