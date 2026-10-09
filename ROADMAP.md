# ROADMAP

合照盟計畫資料整合平台的進度、待辦與部署紀錄。目標架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運步驟見 [OPERATIONS.md](OPERATIONS.md)。

> 最後查核：2026-10-09（對照 git、GitHub Actions 執行紀錄、線上回應標頭、`gcloud`）

---

## 目前狀態

- **程式碼**：`main`、`Donna` 與 origin 同步（10-05），`Ching` 分支已合併。
- **前端（Firebase Hosting）**：`https://tacc-iip.web.app`（10-09 起；舊網址 `project-80ac5e1a-2ea4-4000-9ff.web.app` 301 轉址過來）。push 到 main 自動部署（GitHub Actions＋WIF）。Netlify 09-29 起停用。
- **後端（Cloud Run）**：`tcross-middleware` revision `00018-p22`（10-09），`/status` 200。
- **資料庫（Back4App，Free 方案）**：`cloud/main.js` 最後一次貼回為 10-09。10-05 用量：請求 596／25K、檔案 275 MB／1 GB、資料庫 1.58 MB／0.25 GB；方案頁顯示「Valid until 10/29/2026」。
- **備份**：每天 02:00 自動備份到 GCS（保留 90 天），10-05 首次執行成功並完成還原演練。
- **AI 生成**：09-29 實測通過，約 30 秒產出 `.docx`，照片中的數字全部正確讀出。

## 待辦

依截止時間排序。

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 1 | ⬜ 匯出格式細節 | 10/15 | 拿實際範本核對抬頭／頁碼／編號。 |
| 2 | ⬜ 實際上傳＋AI 生成實測 | 10/15 | 會寫資料、花 Gemini 費用，在 Firebase Hosting 正式網址上跑一次，排在場域測試時。 |
| 11 | 🟡 附件搬到 GCS | 10/9 上線 | ✅ 10-09 上線並完成搬遷：Cloud Run `00017-p9d`、Cloud Code 貼回、主桶 CORS／每日附件備份設定完成；119 個附件（13 筆活動）改指 GCS，核對剩餘舊網址 0、上傳者／時間／圖說變動 0。✅ 10-09 正式站實測：詳細頁 25 張、歷史檔案 18 張 GCS 照片全部載入；「手機測試」上傳報名表 CSV＋照片，資料庫存 `gcs:attachments/…`、GCS 有實體檔；頁面內 `fetch` 讀 GCS 照片 200 且大小一致（匯出嵌入照片的路徑），主控台 0 錯誤。⬜ 實際下載匯出檔核對照片、團隊實測（10/10～10/14）；⬜ 場域測試後清除 Back4App 原檔。方案見下方「附件搬到 GCS」。 |
| 4 | ⬜ 刪除 Netlify 網站 | 10/15 | Netlify 已停用，到後台刪除網站，避免 push 後還在建置。 |
| 5 | 🟡 CSP 改正式 | 待辦 2 之後 | ✅ 10-05 正式站瀏覽 6 個主要頁面、活動詳細頁（13 張照片全部載入）、地址建議（5 筆），0 個違規（偵測方式以故意送出的白名單外請求驗證過有效）。⬜ 還沒測上傳與 AI 生成／下載，等待辦 2 跑過也沒違規，再把 `firebase.json` 改成正式 `Content-Security-Policy`。 |
| 6 | ⬜ OPERATIONS.md 組織面 | 10/31 | 值班窗口、通報流程、還原演練週期（建議每季），待團隊補上。 |
| 7 | 🟠 初始密碼可猜 | — | 4 個新帳號初始密碼規則可猜，依決定暫不處理；建議請成員自行改密碼，或之後加首次登入強制改密碼。 |
| 8 | ⬜ PDF／Excel 輸出 | — | AI 報告目前只產 `.docx`。 |
| 9 | ⬜ `Autocomplete` 換新版 | — | 目前可用；主控台警告 `google.maps.places.Autocomplete` 是舊版（Google 停用前至少提前 12 個月通知），之後換成 `PlaceAutocompleteElement`。 |
| 10 | ⬜ 刪除 `B4aVehicle` | — | Back4App 建 app 時附的範例 class（1 筆），與本專案無關，可在後台刪除。 |
| 12 | ⬜ Back4App 擁有者帳號開 MFA | — | Back4App 後台安全建議：擁有者帳號未啟用兩步驟驗證。 |

