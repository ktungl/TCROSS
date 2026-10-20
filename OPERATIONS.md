# 部署與維運說明

這份文件只涵蓋能從程式碼與部署紀錄確認的技術操作；值班聯絡窗口、事件通報流程等組織面內容需要團隊補上（見文件底部「待補（組織面）」與 [ROADMAP.md](ROADMAP.md) #10）。

## 系統組成

| 元件 | 位置 | 誰持有密鑰 |
| --- | --- | --- |
| 前端 SPA（Vue） | `src/`，部署在 Firebase Hosting，正式網址 `https://tacc-iip.web.app`（見「部署前端」），尚未綁自訂網域 | 瀏覽器持有 Parse App ID／JS Key（設計上本來就公開，靠 Parse ACL／CLP 把關） |
| 自架 Parse Server `tcross-parse`（**2026-10-20 起為正式資料庫**） | `parse-server/`，Cloud Run `asia-east1`＋Firestore MongoDB 相容模式資料庫 `tcross`，掛 `cloud/main.js`，見 [parse-server/README.md](parse-server/README.md) | Master Key 與資料庫連線字串只在 Secret Manager（`parse-server-master-key`／`parse-db-uri`），服務帳號 `tcross-parse-sa` |
| Back4App（**10-20 起停用，保留當備份**） | 停在 10-20 15:43 切換當下的資料，回滾用 | Master Key 在 Back4App Dashboard、Secret Manager `parse-master-key`（已不掛在任何服務上）、本機 `.env` 的 `BACK4APP_PARSE_MASTER_KEY` |
| Cloud Run 中介層 `tcross-middleware` | `server/`，GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`，region `asia-east1` | 唯一持有 GCP 服務帳戶身分（`tcross-middleware-sa`）與 `PARSE_MASTER_KEY`（Secret Manager） |

## 日常健康檢查

```bash
# Cloud Run 中介層是否存活
curl https://tcross-middleware-502746951565.asia-east1.run.app/status
# 應回傳 {"ok": true}

# 自架 Parse Server 是否存活
curl https://tcross-parse-502746951565.asia-east1.run.app/health
# 應回傳 {"ok":true}

# 目前正式運行的 revision
gcloud run services describe tcross-middleware --region asia-east1 \
  --format="value(status.latestReadyRevisionName)"
gcloud run services describe tcross-parse --region asia-east1 \
  --format="value(status.latestReadyRevisionName)"
```

Parse Server 的錯誤記錄用同樣的 `gcloud logging read`，把 `service_name` 換成 `tcross-parse`。

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

## 部署前端（Firebase Hosting）

前端是純靜態 SPA，部署到 GCP 專案 `project-80ac5e1a-2ea4-4000-9ff` 的 Firebase Hosting（設定見 `firebase.json`／`.firebaserc`，所有路徑改寫回 `/index.html`）。

`VITE_*` 環境變數是**建置當下**寫進 bundle 的，所以一定要在有完整 `.env`（含 `VITE_GOOGLE_MAPS_API_KEY`）的機器上建置。部署會把本機 `dist/` 原樣上傳，**請先確認工作目錄是要上線的 commit、沒有未提交的半成品**。

```bash
# 第一次：Firebase CLI 要用有該 GCP 專案權限的帳號登入
firebase login

