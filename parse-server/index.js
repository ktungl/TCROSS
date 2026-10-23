// 自架 Parse Server（取代 Back4App），跑在 Cloud Run，資料庫是 Firestore 的 MongoDB 相容模式（tcross 資料庫）。
// 前端、Cloud Run 中介層、cloud/main.js 都照舊用 Parse 協定，只換伺服器網址，見 README.md。
import express from 'express'
import { ParseServer } from 'parse-server'
import { fileURLToPath } from 'url'

const required = ['DATABASE_URI', 'PARSE_APP_ID', 'PARSE_JS_KEY', 'PARSE_MASTER_KEY', 'PUBLIC_SERVER_URL']
const missing = required.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`缺少環境變數：${missing.join(', ')}`)
  process.exit(1)
}

const port = Number(process.env.PORT || 8080)
const mountPath = '/parse'

const server = new ParseServer({
  databaseURI: process.env.DATABASE_URI,
  appId: process.env.PARSE_APP_ID,
  javascriptKey: process.env.PARSE_JS_KEY,
  masterKey: process.env.PARSE_MASTER_KEY,
  // Cloud Code 透過這個網址呼叫自己（例如 afterSave 裡 useMasterKey 的查詢），走容器內部就好
  serverURL: `http://localhost:${port}${mountPath}`,
  publicServerURL: process.env.PUBLIC_SERVER_URL,
  // 部署時 scripts/deploy.sh 把專案根目錄的 cloud/main.js 複製進來（回滾到 Back4App 時也是貼同一份）
  cloud: fileURLToPath(new URL('./cloud/main.js', import.meta.url)),
  // Parse Server 預設只讓本機用 Master Key；Cloud Run 中介層與 GitHub Actions 備份都是從外部
  // 帶 Master Key 呼叫（和 Back4App 時一樣），所以放寬來源，安全靠 Secret Manager 保管金鑰。
  masterKeyIps: ['0.0.0.0/0', '::/0'],
  // 不讓前端自己建新 class／新欄位，跟 Back4App 上的 CLP（addField 全關）一致
  allowClientClassCreation: false,
  // 免費方案沒有寄信，忘記密碼由管理員用 scripts/setup-users.mjs 重設
  verifyUserEmails: false,
  // Firestore MongoDB 相容模式不支援 collation（建不出「帳號名稱不分大小寫」索引）。關掉後只少了
  // 「Test123／test123 視為重複」的檢查；帳號只由管理員用 setup-users.mjs 建，登入本來就分大小寫。
  enableCollationCaseComparison: true,
  // 以下是 Parse Server 9 預告「之後會改預設值」的選項，先寫死，升級時行為才不會悄悄改變。
  // 前三項維持 Back4App 目前的行為；其餘本專案沒用到（GraphQL／LiveQuery／推播），取較安全的值。
  protectedFieldsOwnerExempt: true,
  protectedFieldsTriggerExempt: false,
  protectedFieldsSaveResponseExempt: true,
  requestComplexity: { graphQLFields: 200, batchRequestLimit: 100 },
  allowAggregationForReadOnlyMasterKey: false,
  installation: { duplicateDeviceTokenActionEnforceAuth: true },
  enableLiveQueryClassLevelPermissionRoles: true,
})

await server.start()

const app = express()
app.set('trust proxy', true)
app.get('/health', (_req, res) => res.json({ ok: true }))
app.use(mountPath, server.app)
app.listen(port, () => console.log(`Parse Server 已啟動：port ${port}${mountPath}`))