**接受風險**：npm `uuid`（中，經 `exceljs`），官方修法是降到 `exceljs@3.4.0`，不建議。

## 已完成（近期）

| 日期 | 項目 | 重點 |
| --- | --- | --- |
| 10-09 | 正式網址改為 `tacc-iip.web.app` | 新增 Hosting 網站 `tacc-iip`，舊網址 301 轉址；Cloud Run `ALLOWED_ORIGIN`（`00018-p22`）、GCS 主桶 CORS、Maps 金鑰網站限制加入新網域。 |
| 10-05 | 備份機制 | `scripts/backup-parse.mjs` 匯出全部 class／schema／角色成員／附件；GitHub Actions 每天 02:00 上傳 `gs://…-backup/parse/`（Nearline、90 天、`github-backup` 只能新增不能刪）。 |
| 10-05 | 確認 Back4App 內建備份 | Free 方案沒有自動備份（MVP 以上才有每日備份），目前每日 GCS 備份是唯一一份。 |
| 10-05 | 還原演練 | `scripts/restore-parse.mjs` 還原到測試 app `TCROSS-restore-test`：筆數與角色成員一致、2058 個欄位 0 差異、86 個附件全部可開啟。步驟見 OPERATIONS.md「資料備份」。 |
| 10-01 | HTTP 安全標頭 | `X-Frame-Options`／`nosniff`／`Referrer-Policy`／`Permissions-Policy` 上線，CSP 先 Report-Only（待辦 5）。 |
| 09-29 | 前端搬到 Firebase Hosting | 瀏覽器實測活動列表／詳細頁／照片、地址建議、子頁重新整理、呼叫 Cloud Run 皆正常；CORS 與 Maps 金鑰已換成新網域、移除 Netlify；push 到 main 自動部署。 |
| 09-29 | npm 高風險漏洞 | `parse` 8.6.2、`ws` 8.21.3，已上線並 commit（`201fc0a`）。 |
| 09-29 | 預算警示 | Console 設定（帳單帳戶 `015911-92E019-179E03`），只寄信、不會自動停用服務。`gcloud` 帳號 `tainanjade@gmail.com` 沒有帳單權限。 |

## 時程（鍾雅婷負責項目）

| 里程碑 | 工作項目 | 狀態 |
| --- | --- | --- |
| 8/31 需求與欄位凍結 | 架構圖、GCP 部署、欄位對照表 | ✅ |
| 9/30 Demo | Excel／Word 匯出模組、API 規格、Gemini 呼叫規格 | ✅（匯出格式細節見待辦 1） |
| 10/15 場域測試 | 正式部署、備份機制、匯出格式修正 | 🟡 部署、備份（每日＋還原演練）、附件搬到 GCS（10-09）完成；待辦 1、2、4，待辦 11 收尾 |
| 10/31 驗收交付 | 部署維運說明、範本修改流程 | 🟡 技術面完成（OPERATIONS.md）；組織面見待辦 6 |

**分工**：鍾雅婷（Donna）——架構、部署、匯出引擎、API 規格；劉冠彤——前端表單與介面；陳怡靜——資料模型、後端 CRUD、帳號權限。

---

## 附件搬到 GCS（10-05 規劃，10-09 上線）

**現況**：活動附件（8 類，10-05 共 86 個、219 MB，其中照片 70）用 Parse 上傳到 Back4App，`FileMeta.url` 是 `parsefiles.back4app.com` 的公開網址（不用登入、知道網址就能看）。GCS 目前只放 AI 生成素材。