npm run build
firebase deploy --only hosting   # 本機若登入多個帳號，加 --account <有專案權限的帳號>
```

### 前端自動部署（GitHub Actions）

`main` 有新 commit（且改到 `server/`、`cloud/`、`*.md` 以外的檔案）時，`.github/workflows/deploy-hosting.yml` 會自動 `npm run build` 並部署；也可在 GitHub → Actions 手動觸發。GitHub 用 Workload Identity Federation 換短效憑證扮演 `github-deployer` 服務帳戶（只有 `roles/firebasehosting.admin`），只有 `ktungl/TCROSS` 的 `main` 換得到，沒有 JSON 金鑰。一次性設定見 `scripts/setup-github-deploy.sh`。

建置用的 `VITE_*` 放在 GitHub repo secrets（名稱同 `.env.example`），改 `.env` 時要同步更新：

```bash
gh secret set VITE_GOOGLE_MAPS_API_KEY -R ktungl/TCROSS   # 會提示輸入值
```

### 回滾前端

Firebase Console → Hosting → 版本記錄 → 選上一個好的版本「復原」，不用重新建置。

### 換網域時

新網域要同步加進 Cloud Run `ALLOWED_ORIGIN`（見下方，要帶 `--update-env-vars`，值含逗號時用 `^;^` 換分隔符）與 Google Maps 金鑰的網站限制白名單。

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

## 帳號與角色

系統內有兩個角色，權限相同（活動／計畫／分類／附件／AI 生成全部可以新增、修改、刪除）：

| 角色 | 帳號 | 顯示名稱 |
| --- | --- | --- |
| `member` | `ruoting.chen`、`qiyuan.huang`、`youjun.shen` | 陳若庭、黃琪媛、沈宥均 |
| `developer` | `ching.chen`、`Test123`、`ya.ting`（10-20 由 `qa_cc_1786685240` 改名） | 陳怡靜、冠彤、雅婷 |

**新增／修改帳號**：編輯 `scripts/users.local.json`（含初始密碼，不進 git；格式見 `scripts/users.example.json`），然後：

```bash
node scripts/setup-users.mjs                 # 唯讀，先看會改什麼
node scripts/setup-users.mjs --apply         # 建帳號／改顯示名稱／加入角色
node scripts/setup-users.mjs --apply --clp   # 連同資料表權限（CLP）一起套用
```

- 既有帳號**不會被改密碼**，腳本只更新 username／displayName 與角色。
- 不在任何角色裡的帳號讀不到任何資料；`--clp` 會先檢查，有漏的會拒絕套用。
- 顯示名稱只能用這支腳本（Master Key）改，使用者自己改會被 Cloud Code 擋下（防止冒用別人名字）。

**操作紀錄**：每一次新增／修改／刪除、附件上傳／移到垃圾桶／復原／永久刪除、AI 生成狀態變化、登入登出，都會由 Cloud Code 寫一筆到 `AuditLog`（自架 Parse Server）。前端「操作紀錄」頁可依人員／類型／日期查，活動詳情頁底部也可以看單一活動的紀錄。這些紀錄沒有人能改或刪（包含開發者用前端），只有持有 Master Key 的腳本能動。

## 自架 Parse Server（正式資料庫）

2026-10-20 15:43 正式切換：用當下的 Back4App 備份重新匯入（9983 個欄位 0 差異），前端（GitHub secret `VITE_PARSE_SERVER_URL`）、中介層（`PARSE_SERVER_URL`＋secret `parse-server-master-key`）、每日備份（GitHub secret `PARSE_MASTER_KEY`）都已改指向 `https://tcross-parse-502746951565.asia-east1.run.app/parse`。Back4App 保留不動當備份。

**回滾到 Back4App**（只在新系統出大問題時；切換後新增的資料要另外補回 Back4App）：
1. `gh secret set VITE_PARSE_SERVER_URL --body https://parseapi.back4app.com`，`PARSE_MASTER_KEY` 改回 Back4App 的（本機 `.env` 的 `BACK4APP_PARSE_MASTER_KEY`），再 `gh workflow run deploy-hosting.yml --ref main`。
2. `gcloud run services update tcross-middleware --region asia-east1 --update-env-vars PARSE_SERVER_URL=https://parseapi.back4app.com --update-secrets PARSE_MASTER_KEY=parse-master-key:latest`。
3. 確認 Back4App Cloud Code 是 `cloud/main.js` 的內容（10-20 曾被 HerzBaa 的程式蓋掉，正式站全部登不進去）。

```bash
curl https://tcross-parse-502746951565.asia-east1.run.app/health   # 應回傳 {"ok":true}
bash parse-server/scripts/deploy.sh                                  # 部署／更新（含 cloud/main.js）
node parse-server/scripts/smoke-test.mjs <已匯入的備份資料夾>       # 行為檢查＋耗時
```

改 `cloud/main.js` 後跑 `bash parse-server/scripts/deploy.sh` 部署，不用再手動貼 Back4App Dashboard。

## 部署 Back4App Cloud Code（`cloud/main.js`，只在回滾時需要）

沒有 CLI 流程，只能手動貼到 Dashboard：步驟見 [cloud/README.md](cloud/README.md)「回滾到 Back4App 時」。

