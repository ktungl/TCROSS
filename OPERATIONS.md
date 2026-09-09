# 部署與維運說明

對應 [ROADMAP.md](ROADMAP.md)「10 月下半｜結案」第 1 項。這份文件只涵蓋能從程式碼與部署紀錄確認的技術操作；值班聯絡窗口、事件通報流程等組織面內容需要團隊補上（見文件底部「待補（組織面）」）。

## 系統組成

| 元件 | 位置 | 誰持有密鑰 |
| --- | --- | --- |
| 前端 SPA（Vue） | `src/`，目前只跑在本機 `localhost:5173`，還沒有正式網域 | 瀏覽器持有 Parse App ID／JS Key（設計上本來就公開，靠 Parse ACL／CLP 把關） |
| Back4App／Parse Server | 資料庫＋檔案儲存＋Cloud Code（`cloud/main.js`） | Master Key 只在 Back4App Dashboard 與 Cloud Run 的 Secret Manager，不進前端 |
| Cloud Run 中介層 `tcross-middleware` | `server/`，GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`，region `asia-east1` | 唯一持有 GCP 服務帳戶身分（`tcross-middleware-sa`）與 `PARSE_MASTER_KEY`（Secret Manager） |

## 日常健康檢查

```bash
# Cloud Run 中介層是否存活
curl https://tcross-middleware-502746951565.asia-east1.run.app/status
# 應回傳 {"ok": true}

# 目前正式運行的 revision
gcloud run services describe tcross-middleware --region asia-east1 \
  --format="value(status.latestReadyRevisionName)"
```

Back4App／Parse Server 本身的可用性看 [Back4App Dashboard](https://dashboard.back4app.com) 的 App 狀態頁；這是 Back4App 代管的部分，這份文件不重複他們的維運範圍。

## 查稽核紀錄／除錯

`server/main.py` 的 `audit_log`（2026-09-04 新增）會把 `/signed-url`／`/download-url`／`/delete-objects` 的成功操作與 401/403 拒絕都印到 stdout，Cloud Run 自動收進 Cloud Logging：

```bash
# 最近 30 分鐘的稽核紀錄
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="tcross-middleware"' \
  --freshness=30m --format="value(timestamp,textPayload)" --limit=100

# 只看拒絕（401/403/429）
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="tcross-middleware" AND textPayload:"rejected"' \
  --freshness=1d --format="value(timestamp,textPayload)"
```

## 部署一支新版 Cloud Run 中介層

```bash
cd server
gcloud run deploy tcross-middleware \
  --source . \
  --region asia-east1 \
  --service-account tcross-middleware-sa@project-80ac5e1a-2ea4-4000-9ff.iam.gserviceaccount.com
```

不用帶 `--set-env-vars`／`--set-secrets`——沒指定的話 `gcloud run deploy` 會沿用目前 revision 的環境變數與 Secret Manager 綁定。只有在真的要新增/修改環境變數時才需要帶（完整初始建置流程見 [server/README.md](server/README.md#部署到-cloud-run你有-gcp-專案後再做)）。

部署後務必用上面的「日常健康檢查」跟 `/signed-url`／`/download-url` 各打一次確認沒有回歸（curl 範例見 [server/README.md](server/README.md#驗證部署是否正確)）。

### 回滾到上一版

```bash
# 列出可回滾的 revision
gcloud run revisions list --service tcross-middleware --region asia-east1

# 把 100% 流量切回指定 revision（不用重新建置）
gcloud run services update-traffic tcross-middleware --region asia-east1 \
  --to-revisions=<上一個好的 revision 名稱>=100
