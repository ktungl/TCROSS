# 自架 Parse Server（Back4App → GCP）

對應 [ROADMAP.md](../ROADMAP.md) 第 15 項。Parse Server 跑在 Cloud Run（服務 `tcross-parse`，`asia-east1`），資料庫用 Firestore 的 MongoDB 相容模式（`tcross` 資料庫，`asia-east1`，2026-10-20 建立），帳單、權限、監控全部集中在同一個 GCP 專案。前端、Cloud Run 中介層和 `cloud/main.js` 都還是走 Parse 協定，切換時只要換伺服器網址。

**Back4App 不會被改動**：搬移只從每日備份（`scripts/backup-parse.mjs` 的匯出）讀資料，切換後 Back4App 停在切換當下的狀態，留作備份；要回滾就把網址改回去。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.js` | Cloud Run 上跑的 Parse Server，掛 `cloud/main.js` |
| `scripts/import-backup.mjs` | 把備份灌進 Firestore：保留 objectId 與建立／修改時間，最後逐筆逐欄核對 |
| `scripts/rehearse-local.mjs` | 演練：匯入＋以成員身分測登入、CLP、Cloud Code、稽核紀錄。預設用本機暫時的 MongoDB；`.env` 設 `REHEARSE_DATABASE_URI` 時改測真的資料庫（必須是空的，測完自動清空） |
| `scripts/checks.mjs` | 以成員身分的 15 項行為檢查（登入、CLP、Cloud Code、稽核紀錄、活動列表），並印出每個請求耗時；下面兩支共用 |
| `scripts/smoke-test.mjs` | 對已部署的 `tcross-parse` 跑 `checks.mjs`（會留下一筆登入與新增＋刪除的稽核紀錄） |
| `scripts/setup-gcp.sh` | 一次性：服務帳號、Firestore 正式帳密 `parse-server`（含 IAM）、Secret Manager（連線字串、新 Master Key） |
| `scripts/deploy.sh` | 部署／更新 Cloud Run（改完 `cloud/main.js` 也跑這支，不用再貼 Dashboard） |

## 步驟

1. **本機演練**（不連任何雲端服務）：`npm install`，再執行 `node scripts/backup-parse.mjs`（在專案根目錄）和 `node scripts/rehearse-local.mjs <備份資料夾>`。2026-10-20 已演練過：9606 個欄位 0 差異，14 項行為檢查全部通過。
2. **Firestore 相容性測試**：2026-10-20 已用演練帳密 `parse-rehearsal` 對 Firestore 跑過，9606 個欄位 0 差異，14 項行為檢查全部通過（匯入約 10 分鐘，因為是從本機逐筆寫入雲端）。
3. **GCP 設定**：`bash parse-server/scripts/setup-gcp.sh`（10-20 已完成；演練用帳密 `parse-rehearsal` 與其 IAM 已刪除，只剩正式的 `parse-server`）
4. **匯入 Firestore**：`TARGET_DATABASE_URI` 用 Secret Manager `parse-db-uri` 的值（`gcloud secrets versions access latest --secret parse-db-uri`，不要貼到聊天或 git），先執行 `node scripts/import-backup.mjs <備份資料夾>` 做唯讀檢查，確認後加 `--apply`。10-20 已匯入 00:59 的備份，9606 個欄位 0 差異。
5. **部署**：`bash parse-server/scripts/deploy.sh`，再跑 `node scripts/smoke-test.mjs <已匯入的備份資料夾>`。10-20 已部署，15 項全過，一般請求中位數 73 ms。
   - **全新的資料庫第一次啟動很慢**：Firestore 每建一個索引約 75 秒，Parse Server 啟動時要建約 8 個，會超過 Cloud Run 的 4 分鐘啟動上限而部署失敗。先在本機用同一個連線字串跑一次 `node index.js` 把索引建完（之後啟動只需幾秒），再部署。
6. **正式切換**（要暫停使用約半天）：
   1. 通知團隊停止使用，再匯出一份最新備份。
   2. 清空 Firestore 的 tcross 資料庫，重新執行 `import-backup.mjs --apply`。
   3. 套用和團隊實測相同的密碼：`node scripts/set-passwords.mjs --apply --from ../backups/passwords-current.json`（Master Key 帶法見腳本檔頭）。3 個成員帳號沿用 Back4App 原密碼，3 個開發者帳號是 10-20 新產生的；密碼檔在 `backups/`，不進 git。系統功能都完成後再協助成員改密碼（見 ROADMAP 第 11 項）。
   4. 改前端 `.env` 和 GitHub secret 的 `VITE_PARSE_SERVER_URL`，改成 `https://tcross-parse-502746951565.asia-east1.run.app/parse`。
   5. Cloud Run 中介層的 `PARSE_SERVER_URL` 改成同一個網址，Secret Manager `parse-master-key` 改成 `parse-server-master-key` 的值，然後重新部署。
   6. 每日備份的 `VITE_PARSE_SERVER_URL`／`PARSE_MASTER_KEY` 也換成新伺服器。
   7. 通知成員用新密碼登入。

## 和 Back4App 的差異

- **密碼**：Back4App 免費方案不給密碼雜湊，匯入的帳號是隨機臨時密碼（寫在 `<備份資料夾>/import-result.json`），切換時要重設。
- **帳號名稱大小寫**：Firestore 不支援 collation，所以設了 `enableCollationCaseComparison`，結果是不再把 `Test123`／`test123` 視為重複。帳號只由管理員建立，登入本來就分大小寫，影響很小。
- **Master Key 來源**：Parse Server 預設只允許本機使用 Master Key。中介層和備份都是從外部呼叫，所以 `masterKeyIps` 開放所有來源，和 Back4App 一樣靠保管好金鑰來把關。
- **舊附件**：資料裡已經沒有 `parsefiles.back4app.com` 的附件（2026-10-20 確認 0 個），附件都在 GCS，不用搬。
- **冷啟動**：Cloud Run 沒人使用時會縮到 0 台，閒置後第一個請求會慢幾秒。如果覺得太慢，可以加 `--min-instances 1`，但會多一點費用。
