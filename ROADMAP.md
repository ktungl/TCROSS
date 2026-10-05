# ROADMAP

合照盟計畫資料整合平台的進度、待辦與部署紀錄。目標架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運步驟見 [OPERATIONS.md](OPERATIONS.md)。

> 最後查核：2026-10-05（對照 git、GitHub Actions 執行紀錄、線上回應標頭、`gcloud`）

---

## 目前狀態

- **程式碼**：`main`、`Donna` 與 origin 同步（10-05），`Ching` 分支已合併。
- **前端（Firebase Hosting）**：`https://project-80ac5e1a-2ea4-4000-9ff.web.app`。push 到 main 自動部署（GitHub Actions＋WIF），10-05 最近一次成功。Netlify 09-29 起停用。
- **後端（Cloud Run）**：`tcross-middleware` revision `00014-jjh`，`/status` 200。
- **資料庫（Back4App，Free 方案）**：`cloud/main.js` 最後一次貼回為 09-27。10-05 用量：請求 596／25K、檔案 275 MB／1 GB、資料庫 1.58 MB／0.25 GB；方案頁顯示「Valid until 10/29/2026」。
- **備份**：每天 02:00 自動備份到 GCS（保留 90 天），10-05 首次執行成功並完成還原演練。
- **AI 生成**：09-29 實測通過，約 30 秒產出 `.docx`，照片中的數字全部正確讀出。

## 待辦

依截止時間排序。

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 1 | ⬜ 匯出格式細節 | 10/15 | 拿實際範本核對抬頭／頁碼／編號。 |
| 2 | ⬜ 實際上傳＋AI 生成實測 | 10/15 | 會寫資料、花 Gemini 費用，在 Firebase Hosting 正式網址上跑一次，排在場域測試時。 |
| 11 | 🟠 Back4App 檔案空間 | 10/15 前決定 | Free 方案檔案上限 1 GB，10-05 已用 275 MB（27%）。照片一張約 3 MB，再約 250 張就滿；場域測試照片多，滿了會無法上傳。選項：升級 MVP（US$25／月，50 GB，含每日備份），或上傳前壓縮照片。 |
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
| 10/15 場域測試 | 正式部署、備份機制、匯出格式修正 | 🟡 部署、備份（每日＋還原演練）完成；待辦 1、2、4、11 |
| 10/31 驗收交付 | 部署維運說明、範本修改流程 | 🟡 技術面完成（OPERATIONS.md）；組織面見待辦 6 |

**分工**：鍾雅婷（Donna）——架構、部署、匯出引擎、API 規格；劉冠彤——前端表單與介面；陳怡靜——資料模型、後端 CRUD、帳號權限。

---

## 系統架構

```
瀏覽器（Vue，Firebase Hosting）
 ├─ 一般資料與附件 → Back4App（Parse，含 Parse Files）
 └─ AI 生成素材   → Cloud Run 取 Signed URL → 直傳 GCS
                   → POST /generate/{jobId} → Gemini 分析 → 產 .docx 存 GCS → 寫回 GenerationJob
```

| 元件 | 位置 | 重點 |
| --- | --- | --- |
| Cloud Run `tcross-middleware` | `asia-east1` | FastAPI；唯一持有 GCP 憑證與 Parse Master Key（Secret Manager）的地方 |
| Gemini | Vertex AI `asia-northeast1`，`gemini-2.5-flash` | 素材以 `gs://` 直接餵入；`response_schema` 回傳摘要／重點／KPI |
| GCS 主桶 | `tcross-2026-…` | 只放 AI 生成素材與產出（路徑 `activities/{id}/…`）；一般附件在 Back4App |
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
| **`00014-jjh`**（線上） | 09-29 | `ALLOWED_ORIGIN` 移除 Netlify 網域 |

`00013`／`00014` 只改 `ALLOWED_ORIGIN`，其餘設定沿用 `00012-6nc`：`maxScale=2`、`cpu-throttling=true`、`timeoutSeconds=900`、`GCP_LOCATION=asia-northeast1`。映像檔由 09-28 原始碼建置，`requirements.txt` 已是 `fastapi==0.141.1`，因此 Python 套件升級已在線上。

### `cloud/main.js`（需手動貼到 Back4App Cloud Code Dashboard）

程式碼改了**不代表**線上生效，每次貼回請在下表記一筆。

| 日期 | 內容 | 驗證 |
| --- | --- | --- |
| 09-04 | 需求訪談欄位驗證、`GenerationJob` 檢查 | REST 實測 4 筆畸形資料被擋 |
| 09-27 | 角色分級、`AuditLog`、上傳大小檢查、Category `beforeSave` | REST 實測 15 項通過 |

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
