// 腳本共用的設定讀取：專案根目錄 .env（沒有就略過），同名的環境變數優先
// （GitHub Actions 沒有 .env；臨時換值也可以直接在指令前面帶環境變數）。
import { existsSync, readFileSync } from 'fs'

export function loadEnv() {
  const env = {}
  const envFile = new URL('../../.env', import.meta.url)
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) env[m[1]] = m[2].trim()
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value) env[key] = value
  }
  return env
}

/** 缺任何一個就印出來並結束 */
export function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k])
  if (missing.length) {
    console.error(`缺少 ${missing.join('／')}（.env 或環境變數）`)
    process.exit(1)
  }
}

/** Parse Server 網址（VITE_PARSE_SERVER_URL，正式是 tcross-parse），去掉結尾斜線。
 * 沒設定就結束，不再預設連 Back4App。 */
export function parseServerUrl(env) {
  requireEnv(env, ['VITE_PARSE_SERVER_URL'])
  return env.VITE_PARSE_SERVER_URL.replace(/\/$/, '')
}
