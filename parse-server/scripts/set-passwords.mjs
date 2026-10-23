// 幫自架 Parse Server 上的所有帳號設定密碼（匯入後帳號只有隨機臨時密碼，備份不含 Back4App 的密碼雜湊）。
// 團隊實測與正式切換用同一份密碼檔（--from），成員只需要記一組新密碼。
//
// 用 .env 的 VITE_PARSE_SERVER_URL／PARSE_MASTER_KEY（自架伺服器的 Master Key：
// gcloud secrets versions access latest --secret parse-server-master-key），也可以直接在指令前帶環境變數。
//
//     node scripts/set-passwords.mjs                     列出帳號（唯讀）
//     node scripts/set-passwords.mjs --apply             每個帳號產生新的隨機密碼並套用
//     node scripts/set-passwords.mjs --apply --from <檔> 套用既有密碼檔（正式切換重新匯入後用）
//
// 密碼檔寫在 backups/passwords-<時間>.json（backups/ 已列入 .gitignore），由管理員個別通知成員，
// 不要貼到群組或聊天紀錄。
import { randomInt } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { loadEnv, parseServerUrl, requireEnv } from '../../scripts/lib/env.mjs'

const env = loadEnv()
requireEnv(env, ['VITE_PARSE_APP_ID', 'PARSE_MASTER_KEY'])
const APP_ID = env.VITE_PARSE_APP_ID
const MASTER_KEY = env.PARSE_MASTER_KEY
const SERVER_URL = parseServerUrl(env)

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const fromIdx = args.indexOf('--from')
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null

if (SERVER_URL.includes('back4app')) {
  console.error('這支只用在自架伺服器（tcross-parse）')
  process.exit(1)
}

const headers = { 'X-Parse-Application-Id': APP_ID, 'X-Parse-Master-Key': MASTER_KEY, 'Content-Type': 'application/json' }
async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, { method, headers, body: body && JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`)
  return json
}

/** 12 碼，去掉 0/O/1/l/I 這類容易看錯的字元，方便口頭或手抄轉告 */
function newPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('')
}

const { results: users } = await api('GET', '/classes/_User?limit=1000&order=username')
console.log(`伺服器：${SERVER_URL}，共 ${users.length} 個帳號`)
for (const u of users) console.log(`  ${u.username}（${u.displayName || ''}）`)

const fromJson = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : {}
const passwords = fromJson.passwords || {}

// 密碼檔的 renames（舊帳號 → 新帳號）：Back4App 上還是舊帳號，重新匯入後要再改名一次
for (const [oldName, newName] of Object.entries(fromJson.renames || {})) {
  const u = users.find((x) => x.username === oldName)
  if (!u) continue
  console.log(`改帳號名稱 ${oldName} → ${newName}`)
  if (apply) await api('PUT', `/users/${u.objectId}`, { username: newName })
  u.username = newName
}
if (fromFile) {
  const missing = users.filter((u) => !passwords[u.username]).map((u) => u.username)
  if (missing.length) {
    console.error(`密碼檔缺少這些帳號：${missing.join(', ')}`)
    process.exit(1)
  }
}
if (!apply) {
  console.log('\n以上是唯讀檢查，加 --apply 才會改密碼。')
  process.exit(0)
}

for (const u of users) {
  passwords[u.username] ??= newPassword()
  await api('PUT', `/users/${u.objectId}`, { password: passwords[u.username] })
}
// 改密碼會讓 Parse 刪掉該帳號其他登入 session，成員要重新登入

if (fromFile) {
  console.log(`\n已依 ${fromFile} 套用 ${users.length} 個帳號的密碼。`)
} else {
  const dir = fileURLToPath(new URL('../../backups/', import.meta.url))
  if (!existsSync(dir)) mkdirSync(dir)
  const out = `${dir}passwords-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  const names = Object.fromEntries(users.map((u) => [u.username, u.displayName || '']))
  writeFileSync(out, JSON.stringify({ server: SERVER_URL, createdAt: new Date().toISOString(), displayNames: names, passwords }, null, 2))
  console.log(`\n已設定 ${users.length} 個帳號的新密碼，寫在 ${out}`)
  console.log('請個別通知成員，正式切換時用 --from 這個檔案沿用同一組密碼。')
}