```

## 部署 Back4App Cloud Code（`cloud/main.js`）

沒有 CLI 流程，只能手動貼到 Dashboard：步驟見 [cloud/README.md](cloud/README.md#部署步驟back4app-dashboard沒有額外工具需要裝)。**這步無法自動化**，改完 `cloud/main.js` 後要記得手動部署，否則正式環境還是跑舊邏輯。

## 密鑰與憑證

| 密鑰 | 存放位置 | 輪替方式 |
| --- | --- | --- |
| `PARSE_MASTER_KEY` | GCP Secret Manager（`parse-master-key`），Cloud Run 以環境變數方式掛載（`secretKeyRef`，非 volume mount） | 去 Back4App Dashboard 重新產生後，`gcloud secrets versions add parse-master-key --data-file=-` 更新一版。**這裡是環境變數形式的 secret，只在 revision 建立當下解析一次，改了新版本不會自動生效**——即使綁的是 `:latest`，也要重新部署一次（跑一次「部署一支新版 Cloud Run 中介層」）讓新 revision 重新解析才會撿到新金鑰 |
| `PARSE_APP_ID`／`PARSE_JS_KEY` | Cloud Run 環境變數（明文，設計上本來就是公開資訊）＋前端 `.env`（`.gitignore` 已排除） | 這兩把本來就假設公開，不是機密；真要換要同時改前端 `.env` 與 Cloud Run 環境變數 |
| `tcross-middleware-sa` 服務帳戶 | GCP IAM，無 JSON 金鑰檔（用 IAM 自我模擬簽 URL，見 [server/README.md](server/README.md)） | 沒有金鑰檔案可外洩，不需要輪替；如需撤銷存取直接在 IAM 移除該服務帳戶權限 |

## 已知限制

- **沒有自動化測試**：`server/` 沒有 CI/測試套件，每次部署後要手動跑健康檢查＋端點 curl（見上方）確認沒有回歸
- **Rate limit 是單 instance 記憶體內限流**：`server/main.py` 的 `enforce_rate_limit` 狀態不共享、重啟歸零，多 instance 情況下不是精確的硬上限，只拉高濫用門檻（細節見 [ROADMAP.md](ROADMAP.md#資安檢視依-iso-27001-annex-a-對照2026-09-04)）
- **備份機制尚未訂定**：Back4App／GCS 目前都沒有明確的備份/還原流程，ROADMAP 8 月工作項目仍列為待訂，需要團隊決定備份頻率與還原演練方式
- **正式網域未定**：`ALLOWED_ORIGIN` 目前只設 `http://localhost:5173`，前端還沒有正式部署網域

## 範本修改流程

大紀事 Excel／內政部結案 Word／簽到表／領據／活動紀錄表的產出邏輯全部在 `src/utils/download.ts`，用 `exceljs`（xlsx）與 `docx`（Word）組字串樣板，不是套現成的 Office 檔案模板。

**要改欄位、排版、抬頭文字**：

1. 找到對應的 `build*` 函式（例如大紀事是 `buildLedgerXlsx()`，內政部結案是 `buildNeimuReportDocx()`）
2. 改樣板內容（儲存格文字、欄寬、標題）
3. 本機 `npm run dev` 起服務，登入後到「匯出成果」頁面實際跑一次匯出，打開產出的 `.xlsx`/`.docx` 肉眼核對
4. 如果改動涉及圖片內嵌，參考 2026-09-04 驗證圖片內嵌排版的做法（見 [ROADMAP.md](ROADMAP.md) 9 月 Demo 項目 1）：在瀏覽器 devtools 攔截 `URL.createObjectURL()` 拿到匯出的 `Blob`，解壓內部 zip 比對圖片位元組是否跟原始檔案一致，比單純肉眼看排版更可靠

**要改欄位對照（資料模型新增/修改欄位）**：牽動 `src/types.ts`（型別定義）、`src/models/Activity.ts`（Parse 物件對應）、`cloud/main.js`（伺服器端驗證）、Back4App schema（`scripts/sync-schema.mjs --apply`）四處要一起改，任一處漏改都可能造成資料寫入失敗或驗證失效。

## 待補（組織面）

以下需要團隊自行補上，不是能從程式碼推導出來的：

- 事件通報流程／值班聯絡窗口
- 備份頻率與還原演練排程
- 正式網域決定後，`ALLOWED_ORIGIN`／CORS／DNS 的變更負責人與流程