## 資料備份（10-20 起備份自架 Parse Server）

GitHub Actions（`.github/workflows/backup-parse.yml`）每天台灣時間 02:00 跑 `scripts/backup-parse.mjs --files`，把所有 class、schema、角色成員（以及舊版 Back4App 附件，資料裡已 0 個）打包成 `parse-<時間>.tar.gz`，上傳到 `gs://project-80ac5e1a-2ea4-4000-9ff-backup/parse/`。

- **保存**：`parse/` 90 天後自動刪除；Nearline 儲存類別（存放便宜，還原下載時才有少量讀取費）。
- **活動附件**：存在 GCS 主桶 `attachments/`，由 Storage Transfer Service 每天增量複製到備份桶 `attachments/`（只新增／更新、不同步刪除、不套 90 天規則），設定見 `scripts/setup-attachments-gcs.sh`。
- **權限**：`github-backup` 服務帳號只有該桶的 `storage.objectCreator`，只能新增備份、不能讀取／覆蓋／刪除既有備份。用 Workload Identity Federation，不存 JSON 金鑰；GCP 端一次性設定見 `scripts/setup-github-backup.sh`。
- **不含密碼**：`_User` 匯出不含密碼雜湊（Parse 不會回傳），還原後帳號需要重設密碼。也不含 GCS 主桶的 AI 生成素材（另有 30 天保存規則）。
- **確認有在跑**：GitHub → Actions → 「Backup Back4App to GCS」（名稱沿用舊稱，ROADMAP #17 時改名），或 `gh run list --workflow backup-parse.yml`。失敗時 GitHub 會寄信給觸發者。
- **手動備一份**：Actions 頁按「Run workflow」；或本機 `node scripts/backup-parse.mjs --files`（存在 `backups/`，已列入 `.gitignore`）。
- **下載備份**：`gcloud storage ls gs://project-80ac5e1a-2ea4-4000-9ff-backup/parse/` 找檔名，再 `gcloud storage cp` 下載後 `tar -xzf` 解開。下載需要專案 Owner／Storage 管理權限的帳號。

### 還原

**還原到自架 Parse Server（Firestore）**：用 `parse-server/scripts/import-backup.mjs`，會保留 objectId 與建立／修改時間，最後逐筆逐欄核對；目標資料庫必須是空的（正式資料庫要先 `clear-database.mjs --apply`）。10-20 正式切換就是用這個流程，步驟與注意事項見 [parse-server/README.md](parse-server/README.md) 第 4、6 步。匯入後帳號是臨時密碼，用 `parse-server/scripts/set-passwords.mjs` 設定。

**還原到 Back4App（舊流程，只在 Back4App 刪除前、需要回滾時用）**：`scripts/restore-parse.mjs` 把解開的備份資料夾還原到**另一個空的** Back4App app（目標 App ID 與正式站相同會拒絕執行；目標已有資料也會拒絕）。目標寫在 `.env` 的 `RESTORE_PARSE_APP_ID`／`RESTORE_PARSE_MASTER_KEY`。

```
node scripts/restore-parse.mjs <備份資料夾>           # 唯讀檢查
node scripts/restore-parse.mjs <備份資料夾> --apply   # 實際還原，最後自動核對筆數與角色成員
```

- Back4App 不能指定 objectId，還原後全部換新 id，Pointer／ACL／角色成員／`createdById` 等 id 字串會自動對應；附件重新上傳並換成新網址。對照表存在 `<備份資料夾>/restore-result.json`。
- 帳號是隨機臨時密碼（同一個檔案），要登入得重設；`createdAt`／`updatedAt` 變成還原當下時間；Cloud Code 要從 git 另外貼上。
- 真的要以還原的 Back4App app 取代正式站時：貼 Cloud Code → 前端 `.env`／GitHub secrets 的 `VITE_PARSE_*` 換成新 app → Cloud Run 的 `PARSE_APP_ID`／`PARSE_JS_KEY` 與 Secret Manager `parse-master-key` 換成新 app 後重新部署 → 通知成員重設密碼。
- **演練紀錄**：10-05 還原到 `TCROSS-restore-test`，筆數、角色成員全部一致，2058 個欄位比對 0 差異，86 個附件全部可開啟。

## 密鑰與憑證

