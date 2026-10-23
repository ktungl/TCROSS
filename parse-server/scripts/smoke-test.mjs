// 對已部署的自架 Parse Server（Cloud Run）跑 checks.mjs 的行為檢查，並量每個請求耗時。
// 需要先用 import-backup.mjs 把同一份備份匯入，<備份資料夾>/import-result.json 才有登入用的臨時密碼。
// 會在正式資料庫留下一筆登入與一筆新增＋刪除的稽核紀錄（活動本身會刪掉）。
//
//   node scripts/smoke-test.mjs <備份資料夾> [伺服器網址，預設 .env 的 VITE_PARSE_SERVER_URL]
import { runChecks } from './checks.mjs'
import { loadEnv, parseServerUrl } from '../../scripts/lib/env.mjs'

const env = loadEnv()
const [dir, url = parseServerUrl(env)] = process.argv.slice(2)
if (!dir) {
  console.error('用法：node scripts/smoke-test.mjs <備份資料夾> [伺服器網址]')
  process.exit(1)
}

console.log(`伺服器：${url}`)
const failed = await runChecks({ base: url, appId: env.VITE_PARSE_APP_ID, jsKey: env.VITE_PARSE_JS_KEY, dir })
process.exit(failed ? 1 : 0)