**做法**
- **存放**：GCS 主桶 `attachments/{activityId}/{附件分類}/{8 碼亂數}_{檔名}`。刻意不用 `activities/`（該路徑照片／影音 30 天自動刪除）。
- **欄位**：`FileMeta.url` 改存 `gcs:attachments/...`。Cloud Code 的欄位驗證、上傳者／刪除者標記、稽核比對都以 url 字串為識別，邏輯不用改；舊的 Back4App 網址照常顯示，新舊並存。
- **Cloud Run 新端點**：
  - 附件上傳網址：簽 PUT 網址，加 `x-goog-content-length-range` 由 GCS 實際擋 50 MB（目前大小只靠前端與 Cloud Code 檢查宣告值）。
  - 批次檢視網址：一次換多張的 15 分鐘 GET 網址，需登入且具 `member`／`developer` 角色。照片從公開網址改成需登入，較安全。
- **前端**：上傳改走 GCS；`DetailView`、`HistoryFilesView`、`HistoryFilePickerModal`、匯出（`download.ts` 嵌入照片）先換臨時網址再用，前端快取約 12 分鐘。
- **永久刪除**：刪 GCS 物件前先確認沒有其他活動還引用同一檔案。順帶修正既有問題：「歷史檔案」可把同一檔案掛到多個活動，目前從其中一個永久刪除時 Cloud Code `afterSave` 會刪掉實體檔，另一個活動的檔案跟著失效。
- **Cloud Code**：`afterSave` 跳過 `gcs:` 開頭的網址；搬遷用 Master Key 加 `context` 旗標寫入時，保留原上傳者／時間、不刪 Back4App 原檔、稽核只記一筆摘要。
- **搬遷既有檔案**：腳本把 86 個檔案複製到 GCS 並改寫 url。**Back4App 原檔先保留**，場域測試結束確認無誤再清除；搬遷前先跑一次完整備份。
- **備份**：Storage Transfer Service 每日把 `attachments/` 增量複製到備份桶（不同步刪除）；備份桶 90 天刪除規則改為只套用 `parse/`。`restore-parse.mjs` 改為能處理 `gcs:` 附件。
- **其他**：主桶 CORS 加 GET 與正式網域（匯出時用 `fetch` 讀照片；目前 `server/cors.json` 只有 PUT 與 localhost／範例網域，要核對線上設定）；CSP 已含 `storage.googleapis.com`，不用改。

**時程**：工作量約 3～4 天。10/9 前上線並完成搬遷，10/10～10/14 團隊實測，趕在 10/15 場域測試前。

**上線項目**：Cloud Run（`gcloud` 部署）、前端（push main 自動部署）、Cloud Code（手動貼到 Back4App Dashboard，記入下方部署紀錄）。

**退路**：新舊網址並存、Back4App 原檔保留，GCS 出問題時退回前一版前端即可。

**費用**：GCS 約 US$0.02／GB／月（50 GB 約 US$1）；Back4App 維持 Free。

**之後（10/31 驗收後再評估）**：資料庫也搬到 GCP——Cloud Run 自架 Parse Server＋MongoDB（Atlas 可經 GCP Marketplace 計費；或試 Firestore MongoDB 相容模式），前端與 `cloud/main.js` 幾乎不用改，估 7～9 個工作天。注意 Back4App Free 不會給密碼雜湊，除非客服能匯出完整資料庫，否則帳號要重設密碼。

---

## 系統架構

```
瀏覽器（Vue，Firebase Hosting）
 ├─ 一般資料       → Back4App（Parse）
 ├─ 活動附件       → Cloud Run 取 Signed URL → 直傳 GCS（`gcs:attachments/…`，檢視時換 15 分鐘臨時網址）
 └─ AI 生成素材   → Cloud Run 取 Signed URL → 直傳 GCS
                   → POST /generate/{jobId} → Gemini 分析 → 產 .docx 存 GCS → 寫回 GenerationJob
```

