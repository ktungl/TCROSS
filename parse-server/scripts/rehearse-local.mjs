// 本機搬家演練：不碰 Firestore、不碰 Back4App、不碰 Cloud Run。
// 用 mongodb-memory-server 開一個暫時的 MongoDB → 跑 import-backup.mjs → 用 index.js（掛 cloud/main.js）
// 啟動 Parse Server → 以一般成員身分登入，驗證讀取、CLP、Cloud Code 驗證與稽核紀錄都和 Back4App 一致。
//
//   node scripts/rehearse-local.mjs <備份資料夾>
//
// 加環境變數 REHEARSE_DATABASE_URI（或寫在 .env）時，改用那個真正的資料庫做相容性測試
// （例如 Firestore MongoDB 相容模式）。該資料庫必須是空的（匯入會檢查），測完會刪掉所有 collection。
import { spawn } from 'child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { runChecks } from './checks.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('用法：node scripts/rehearse-local.mjs <備份資料夾>')
  process.exit(1)
}
const root = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(join(root, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}
const APP_ID = env.VITE_PARSE_APP_ID
const JS_KEY = env.VITE_PARSE_JS_KEY
const PORT = 18080
const base = `http://127.0.0.1:${PORT}/parse`

function run(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...extraEnv }, stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} 結束碼 ${code}`))))
  })
}

const externalUri = process.env.REHEARSE_DATABASE_URI || env.REHEARSE_DATABASE_URI
const mongod = externalUri ? null : await MongoMemoryServer.create()
const uri = externalUri || mongod.getUri('tcross')
let imported = false
let server
let failed = 0
try {
  console.log('══ 匯入 ══')
  if (externalUri) {
    // 只在原本是空的資料庫上演練，結束時的清空才不會刪到別人的資料
    const client = new MongoClient(uri)
    await client.connect()
    const existing = await client.db().listCollections().toArray()
    await client.close()
    if (existing.length) throw new Error(`測試資料庫不是空的（${existing.map((c) => c.name).join(', ')}），拒絕演練`)
  }
  imported = true // 就算匯入到一半失敗也要清，下次才能重跑
  await run(process.execPath, ['scripts/import-backup.mjs', dir, '--apply'], { TARGET_DATABASE_URI: uri })

  console.log('\n══ 啟動掛 Cloud Code 的 Parse Server ══')
  mkdirSync(join(root, 'cloud'), { recursive: true })
  copyFileSync(join(root, '..', 'cloud', 'main.js'), join(root, 'cloud', 'main.js'))
  server = spawn(process.execPath, ['index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URI: uri,
      PARSE_APP_ID: APP_ID,
      PARSE_JS_KEY: JS_KEY,
      PARSE_MASTER_KEY: 'rehearsal-master-key',
      PUBLIC_SERVER_URL: base,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('已啟動') && resolve()))

  failed += await runChecks({ base, appId: APP_ID, jsKey: JS_KEY, dir })
} catch (err) {
  console.error(err)
  failed++
} finally {
  server?.kill()
  if (mongod) {
    await mongod.stop()
  } else if (imported) {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db()
    for (const { name } of await db.listCollections().toArray()) await db.collection(name).drop()
    await client.close()
    console.log(`已清空測試資料庫 ${db.databaseName}`)
  }
}
process.exit(failed ? 1 : 0)
