// 把 scripts/backup-parse.mjs 的備份還原到「另一個」Back4App app（還原演練用）。
// 目標 app 的 App ID 與正式站相同時直接拒絕，不會寫到正式站。
//
//   node scripts/restore-parse.mjs <備份資料夾>           只檢查備份與目標 app，列出會做的事（唯讀）
//   node scripts/restore-parse.mjs <備份資料夾> --apply   實際還原
//
// 目標 app 寫在 .env：RESTORE_PARSE_APP_ID／RESTORE_PARSE_MASTER_KEY（／RESTORE_PARSE_SERVER_URL，
// 預設 https://parseapi.back4app.com）。目標 app 必須是空的（備份裡的 class 都沒有資料），避免重複匯入。
//
// 還原順序：附件 → schema → 資料（依參照順序建立，舊 objectId 對應到新 objectId）→ 角色成員 → CLP → 核對筆數。
// Back4App 不能指定 objectId，所以 Pointer、ACL、角色成員，以及 createdById／targetId 這類「存 id 的字串」
// 都會換成新 id；附件重新上傳後，資料裡的檔案網址也換成新網址。
//
// ⚠️ 限制：
// - 帳號密碼：備份不含密碼雜湊，還原出的帳號是隨機臨時密碼（寫在 <備份資料夾>/restore-result.json，
//   只存在目標 app），要登入得重設密碼。正式站帳號密碼不受影響。
// - createdAt／updatedAt 會變成還原當下的時間（Parse 不允許指定），原始時間只留在備份檔。
// - Cloud Code（cloud/main.js）不在備份裡，從 git 手動貼到目標 app。
// - GCS 附件（url 為 gcs:attachments/…）不在這份備份裡，也不用重新上傳：還原後網址照舊指向 GCS 主桶。
//   主桶的檔案本身若遺失，從備份桶 attachments/（每日 Storage Transfer）複製回來。
import { randomBytes } from 'crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

const APP_ID = env.RESTORE_PARSE_APP_ID
const MASTER_KEY = env.RESTORE_PARSE_MASTER_KEY
const SERVER_URL = (env.RESTORE_PARSE_SERVER_URL || 'https://parseapi.back4app.com').replace(/\/$/, '')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dir = args.find((a) => !a.startsWith('--'))

if (!APP_ID || !MASTER_KEY) {
  console.error('.env 缺少 RESTORE_PARSE_APP_ID 或 RESTORE_PARSE_MASTER_KEY（還原目標的測試 app）')
  process.exit(1)
}
if (APP_ID === env.VITE_PARSE_APP_ID) {
  console.error('RESTORE_PARSE_APP_ID 和正式站相同，拒絕執行。還原演練請用另一個 app。')
  process.exit(1)
}
if (!dir || !existsSync(join(dir, 'manifest.json'))) {
  console.error('用法：node scripts/restore-parse.mjs <備份資料夾> [--apply]（資料夾裡要有 manifest.json）')
  process.exit(1)
}

const readJson = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'))
const manifest = readJson('manifest.json')
const schemas = readJson('schema.json')
const roles = readJson('roles.json')
const fileIndex = existsSync(join(dir, 'files-index.json')) ? readJson('files-index.json') : {}
const classNames = Object.keys(manifest.counts)
const data = Object.fromEntries(classNames.map((c) => [c, readJson(`classes/${c}.json`)]))

const headers = { 'X-Parse-Application-Id': APP_ID, 'X-Parse-Master-Key': MASTER_KEY }

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function count(className) {
  const res = await fetch(`${SERVER_URL}/classes/${className}?count=1&limit=0`, { headers })
  if (res.status === 400 || res.status === 404) return 0 // class 還不存在
  if (!res.ok) throw new Error(`count ${className} → HTTP ${res.status} ${await res.text()}`)
  return (await res.json()).count
}

// ── 檢查 ──────────────────────────────────────────────
console.log(`備份：${dir}（${manifest.exportedAt}）`)
console.log(`目標：${SERVER_URL}  App ID ${APP_ID.slice(0, 6)}…${apply ? '' : '（唯讀檢查）'}`)
const missingFiles = Object.values(fileIndex).filter((n) => !existsSync(join(dir, 'files', n)))
console.log(`附件：${Object.keys(fileIndex).length} 個${missingFiles.length ? `，⚠️ 缺 ${missingFiles.length} 個檔案` : ''}`)