| 元件 | 位置 | 重點 |
| --- | --- | --- |
| Cloud Run `tcross-middleware` | `asia-east1` | FastAPI；唯一持有 GCP 憑證與 Parse Master Key（Secret Manager）的地方 |
| Gemini | Vertex AI `asia-northeast1`，`gemini-2.5-flash` | 素材以 `gs://` 直接餵入；`response_schema` 回傳摘要／重點／KPI |
| GCS 主桶 | `tcross-2026-…` | AI 生成素材與產出（`activities/{id}/…`）、活動附件（`attachments/{id}/{分類}/…`，每日增量備份到備份桶） |
| GCS 備份桶 | `project-80ac5e1a-2ea4-4000-9ff-backup` | Back4App 每日備份（`parse/*.tar.gz`），GitHub Actions 上傳 |
| `GenerationJob`（Parse class） | Back4App | `status`：pending → processing → done／error |

**設計決策**
- **觸發方式**：前端呼叫 `/generate`，不用 GCS EventArc（多檔上傳沒有「全部傳完」的訊號），也不用 Parse `afterSave`（會讓 Back4App 持有 GCP 憑證，且執行時間限制太緊）。
- **同步執行**：`/generate` 在請求內做完（逾時 900 秒），Cloud Run 按請求計費。沒有佇列，instance 中途被砍時 job 會停在 processing，20 分鐘後前端可「重新觸發」。
- **分類存純文字**：活動的分類存文字而非 id，改名／刪除分類不影響既有活動。分類管理在「計畫與分類管理」頁的分頁。

---

## 部署紀錄

### Cloud Run

| Revision | 日期 | 內容 |
| --- | --- | --- |
| `00004`～`00006` | 09-04 前後 | `/download-url`、`/delete-objects`、物件層級授權 |
| `00007`／`00008` | 09-04 | Python 套件漏洞、稽核 log、rate limit、非 root |
| `00010-d9z` | 09-17 | `ALLOWED_ORIGIN` 加入 Netlify 網域 |
| `00011-hdv` | 09-17 | Phase 3b：`/generate`、Gemini |
| `00012-6nc` | 09-28 | 省費用：同步生成、按請求計費、`max-instances` 2、`timeout` 900、Gemini 改 `asia-northeast1` |
| `00013-p4g` | 09-29 | `ALLOWED_ORIGIN` 加入 Firebase Hosting 網域（`web.app`／`firebaseapp.com`） |
| `00014-jjh` | 09-29 | `ALLOWED_ORIGIN` 移除 Netlify 網域 |
| `00015-m96` | 10-05 | `/generate` 限制來源檔須在該活動資料夾下等安全修正（另一台電腦部署） |
| `00016-pv2` | 10-09 | `/attachments/upload-urls`、`/view-urls`、`/delete`（附件搬到 GCS） |
| `00017-p9d` | 10-09 | 附件分類補上「參與者名單（報名表）」（`registration`） |
| **`00018-p22`**（線上） | 10-09 | `ALLOWED_ORIGIN` 加入 `tacc-iip.web.app`／`tacc-iip.firebaseapp.com` |

`00013`／`00014` 只改 `ALLOWED_ORIGIN`，其餘設定沿用 `00012-6nc`：`maxScale=2`、`cpu-throttling=true`、`timeoutSeconds=900`、`GCP_LOCATION=asia-northeast1`。映像檔由 09-28 原始碼建置，`requirements.txt` 已是 `fastapi==0.141.1`，因此 Python 套件升級已在線上。

### `cloud/main.js`（需手動貼到 Back4App Cloud Code Dashboard）

程式碼改了**不代表**線上生效，每次貼回請在下表記一筆。

| 日期 | 內容 | 驗證 |
| --- | --- | --- |
| 09-04 | 需求訪談欄位驗證、`GenerationJob` 檢查 | REST 實測 4 筆畸形資料被擋 |
| 09-27 | 角色分級、`AuditLog`、上傳大小檢查、Category `beforeSave` | REST 實測 15 項通過 |
| 10-09 | 附件網址接受 `gcs:attachments/`、搬遷 context、共用檔案不誤刪、錯誤訊息改中文欄位名 | 搬遷腳本寫回 13 筆活動成功（舊版會回「必須是 http(s) 網址」）；System Logs 有重啟紀錄 |

