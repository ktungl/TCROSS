// 把 Back4App 上的資料整份匯出到本機（唯讀，不會改到線上任何東西）。
//
// 匯出內容：
//   schema.json        所有 class 的欄位定義與 CLP（還原時先建 schema）
//   classes/<名稱>.json 每個 class 的全部資料（_Session 除外）
//   roles.json         每個角色有哪些帳號（_Role 的 users relation 不會跟著物件回傳，要另外查）
//   files/             加 --files 時，下載資料裡引用到的 Back4App 附件（照片、簽到表等）
//   manifest.json      匯出時間、各 class 筆數、附件數，用來核對備份是否完整
//
//   node scripts/backup-parse.mjs                  只匯出資料（快，幾 MB 內）
//   node scripts/backup-parse.mjs --files          資料＋附件（附件可能很大）
//   node scripts/backup-parse.mjs --out D:/備份    指定輸出資料夾（預設 backups/<時間>/）
//
// ⚠️ _User 匯出不含密碼雜湊（Parse 不會回傳），還原後帳號需要重設密碼。
// ⚠️ 備份檔含個資，backups/ 已列入 .gitignore，不要放到公開位置。
//
// 需要 VITE_PARSE_APP_ID／VITE_PARSE_SERVER_URL／PARSE_MASTER_KEY：本機從 .env 讀，
// GitHub Actions（.github/workflows/backup-parse.yml）沒有 .env，改從環境變數讀。
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const env = {}
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].trim()
  }
}
for (const key of ['VITE_PARSE_APP_ID', 'VITE_PARSE_SERVER_URL', 'PARSE_MASTER_KEY']) {
  if (process.env[key]) env[key] = process.env[key]
}

const APP_ID = env.VITE_PARSE_APP_ID
const MASTER_KEY = env.PARSE_MASTER_KEY
const SERVER_URL = (env.VITE_PARSE_SERVER_URL || 'https://parseapi.back4app.com').replace(/\/$/, '')

if (!APP_ID || !MASTER_KEY) {
  console.error('.env 缺少 VITE_PARSE_APP_ID 或 PARSE_MASTER_KEY')
  process.exit(1)
}

const args = process.argv.slice(2)
const withFiles = args.includes('--files')
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

/** 找出資料裡所有附件網址：Parse File（{__type:'File', url}）與 FileMeta（{name, size, url}）。 */
function collectFileUrls(value, out) {
  if (Array.isArray(value)) value.forEach((v) => collectFileUrls(v, out))
  else if (value && typeof value === 'object') {
    if (typeof value.url === 'string' && /^https?:\/\//.test(value.url)) out.add(value.url)
    Object.values(value).forEach((v) => collectFileUrls(v, out))
  }
}

/** 只下載 Back4App 的檔案；GCS 的 Signed URL 會過期，AI 生成素材另有 GCS 保存規則。 */
function isParseFile(url) {
  const host = new URL(url).host
  return host.endsWith('back4app.com') || host.endsWith('b4a.io') || host.endsWith('b4a.app')
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

mkdirSync(join(outDir, 'classes'), { recursive: true })
console.log(`輸出到 ${outDir}`)

const { results: schemas } = await api('/schemas')
writeJson(join(outDir, 'schema.json'), schemas)

const counts = {}
const fileUrls = new Set()
for (const { className } of schemas) {
  if (SKIP_CLASSES.has(className)) continue
  const rows = await fetchAll(className)
  writeJson(join(outDir, 'classes', `${className}.json`), rows)
  counts[className] = rows.length
  collectFileUrls(rows, fileUrls)
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

const parseFiles = [...fileUrls].filter(isParseFile)
const fileIndex = {}
let downloaded = 0
let failed = 0
if (withFiles) {
  mkdirSync(join(outDir, 'files'), { recursive: true })
  for (const url of parseFiles) {
    // 檔名加網址雜湊前綴，避免不同活動的同名檔案互相覆蓋
    const base = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/[\\/:*?"<>|]/g, '_')
    const name = `${createHash('sha1').update(url).digest('hex').slice(0, 8)}_${base}`
    fileIndex[url] = name
    const dest = join(outDir, 'files', name)
    if (existsSync(dest)) continue
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      downloaded++
    } catch (err) {
      failed++
      console.warn(`  ⚠️ 下載失敗 ${url}：${err.message}`)
    }
  }
  writeJson(join(outDir, 'files-index.json'), fileIndex)
}

writeJson(join(outDir, 'manifest.json'), {
  exportedAt: new Date().toISOString(),
  serverUrl: SERVER_URL,
  appId: APP_ID,
  counts,
  roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.length])),
  parseFileCount: parseFiles.length,
  filesDownloaded: withFiles ? downloaded : null,
  filesFailed: withFiles ? failed : null,
})

console.log(`附件引用 ${parseFiles.length} 個${withFiles ? `，下載 ${downloaded} 個，失敗 ${failed} 個` : '（加 --files 才會下載）'}`)
if (failed) process.exit(1)