const notEmpty = []
for (const c of classNames) {
  const n = await count(c)
  // 新 app 預設可能就有 _Role／_User 以外的空 class；只擋「已經有資料」的情況
  if (n > 0) notEmpty.push(`${c}（${n} 筆）`)
}
for (const c of classNames) console.log(`  ${c.padEnd(16)} ${data[c].length} 筆`)
if (notEmpty.length) {
  console.error(`目標 app 已有資料：${notEmpty.join('、')}。請換一個空的 app，避免重複匯入。`)
  process.exit(1)
}
if (!apply) {
  console.log('檢查通過。加 --apply 實際還原。')
  process.exit(0)
}

// ── 1. 附件 ──────────────────────────────────────────
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
const urlMap = new Map()
let i = 0
for (const [oldUrl, localName] of Object.entries(fileIndex)) {
  if (!existsSync(join(dir, 'files', localName))) continue
  // 本機檔名是「8 碼雜湊_原檔名」，上傳時拿掉前綴；Parse 會再自己加唯一前綴。檔名只能用英數等安全字元。
  const ext = extname(localName).toLowerCase()
  const safe = localName.slice(9).replace(/[^A-Za-z0-9._-]/g, '_') || `file${ext}`
  const res = await api('POST', `/files/${encodeURIComponent(safe)}`, readFileSync(join(dir, 'files', localName)), {
    'Content-Type': MIME[ext] || 'application/octet-stream',
  })
  urlMap.set(oldUrl, res.url)
  if (++i % 20 === 0) console.log(`  附件 ${i}/${Object.keys(fileIndex).length}`)
}
console.log(`1. 附件上傳 ${urlMap.size} 個`)

// ── 2. schema（先不設 CLP，最後再套，避免中途權限擋到）──────────
const DEFAULT_FIELDS = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL'])
const SYSTEM_FIELDS = {
  _User: new Set(['username', 'password', 'email', 'emailVerified', 'authData']),
  _Role: new Set(['name', 'users', 'roles']),
}
const schemaOf = Object.fromEntries(schemas.map((s) => [s.className, s]))
for (const c of classNames) {
  const s = schemaOf[c]
  if (!s) continue
  const fields = {}
  for (const [k, v] of Object.entries(s.fields)) {
    if (DEFAULT_FIELDS.has(k) || SYSTEM_FIELDS[c]?.has(k)) continue
    fields[k] = v.targetClass ? { type: v.type, targetClass: v.targetClass } : { type: v.type }
  }
  const existing = await fetch(`${SERVER_URL}/schemas/${c}`, { headers }).then((r) => (r.ok ? r.json() : null))
  if (!existing) await api('POST', `/schemas/${c}`, { className: c, fields })
  else {
    const missing = Object.fromEntries(Object.entries(fields).filter(([k]) => !existing.fields[k]))
    if (Object.keys(missing).length) await api('PUT', `/schemas/${c}`, { className: c, fields: missing })
  }
}
console.log(`2. schema 建立 ${classNames.length} 個 class`)

// ── 3. 資料 ──────────────────────────────────────────
// 被參照的先建：帳號 → 角色 → 計畫 → 分類 → 活動 → 生成工作 → 其他 → 操作紀錄（參照所有東西，放最後）
const ORDER = ['_User', '_Role', 'Plan', 'Category', 'Activity', 'GenerationJob']
const ordered = [
  ...ORDER.filter((c) => classNames.includes(c)),
  ...classNames.filter((c) => !ORDER.includes(c) && c !== 'AuditLog'),
  ...(classNames.includes('AuditLog') ? ['AuditLog'] : []),
]
const idMap = new Map()

/** 把舊 id／舊附件網址換成新的：Pointer、ACL 的 key、剛好等於舊 id 或舊網址的字串。 */
function remap(value) {
  if (typeof value === 'string') return idMap.get(value) ?? urlMap.get(value) ?? value
  if (Array.isArray(value)) return value.map(remap)
  if (value && typeof value === 'object') {
    if (value.__type === 'Pointer') return { ...value, objectId: idMap.get(value.objectId) ?? value.objectId }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [idMap.get(k) ?? k, remap(v)]))
  }
  return value
}

