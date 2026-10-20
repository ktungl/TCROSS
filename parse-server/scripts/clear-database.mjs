// 正式切換前清空 Firestore 的 tcross 資料庫，讓 import-backup.mjs 可以重新匯入最新備份。
// 只刪資料（deleteMany），不刪 collection：保留索引，Parse Server 重啟時才不用重建
// （Firestore 每建一個索引約 75 秒，全部重建會超過 Cloud Run 的啟動上限）。
// _SCHEMA 也保留，匯入時沿用同樣的欄位定義。
//
//   TARGET_DATABASE_URI=$(gcloud secrets versions access latest --secret parse-db-uri) \
//     node scripts/clear-database.mjs            列出每個 collection 的筆數（唯讀）
//     node scripts/clear-database.mjs --apply    實際清空
import { MongoClient } from 'mongodb'

const uri = process.env.TARGET_DATABASE_URI
if (!uri) {
  console.error('缺少 TARGET_DATABASE_URI（用法見檔頭）')
  process.exit(1)
}
const apply = process.argv.includes('--apply')
const KEEP = ['_SCHEMA']

const client = new MongoClient(uri)
await client.connect()
const db = client.db()
console.log(`資料庫：${db.databaseName}`)
const names = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort()
for (const name of names) {
  const n = await db.collection(name).countDocuments()
  const keep = KEEP.includes(name)
  console.log(`  ${name.padEnd(28)} ${String(n).padStart(5)} 筆${keep ? '（保留）' : ''}`)
  if (apply && !keep && n) await db.collection(name).deleteMany({})
}
console.log(apply ? '\n已清空（索引與 _SCHEMA 保留）。' : '\n以上是唯讀檢查，加 --apply 才會清空。')
await client.close()
