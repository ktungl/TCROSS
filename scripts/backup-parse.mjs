// 把 Parse Server（tcross-parse）上的資料整份匯出到本機（唯讀，不會改到線上任何東西）。
//
// 匯出內容：
//   schema.json        所有 class 的欄位定義與 CLP（還原時先建 schema）
//   classes/<名稱>.json 每個 class 的全部資料（_Session 除外）
//   roles.json         每個角色有哪些帳號（_Role 的 users relation 不會跟著物件回傳，要另外查）
//   manifest.json      匯出時間、各 class 筆數，用來核對備份是否完整
//
// 附件不在這裡：附件存在 GCS，由 Storage Transfer 每日複製到備份桶 attachments/（見 scripts/setup-attachments-gcs.sh）。
//
//   node scripts/backup-parse.mjs                  匯出到 backups/<時間>/
//   node scripts/backup-parse.mjs --out D:/備份    指定輸出資料夾
//
// ⚠️ _User 匯出不含密碼雜湊（Parse 不會回傳），還原後帳號需要重設密碼。
// ⚠️ 備份檔含個資，backups/ 已列入 .gitignore，不要放到公開位置。
//
// 需要 VITE_PARSE_APP_ID／VITE_PARSE_SERVER_URL／PARSE_MASTER_KEY：本機從 .env 讀，
// GitHub Actions（.github/workflows/backup-parse.yml）沒有 .env，改從環境變數讀。
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { loadEnv, parseServerUrl, requireEnv } from './lib/env.mjs'

const env = loadEnv()
requireEnv(env, ['VITE_PARSE_APP_ID', 'PARSE_MASTER_KEY'])
const APP_ID = env.VITE_PARSE_APP_ID
const MASTER_KEY = env.PARSE_MASTER_KEY
const SERVER_URL = parseServerUrl(env)

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir =
  outIdx >= 0 && args[outIdx + 1]
    ? args[outIdx + 1]
    : join(fileURLToPath(new URL('../backups/', import.meta.url)), stamp)

const headers = {
  'X-Parse-Application-Id': APP_ID,
  'X-Parse-Master-Key': MASTER_KEY,
}

/** 不需要備份的系統 class：登入 session 還原了也沒用，其餘是推播相關、本專案沒用到。 */
const SKIP_CLASSES = new Set(['_Session', '_Installation', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience', '_Idempotency', '_Hooks', '_GlobalConfig', '_GraphQLConfig'])

async function api(path) {
  const res = await fetch(`${SERVER_URL}${path}`, { headers })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

/** 用 objectId 遞增翻頁（不用 skip，資料多時 skip 會越來越慢且有上限）。 */
async function fetchAll(className, extraWhere = {}) {
  const rows = []
  let lastId = null
  for (;;) {
    const where = { ...extraWhere }
    if (lastId) where.objectId = { $gt: lastId }
    const qs = new URLSearchParams({ where: JSON.stringify(where), order: 'objectId', limit: '1000' })
    const { results } = await api(`/classes/${className}?${qs}`)
    rows.push(...results)
    if (results.length < 1000) return rows
    lastId = results[results.length - 1].objectId
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

mkdirSync(join(outDir, 'classes'), { recursive: true })
console.log(`輸出到 ${outDir}`)

const { results: schemas } = await api('/schemas')
writeJson(join(outDir, 'schema.json'), schemas)

const counts = {}
for (const { className } of schemas) {
  if (SKIP_CLASSES.has(className)) continue
  const rows = await fetchAll(className)
  writeJson(join(outDir, 'classes', `${className}.json`), rows)
  counts[className] = rows.length
  console.log(`  ${className.padEnd(16)} ${rows.length} 筆`)
}

const roles = {}
if (counts._Role) {
  const roleRows = JSON.parse(readFileSync(join(outDir, 'classes', '_Role.json'), 'utf8'))
  for (const role of roleRows) {
    const members = await fetchAll('_User', {
      $relatedTo: { object: { __type: 'Pointer', className: '_Role', objectId: role.objectId }, key: 'users' },
    })
    roles[role.name] = members.map((u) => ({ objectId: u.objectId, username: u.username }))
  }
}
writeJson(join(outDir, 'roles.json'), roles)

writeJson(join(outDir, 'manifest.json'), {
  exportedAt: new Date().toISOString(),
  serverUrl: SERVER_URL,
  appId: APP_ID,
  counts,
  roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.length])),
})
console.log('完成')