const tempPasswords = {}
const deferredAcl = [] // 帳號的 ACL 寫的是自己的 id，要建立後才知道新 id
for (const c of ordered) {
  const relationKeys = Object.entries(schemaOf[c]?.fields ?? {}).filter(([, v]) => v.type === 'Relation').map(([k]) => k)
  for (const row of data[c]) {
    const body = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === 'objectId' || k === 'createdAt' || k === 'updatedAt' || relationKeys.includes(k)) continue
      body[k] = remap(v)
    }
    if (c === '_User') {
      tempPasswords[row.username] = body.password = randomBytes(12).toString('base64url')
      delete body.ACL
    }
    const res = await api('POST', `/classes/${c}`, body)
    idMap.set(row.objectId, res.objectId)
    if (c === '_User' && row.ACL) deferredAcl.push([res.objectId, row.ACL])
  }
  for (const [newId, acl] of c === '_User' ? deferredAcl : []) await api('PUT', `/classes/_User/${newId}`, { ACL: remap(acl) })
  console.log(`3. ${c.padEnd(16)} ${data[c].length} 筆`)
}

// ── 4. 角色成員 ──────────────────────────────────────
const roleRows = data._Role ?? []
for (const [roleName, members] of Object.entries(roles)) {
  const role = roleRows.find((r) => r.name === roleName)
  if (!role || !members.length) continue
  await api('PUT', `/roles/${idMap.get(role.objectId)}`, {
    users: { __op: 'AddRelation', objects: members.map((m) => ({ __type: 'Pointer', className: '_User', objectId: idMap.get(m.objectId) })) },
  })
}
console.log(`4. 角色成員 ${Object.entries(roles).map(([k, v]) => `${k} ${v.length} 人`).join('、')}`)

// ── 5. CLP ───────────────────────────────────────────
for (const c of classNames) {
  const clp = schemaOf[c]?.classLevelPermissions
  if (clp) await api('PUT', `/schemas/${c}`, { className: c, classLevelPermissions: clp })
}
console.log('5. CLP 套用完成')

// ── 6. 核對 ──────────────────────────────────────────
let ok = true
console.log('6. 核對筆數（備份 → 目標）')
for (const c of classNames) {
  const n = await count(c)
  const same = n === manifest.counts[c]
  ok &&= same
  console.log(`  ${same ? '✅' : '❌'} ${c.padEnd(16)} ${manifest.counts[c]} → ${n}`)
}
for (const [roleName, members] of Object.entries(roles)) {
  const role = roleRows.find((r) => r.name === roleName)
  const { results } = await api('GET', `/classes/_User?${new URLSearchParams({ where: JSON.stringify({ $relatedTo: { object: { __type: 'Pointer', className: '_Role', objectId: idMap.get(role.objectId) }, key: 'users' } }) })}`)
  const same = results.length === members.length
  ok &&= same
  console.log(`  ${same ? '✅' : '❌'} 角色 ${roleName.padEnd(11)} ${members.length} → ${results.length}`)
}
const unmappedUrls = JSON.stringify(Object.fromEntries(ordered.map((c) => [c, data[c]]))).match(/https?:\/\/[^"]*(back4app\.com|b4a\.(io|app))[^"]*/g)?.filter((u) => fileIndex[u] && !urlMap.has(u)) ?? []
if (unmappedUrls.length) {
  ok = false
  console.log(`  ❌ ${unmappedUrls.length} 個附件網址沒換到新網址`)
}

writeFileSync(
  join(dir, 'restore-result.json'),
  JSON.stringify({ restoredAt: new Date().toISOString(), targetAppId: APP_ID, ok, tempPasswords, idMap: Object.fromEntries(idMap), urlMap: Object.fromEntries(urlMap) }, null, 2),
  'utf8',
)
console.log(ok ? '還原完成，筆數全部一致。' : '還原完成，但有項目不一致，請看上方 ❌。')
console.log(`新舊 id 對照與測試 app 臨時密碼：${join(dir, 'restore-result.json')}`)
if (!ok) process.exit(1)
