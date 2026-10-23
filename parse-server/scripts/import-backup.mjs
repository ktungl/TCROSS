// 把 scripts/backup-parse.mjs 匯出的 Back4App 備份，灌進自架 Parse Server 的 MongoDB（搬家用）。
// 只讀備份資料夾，完全不連 Back4App，所以 Back4App 原封不動、可以繼續當備份。
//
//   node scripts/import-backup.mjs <備份資料夾>           只檢查備份與目標資料庫，列出會做的事（唯讀）
//   node scripts/import-backup.mjs <備份資料夾> --apply   實際匯入，最後逐筆逐欄核對
//
// 目標資料庫：環境變數或專案根目錄 .env 的 TARGET_DATABASE_URI（mongodb+srv://…/tcross）。
// 必須是空的（備份裡的 class 都沒有資料），避免重複匯入。
//
// 做法：在這支腳本裡臨時啟動一個「沒有 Cloud Code」的 Parse Server 連到目標資料庫，用 REST 寫入
// （由 Parse 自己處理 ACL／Pointer／Relation 的儲存格式），再直接改 MongoDB 補回原本的
// createdAt／updatedAt。不掛 Cloud Code 是為了不讓 beforeSave 覆蓋操作者欄位、afterSave 多寫稽核紀錄。
//
// 自架伺服器可以指定 objectId，所以 objectId、Pointer、角色成員、createdById 等全部照舊，
// 不用對照表；建立／修改時間也保留。
//
// ⚠️ 帳號密碼：備份不含密碼雜湊，匯入的帳號是隨機臨時密碼（寫在 <備份資料夾>/import-result.json），
//    正式切換前用 scripts/setup-users.mjs 重設，再通知成員。
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { join } from 'path'
import express from 'express'
import { MongoClient } from 'mongodb'
import { ParseServer } from 'parse-server'
import { loadEnv, requireEnv } from '../../scripts/lib/env.mjs'

const env = loadEnv()

const APP_ID = env.VITE_PARSE_APP_ID
const JS_KEY = env.VITE_PARSE_JS_KEY
const DATABASE_URI = env.TARGET_DATABASE_URI
// 只活在這支腳本裡的臨時 Master Key，跟正式站的無關
const MASTER_KEY = randomBytes(24).toString('hex')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dir = args.find((a) => !a.startsWith('--'))

requireEnv(env, ['VITE_PARSE_APP_ID', 'VITE_PARSE_JS_KEY', 'TARGET_DATABASE_URI'])
if (!dir || !existsSync(join(dir, 'manifest.json'))) {
  console.error('用法：node scripts/import-backup.mjs <備份資料夾> [--apply]（資料夾裡要有 manifest.json）')
  process.exit(1)
}

const readJson = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'))
const manifest = readJson('manifest.json')
const schemas = readJson('schema.json')
const roles = readJson('roles.json')
// _User、_Role 先建，其餘 class 的 Pointer 不檢查存在與否，順序無所謂
const classNames = Object.keys(manifest.counts).sort((a, b) => order(a) - order(b))
const data = Object.fromEntries(classNames.map((c) => [c, readJson(`classes/${c}.json`)]))

function order(className) {
  return className === '_User' ? 0 : className === '_Role' ? 1 : 2
}

if (manifest.appId !== APP_ID) {
  console.error(`備份的 App ID（${manifest.appId}）和 .env 的 VITE_PARSE_APP_ID 不同，確認備份來源再執行。`)
  process.exit(1)
}

/** Parse 內建、不用（也不能）自己建的欄位 */
const BUILTIN_FIELDS = {
  _User: ['objectId', 'createdAt', 'updatedAt', 'ACL', 'username', 'password', 'email', 'emailVerified', 'authData'],
  _Role: ['objectId', 'createdAt', 'updatedAt', 'ACL', 'name', 'users', 'roles'],
  default: ['objectId', 'createdAt', 'updatedAt', 'ACL'],
}

// ───────────────────────── 臨時 Parse Server ─────────────────────────

const parseServer = new ParseServer({
  databaseURI: DATABASE_URI,
  appId: APP_ID,
  javascriptKey: JS_KEY,
  masterKey: MASTER_KEY,
  serverURL: 'http://localhost/parse', // 啟動後改成實際 port
  allowCustomObjectId: true,
  enableCollationCaseComparison: true, // 同 index.js：Firestore 不支援 collation
  silent: true,
})
await parseServer.start()
const app = express().use('/parse', parseServer.app)
const httpServer = createServer(app)
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}/parse`

const mongo = new MongoClient(DATABASE_URI)
await mongo.connect()
const db = mongo.db()

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Parse-Application-Id': APP_ID, 'X-Parse-Master-Key': MASTER_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`)
  return json
}

async function fetchAll(className, extraWhere = {}) {
  const rows = []
  let lastId = null
  for (;;) {
    const where = { ...extraWhere }
    if (lastId) where.objectId = { $gt: lastId }
    const qs = new URLSearchParams({ where: JSON.stringify(where), order: 'objectId', limit: '1000' })
    const { results } = await api('GET', `/classes/${className}?${qs}`)
    rows.push(...results)
    if (results.length < 1000) return rows
    lastId = results[results.length - 1].objectId
  }
}

async function finish(code) {
  await mongo.close()
  httpServer.close()
  process.exit(code) // 臨時 Parse Server 的資料庫連線隨行程結束
}

// ───────────────────────── 檢查 ─────────────────────────

