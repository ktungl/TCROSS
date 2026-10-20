import fs from 'node:fs'
import { defineConfig } from '@playwright/test'

// 端到端測試打 GCP 上的自架 Parse Server（10-20 起就是正式資料庫），測試資料名稱加「【測試】」並在結束時刪除。
// 憑證檔（E2E_ENV_FILE）內容：E2E_PARSE_APP_ID／E2E_PARSE_JS_KEY／E2E_PARSE_SERVER_URL／E2E_USERNAME／E2E_PASSWORD
const envFile = process.env.E2E_ENV_FILE
if (envFile) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) process.env[line.slice(0, i)] ??= line.slice(i + 1).trim()
  }
}
for (const key of ['E2E_PARSE_APP_ID', 'E2E_PARSE_JS_KEY', 'E2E_USERNAME', 'E2E_PASSWORD']) {
  if (!process.env[key]) throw new Error(`缺少 ${key}，請設定 E2E_ENV_FILE 或環境變數`)
}

const PORT = 5174

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // 已存在的環境變數優先於 .env，所以這裡蓋掉的 Parse 設定不會被 .env 的正式站值取代
    env: {
      VITE_PARSE_APP_ID: process.env.E2E_PARSE_APP_ID!,
      VITE_PARSE_JS_KEY: process.env.E2E_PARSE_JS_KEY!,
      VITE_PARSE_SERVER_URL: process.env.E2E_PARSE_SERVER_URL || 'https://tcross-parse-502746951565.asia-east1.run.app/parse',
    },
  },
})