| 密鑰 | 存放位置 | 輪替方式 |
| --- | --- | --- |
| `PARSE_MASTER_KEY`（Back4App 的，10-20 起只留作回滾） | GCP Secret Manager（`parse-master-key`），切換後已不掛在任何服務上 | 去 Back4App Dashboard 重新產生後，`gcloud secrets versions add parse-master-key --data-file=-` 更新一版。**這裡是環境變數形式的 secret，只在 revision 建立當下解析一次，改了新版本不會自動生效**——即使綁的是 `:latest`，也要重新部署一次（跑一次「部署一支新版 Cloud Run 中介層」）讓新 revision 重新解析才會撿到新金鑰。**另外 GitHub repo secret `PARSE_MASTER_KEY`（每日備份用）也要同步更新**：`gh secret set PARSE_MASTER_KEY` |
| `PARSE_APP_ID`／`PARSE_JS_KEY` | Cloud Run 環境變數（明文，設計上本來就是公開資訊）＋前端 `.env`（`.gitignore` 已排除） | 這兩把本來就假設公開，不是機密；真要換要同時改前端 `.env` 與 Cloud Run 環境變數 |
| `parse-server-master-key`（正式的 Master Key） | GCP Secret Manager，`tcross-parse` 與 `tcross-middleware` 都以環境變數掛載；GitHub secret `PARSE_MASTER_KEY`（每日備份）也是這把 | `openssl rand -hex 32 \| tr -d '\r\n' \| gcloud secrets versions add parse-server-master-key --data-file=-`（Windows 的 openssl 會帶 `\r`，一定要一起去掉）後重跑 `parse-server/scripts/deploy.sh`，中介層也要重新部署一次（環境變數形式的 secret 只在 revision 建立時解析），再 `gcloud secrets versions access latest --secret parse-server-master-key \| tr -d '\r\n' \| gh secret set PARSE_MASTER_KEY` |
| `parse-db-uri`（Firestore 連線字串，帳密 `parse-server`） | GCP Secret Manager | `gcloud firestore user-creds reset-password parse-server --database=tcross`，組成新連線字串（格式見 `parse-server/scripts/setup-gcp.sh`）加一版 secret，再重跑 `deploy.sh` |
| `tcross-middleware-sa` 服務帳戶 | GCP IAM，無 JSON 金鑰檔（用 IAM 自我模擬簽 URL，見 [server/README.md](server/README.md)） | 沒有金鑰檔案可外洩，不需要輪替；如需撤銷存取直接在 IAM 移除該服務帳戶權限 |

## 費用控制

2026-09-28 時 30 天僅約 73 個請求、GCS 1.57 MB，多在免費額度內；以下是防止用量變大後失控的設定。

- 帳單帳戶：專案目前掛在 `01B29E-2525AB-35A869`（hzm202202 的帳單帳戶，10-20 確認）。
- 每月預算警示：09-29 設在**舊帳單帳戶** `015911-92E019-179E03`，預算是跟著帳單帳戶走的，換帳戶後要在新帳戶重新設定（ROADMAP #18）。只寄信給帳單管理員、不會自動停用服務；`gcloud` 帳號 `tainanjade@gmail.com` 沒有帳單權限，專案也還沒啟用 Cloud Billing Budget API，要用有帳單權限的帳號在主控台設定。
- Cloud Run 按請求計費、最多 2 個 instance。
- Gemini 媒體解析度 `LOW`（token 約 1/4，09-29 實測辨識正常）；每筆工作最多 20 個素材。
- Session 驗證快取 60 秒（登出後 token 最多仍可用 60 秒）。
- Artifact Registry 只保留最新 3 份 image，其餘 7 天後刪除。
- 備份桶 Nearline、`parse/` 90 天刪除：一份約 216 MB，滿 90 份約 20 GB，每月約 US$0.2（附件變多會跟著增加）。
- GCS：建置用桶 30 天刪除；主桶 `activities/` 下的照片／影音等 AI 素材 30 天刪除，`.docx` 保留；活動附件在 `attachments/`，不受影響。30 天後舊的生成工作無法再「重新觸發」。
- 活動附件存 GCS 約 US$0.02／GB／月（50 GB 約 US$1），備份桶另有一份副本；Back4App 10/29 到期後降回免費方案（ROADMAP #9）。

