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

/** 建立者／最後修改者，由 cloud/main.js 的 stampActor() 在伺服器端寫入，前端只讀。 */
const ACTOR_FIELDS = {
  createdById: 'String',
  createdByName: 'String',
  updatedById: 'String',
  updatedByName: 'String',
}

/** 對應各 model 檔的 applyXRecord()／xToRecord()。key 是 Back4App 的 className。 */
const WANTED_BY_CLASS = {
  // src/models/Activity.ts
  Activity: {
    category: 'String',
    categories: 'Array',
    time: 'String',
    timeEnd: 'String',
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
    ...ACTOR_FIELDS,
  },
  // src/models/Category.ts —— plans 是分類所屬的計畫（Pointer<Plan> 陣列，可複選可留空）
  Category: {
    plans: 'Array',
    ...ACTOR_FIELDS,
  },
  // src/models/GenerationJob.ts —— deletedAt 是軟刪除時間戳記，有值代表在「歷史檔案」
  // 垃圾桶裡，語意同 Activity 各 *Files 陣列項目裡的 FileMeta.deletedAt
  GenerationJob: {
    deletedAt: 'Date',
    ...ACTOR_FIELDS,
  },
  Plan: { ...ACTOR_FIELDS },
  // 顯示名稱（登入歡迎畫面、操作者紀錄用），由 scripts/setup-users.mjs 寫入
  _User: {
    displayName: 'String',
  },
  // 稽核紀錄，只有 cloud/main.js 的 writeAudit() 用 Master Key 寫入
  AuditLog: {
    action: 'String',
    targetClass: 'String',
    targetId: 'String',
    targetName: 'String',
    activityId: 'String',
    actorId: 'String',
    actorName: 'String',
    changes: 'Array',
    summary: 'String',
  },
}

const apply = process.argv.includes('--apply')
let anyMissing = false

for (const [className, WANTED] of Object.entries(WANTED_BY_CLASS)) {
  const res = await fetch(`${SERVER_URL}/schemas/${className}`, { headers })
  // 103 = Class 不存在（例如第一次跑時的 AuditLog），視為沒有任何欄位，--apply 時用 POST 建立
  let classExists = true
  if (!res.ok) {
    const body = await res.text()
    if (JSON.parse(body || '{}').code === 103) {
      classExists = false
    } else {
      console.error(`讀取 ${className} schema 失敗 (${res.status})：${body}`)
      process.exit(1)
    }
  }
  const existing = classExists ? (await res.json()).fields || {} : {}
  if (!classExists) console.log(`${className}：Back4App 上還沒有這個 class，會一併建立。`)

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
    method: classExists ? 'PUT' : 'POST',
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