---

## 資安（ISO 27001 Annex A 技術面）

只涵蓋程式碼可驗證的部分；風險評估、資產清冊、供應商 DPA 等組織面文件不在範圍內。

| 風險 | 狀態 |
| --- | --- |
| Cloud Run 物件層級授權 | ✅ 依呼叫者 session 查活動／job 權限 |
| Parse CLP 角色分級 | ✅ 09-27：只開放 `member`／`developer`；`AuditLog` 唯讀；`_Role`、公開註冊已關閉；建立／修改者由伺服器寫入 |
| 上傳型別／大小限制 | ✅ 前端、Cloud Run、Cloud Code 三層（50MB、副檔名黑名單） |
| 稽核紀錄 | ✅ Cloud Run `audit_log`＋Parse `AuditLog` |
| CORS | ✅ 未設 `ALLOWED_ORIGIN` 直接啟動失敗 |
| 容器 root | ✅ `USER appuser` |
| 速率限制 | ✅ 每人每分鐘 30 次（記憶體內，多 instance 非精確上限） |
| Python 套件漏洞 | ✅ 已上線（見部署紀錄） |
| npm 套件漏洞 | 🟡 高風險 `ws` 已修；剩 `uuid`（中）接受風險 |
| 初始密碼可猜 | ⬜ 見待辦 7 |
| HTTP 安全標頭 | 🟡 10-01 上線 `X-Frame-Options`／`nosniff`／`Referrer-Policy`／`Permissions-Policy`（HSTS 由 Firebase 預設提供），10-05 確認線上生效；CSP 仍是 Report-Only，見待辦 5 |
| 資料備份 | ✅ 每日備份到獨立 GCS 桶，上傳帳號不能刪改既有備份；10-05 還原演練通過 |

已符合：Master Key 存 Secret Manager；Signed URL 15 分鐘效期；`.env` 未進 git；`objectPath` 防路徑穿越；前端無 `v-html`。

---

## 費用控制（09-28）

當時 30 天僅約 73 個請求、GCS 1.57 MB，多在免費額度內；以下是防止用量變大後失控。

- 每月預算警示（09-29 設定，寄信給帳單管理員）。
- Cloud Run 按請求計費、最多 2 個 instance。
- Gemini 媒體解析度 `LOW`（token 約 1/4，09-29 實測辨識正常）；每筆工作最多 20 個素材。
- Session 驗證快取 60 秒（登出後 token 最多仍可用 60 秒）。
- Artifact Registry 只保留最新 3 份 image，其餘 7 天後刪除。
- 備份桶 Nearline、90 天刪除：一份約 216 MB，滿 90 份約 20 GB，每月約 US$0.2（附件變多會跟著增加）。
- GCS：建置用桶 30 天刪除；主桶 `activities/` 下的照片／影音等素材 30 天刪除，`.docx` 保留。一般附件在 Back4App，不受影響；但 30 天後舊的生成工作無法再「重新觸發」。

---

## 帳號與帳單異動（換卡、換使用權人）

只改後台設定，不動程式碼與 `.env`。

- **GCP 換卡**：帳單 → 付款方式 → 新增卡片 → 設為預設 → 移除舊卡。
- **GCP 換人**：IAM → 新增成員並給角色 → 移除舊帳號。帳單帳戶的「帳單帳戶管理員」角色要另外設定。
- **Back4App 換卡**：Account Settings → Billing。
- **Back4App 換人**：App Settings → Collaborators → 邀請新 email 設 Admin → 移除舊帳號。付費方案換卡前確認不會中斷服務。
- 本機 `gcloud auth login` 若登入的是舊帳號，要改用新帳號重新登入。

**換正式網域時**：同步更新 Cloud Run `ALLOWED_ORIGIN` 與 Google Maps 金鑰的網域白名單。