## 帳號與帳單異動（換卡、換使用權人）

只改後台設定，不動程式碼與 `.env`。

- **GCP 換卡**：帳單 → 付款方式 → 新增卡片 → 設為預設 → 移除舊卡。
- **GCP 換人**：IAM → 新增成員並給角色 → 移除舊帳號。帳單帳戶的「帳單帳戶管理員」角色要另外設定。
- **Back4App 換卡**（Back4App 刪除前才需要）：Account Settings → Billing。
- **Back4App 換人**（同上）：App Settings → Collaborators → 邀請新 email 設 Admin → 移除舊帳號。付費方案換卡前確認不會中斷服務。
- 本機 `gcloud auth login` 若登入的是舊帳號，要改用新帳號重新登入。

**換正式網域時**：同步更新 Cloud Run `ALLOWED_ORIGIN` 與 Google Maps 金鑰的網域白名單。

## 已知限制

- **沒有 CI**：單元測試（前端 Vitest、Cloud Code、`server/` pytest）都要手動執行，見 [TESTING.md](TESTING.md)；每次部署後仍要手動跑健康檢查＋端點 curl（見上方）確認沒有回歸
- **Rate limit 是單 instance 記憶體內限流**：`server/main.py` 的 `enforce_rate_limit` 狀態不共享、重啟歸零，多 instance 情況下不是精確的硬上限，只拉高濫用門檻
- **npm `uuid` 中風險漏洞（接受風險）**：經 `exceljs` 引入，官方修法是降到 `exceljs@3.4.0`，不建議
- **備份不含 GCS 主桶**：AI 生成素材與 `.docx` 產出不在每日備份範圍（素材本來就 30 天刪除）；還原後帳號需重設密碼、`createdAt` 會變成還原時間（見「資料備份」）
- **正式網址**：`https://tacc-iip.web.app`（10-09 起，Firebase Hosting 網站 `tacc-iip`），尚未綁自訂網域。舊網址 `project-80ac5e1a-2ea4-4000-9ff.web.app` 是同專案的預設網站，10-16 起改為與新網址內容相同、同時部署（`firebase.json` 的第二個 hosting 設定與第一個相同，原本的 301 轉址會讓首頁 JS 被跨網域擋下而空白）。`ALLOWED_ORIGIN`、GCS 主桶 CORS、Maps 金鑰網站限制都同時列新舊兩組網域（Netlify 已於 09-29 停用並移除）

## 範本修改流程

大事紀 Excel／內政部結案 Word／簽到表／領據／活動紀錄表的產出邏輯全部在 `src/utils/download.ts`，用 `exceljs`（xlsx）與 `docx`（Word）組字串樣板，不是套現成的 Office 檔案模板。

**要改欄位、排版、抬頭文字**：

1. 找到對應的 `build*` 函式（例如大事紀是 `buildLedgerXlsx()`，內政部結案是 `buildNeimuReportDocx()`）
2. 改樣板內容（儲存格文字、欄寬、標題）
3. 本機 `npm run dev` 起服務，登入後到「匯出成果」頁面實際跑一次匯出，打開產出的 `.xlsx`/`.docx` 肉眼核對
4. 如果改動涉及圖片內嵌，參考 2026-09-04 驗證圖片內嵌排版的做法：在瀏覽器 devtools 攔截 `URL.createObjectURL()` 拿到匯出的 `Blob`，解壓內部 zip 比對圖片位元組是否跟原始檔案一致，比單純肉眼看排版更可靠

**要改欄位對照（資料模型新增/修改欄位）**：牽動 `src/types.ts`（型別定義）、`src/models/Activity.ts`（Parse 物件對應）、`cloud/main.js`（伺服器端驗證，改完跑 `parse-server/scripts/deploy.sh`）、Parse schema（`scripts/sync-schema.mjs --apply`）四處要一起改，任一處漏改都可能造成資料寫入失敗或驗證失效。

## 待補（組織面）

以下需要團隊自行補上，不是能從程式碼推導出來的：

- 事件通報流程／值班聯絡窗口
- 還原演練的定期排程（10-05 已演練一次；建議每季一次）
- 正式網域決定後，`ALLOWED_ORIGIN`／CORS／DNS 的變更負責人與流程