console.log(`備份：${dir}（匯出於 ${manifest.exportedAt}）`)
console.log(`目標資料庫：${db.databaseName}`)
const notEmpty = []
for (const c of classNames) {
  const n = await db.collection(c).countDocuments()
  console.log(`  ${c.padEnd(16)} 備份 ${String(data[c].length).padStart(4)} 筆，目標現有 ${n} 筆`)
  if (n > 0) notEmpty.push(c)
}
if (notEmpty.length) {
  console.error(`目標資料庫已有資料（${notEmpty.join(', ')}），拒絕匯入。要重來請先清空目標資料庫。`)
  await finish(1)
}
if (!apply) {
  console.log('\n以上是唯讀檢查，確認無誤後加 --apply 實際匯入。')
  await finish(0)
}

// ───────────────────────── 匯入 ─────────────────────────

console.log('\n1. 建立 schema 與 CLP')
const existingSchemas = Object.fromEntries((await api('GET', '/schemas')).results.map((s) => [s.className, s]))
for (const s of schemas) {
  if (!classNames.includes(s.className)) continue // _Session 等不搬
  const builtin = BUILTIN_FIELDS[s.className] || BUILTIN_FIELDS.default
  const existing = existingSchemas[s.className]
  const fields = Object.fromEntries(
    Object.entries(s.fields).filter(([name]) => !builtin.includes(name) && !(existing && existing.fields[name])),
  )
  const body = { className: s.className, fields, classLevelPermissions: s.classLevelPermissions }
  await api(existing ? 'PUT' : 'POST', `/schemas/${s.className}`, body)
  console.log(`  ${s.className}：${Object.keys(fields).length} 個自訂欄位`)
}

console.log('2. 匯入資料（保留 objectId）')
const tempPasswords = {}
const strip = ({ createdAt, updatedAt, ...rest }) => rest
for (const c of classNames) {
  for (const row of data[c]) {
    if (c === '_User') {
      const password = randomBytes(12).toString('base64url')
      tempPasswords[row.username] = password
      await api('POST', '/users', { ...strip(row), password })
    } else if (c === '_Role') {
      const { users, roles: subRoles, ...rest } = strip(row)
      await api('POST', '/roles', rest)
    } else {
      await api('POST', `/classes/${c}`, strip(row))
    }
  }
  console.log(`  ${c}：${data[c].length} 筆`)
}
// POST /users 會順便建登入 session，這些不是真人登入，刪掉
await db.collection('_Session').deleteMany({})

console.log('3. 角色成員')
const roleIds = Object.fromEntries(data._Role.map((r) => [r.name, r.objectId]))
for (const [name, members] of Object.entries(roles)) {
  const objects = members.map((m) => ({ __type: 'Pointer', className: '_User', objectId: m.objectId }))
  await api('PUT', `/roles/${roleIds[name]}`, { users: { __op: 'AddRelation', objects } })
  console.log(`  ${name}：${members.length} 人`)
}

console.log('4. 補回原本的建立／修改時間')
for (const c of classNames) {
  if (!data[c].length) continue
  await db.collection(c).bulkWrite(
    data[c].map((row) => ({
      updateOne: {
        filter: { _id: row.objectId },
        update: { $set: { _created_at: new Date(row.createdAt), _updated_at: new Date(row.updatedAt) } },
      },
    })),
  )
}

// ───────────────────────── 核對 ─────────────────────────

console.log('5. 核對')
/** 鍵值排序後再比，忽略欄位順序 */
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

let problems = 0
let fieldsChecked = 0
for (const c of classNames) {
  const imported = Object.fromEntries((await fetchAll(c)).map((r) => [r.objectId, r]))
  let diff = 0
  for (const row of data[c]) {
    const got = imported[row.objectId]
    if (!got) {
      console.error(`  ✗ ${c} ${row.objectId} 不見了`)
      diff++
      continue
    }
    for (const [k, v] of Object.entries(row)) {
      fieldsChecked++
      if (!same(v, got[k])) {
        console.error(`  ✗ ${c} ${row.objectId}.${k}：備份 ${JSON.stringify(v)}，匯入後 ${JSON.stringify(got[k])}`)
        diff++
      }
    }
  }
  const extra = Object.keys(imported).length - data[c].length
  if (extra) {
    console.error(`  ✗ ${c} 多出 ${extra} 筆`)
    diff++
  }
  console.log(`  ${diff ? '✗' : '✓'} ${c}：${Object.keys(imported).length}／${data[c].length} 筆`)
  problems += diff
}
for (const [name, members] of Object.entries(roles)) {
  const pointer = { __type: 'Pointer', className: '_Role', objectId: roleIds[name] }
  const got = (await fetchAll('_User', { $relatedTo: { object: pointer, key: 'users' } })).map((u) => u.objectId).sort()
  const want = members.map((m) => m.objectId).sort()
  const ok = same(got, want)
  if (!ok) problems++
  console.log(`  ${ok ? '✓' : '✗'} 角色 ${name}：${got.length}／${want.length} 人`)
}
const importedSchemas = Object.fromEntries((await api('GET', '/schemas')).results.map((s) => [s.className, s]))
for (const s of schemas) {
  if (!classNames.includes(s.className)) continue
  const ok = same(importedSchemas[s.className]?.classLevelPermissions, s.classLevelPermissions)
  if (!ok) {
    console.error(`  ✗ ${s.className} CLP 不同：${JSON.stringify(importedSchemas[s.className]?.classLevelPermissions)}`)
    problems++
  }
}

writeFileSync(
  join(dir, 'import-result.json'),
  JSON.stringify({ importedAt: new Date().toISOString(), database: db.databaseName, problems, tempPasswords }, null, 2),
)
console.log(`\n共核對 ${fieldsChecked} 個欄位，${problems ? `有 ${problems} 個問題` : '0 差異'}。`)
console.log(`臨時密碼寫在 ${join(dir, 'import-result.json')}（含帳號資訊，不要外流）。`)
await finish(problems ? 1 : 0)
