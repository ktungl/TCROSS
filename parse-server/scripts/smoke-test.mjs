// 對已部署的自架 Parse Server（Cloud Run）跑 checks.mjs 的行為檢查，並量每個請求耗時。
// 需要先用 import-backup.mjs 把同一份備份匯入，<備份資料夾>/import-result.json 才有登入用的臨時密碼。
// 會在正式資料庫留下一筆登入與一筆新增＋刪除的稽核紀錄（活動本身會刪掉）。
//
//   node scripts/smoke-test.mjs <備份資料夾> [伺服器網址，預設 tcross-parse]
import { readFileSync } from 'fs'
import { runChecks } from './checks.mjs'

const [dir, url = 'https://tcross-parse-502746951565.asia-east1.run.app/parse'] = process.argv.slice(2)
if (!dir) {
  console.error('用法：node scripts/smoke-test.mjs <備份資料夾> [伺服器網址]')
  process.exit(1)
}
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

console.log(`伺服器：${url}`)
const failed = await runChecks({ base: url, appId: env.VITE_PARSE_APP_ID, jsKey: env.VITE_PARSE_JS_KEY, dir })
process.exit(failed ? 1 : 0)
