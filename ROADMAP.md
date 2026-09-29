# ROADMAP

合照盟計畫資料整合平台的進度、待辦與部署紀錄。目標架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運步驟見 [OPERATIONS.md](OPERATIONS.md)。

> 最後查核：2026-09-29（對照程式碼、git、Netlify 線上 bundle、`gcloud` 線上設定）

---

## 目前狀態

- **程式碼**：`main`、`Donna`、`origin/main` 同一個 commit（`33e4057`，09-28），`Ching` 分支已合併。
- **前端（Firebase Hosting）**：`https://project-80ac5e1a-2ea4-4000-9ff.web.app`，09-29 從 Netlify 搬過來（含地址自動建議）。Netlify 已停用（09-29 起不再使用，網域已從 CORS 與 Maps 金鑰移除）。
- **後端（Cloud Run）**：`tcross-middleware` revision `00014-jjh`，`/status` 200。
- **資料庫（Back4App）**：`cloud/main.js` 最後一次貼回為 09-27。
- **AI 生成**：09-29 實測通過，約 30 秒產出 `.docx`，照片中的數字全部正確讀出。

## 待辦

| # | 項目 | 說明 |
| --- | --- | --- |
| 1 | 🟡 前端搬到 Firebase Hosting | ✅ 09-29 已部署（本機 `.env` 建置，已含 Maps 金鑰）、Cloud Run CORS 已加新網域。✅ Google Maps 金鑰網站限制已加 `web.app`／`firebaseapp.com`（API 限制 35 項未動）。✅ 09-29 瀏覽器實測：活動列表／詳細頁／照片載入、地址建議、子頁重新整理、從新網域呼叫 Cloud Run（CORS＋session 驗證）皆正常，主控台無錯誤。⬜ 實際上傳與 AI 生成（會寫資料、花 Gemini 費用）留待場域測試時一併跑。✅ `ALLOWED_ORIGIN`／Maps 金鑰已移除 Netlify 網域。⬜ 到 Netlify 刪除網站（避免 push 後還在建置）。✅ push 到 main 自動部署（GitHub Actions＋WIF），09-29 首次執行成功（run 36527531851，43 秒）。 |
| 2 | ⬜ `Autocomplete` 舊版警告 | 09-29 本機實測：輸入「台北車站」會正常出現 5 筆建議，目前**可用**。主控台仍警告 `google.maps.places.Autocomplete` 是舊版（Google 表示停用前至少提前 12 個月通知），之後有空再換成 `PlaceAutocompleteElement`，不急。 |
| 3 | 🟡 npm 漏洞 | ✅ 09-29 `npm audit fix`：`parse` 8.6.0→8.6.2、`ws` 8.20.0→8.21.3，**高風險已解**；建置通過，本機實測登入與讀取活動／計畫／操作紀錄正常。✅ 09-29 已隨 Firebase Hosting 首次部署上線；⬜ 還要 commit 推上 git。剩 `uuid`（中，經 `exceljs`）：官方修法是降到 `exceljs@3.4.0`，不建議，先接受風險。 |
| 4 | ✅ 預算警示 | 09-29 已在 Console 設定（帳單帳戶 `015911-92E019-179E03`）。只寄信通知、不會自動停用服務。`gcloud` 帳號 `tainanjade@gmail.com` 沒有帳單權限，無法用指令查看。 |
| 5 | 🟠 初始密碼 | 4 個新帳號初始密碼規則可猜，依決定暫不處理；建議請成員自行改密碼，或之後加首次登入強制改密碼。 |
| 6 | ⬜ 備份機制 | 訂 Back4App 資料備份頻率與還原演練（10/15 場域測試前）。 |
| 7 | ⬜ 匯出格式細節 | 拿實際範本核對抬頭／頁碼／編號。 |
| 8 | ⬜ OPERATIONS.md 組織面 | 值班窗口、備份排程、通報流程，待團隊補上。 |
| 9 | ⬜ PDF／Excel 輸出 | AI 報告目前只產 `.docx`。 |

## 時程（鍾雅婷負責項目）

| 里程碑 | 工作項目 | 狀態 |
| --- | --- | --- |
| 8/31 需求與欄位凍結 | 架構圖、GCP 部署、欄位對照表 | ✅ |
| 9/30 Demo | Excel／Word 匯出模組、API 規格、Gemini 呼叫規格 | ✅（匯出格式細節見待辦 7） |
| 10/15 場域測試 | 正式部署、備份機制、匯出格式修正 | 🟡 部署完成；備份、格式待辦 |
| 10/31 驗收交付 | 部署維運說明、範本修改流程 | 🟡 技術面完成（OPERATIONS.md）；組織面待補 |

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

09-29 用 `gcloud` 確認：`00012-6nc` 接 100% 流量，`maxScale=2`、`cpu-throttling=true`、`timeoutSeconds=900`、`GCP_LOCATION=asia-northeast1`、`ALLOWED_ORIGIN` 含 Netlify 網域。此版由 09-28 原始碼建置，`requirements.txt` 已是 `fastapi==0.141.1`，因此 Python 套件升級已在線上。

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
| npm 套件漏洞 | 🟡 高風險 `ws` 已修；剩 `uuid`（中）接受風險，見待辦 3 |
| 初始密碼可猜 | ⬜ 見待辦 5 |

已符合：Master Key 存 Secret Manager；Signed URL 15 分鐘效期；`.env` 未進 git；`objectPath` 防路徑穿越；前端無 `v-html`。

---

## 費用控制（09-28）

當時 30 天僅約 73 個請求、GCS 1.57 MB，多在免費額度內；以下是防止用量變大後失控。

- 每月預算警示（09-29 設定，寄信給帳單管理員）。
- Cloud Run 按請求計費、最多 2 個 instance。
- Gemini 媒體解析度 `LOW`（token 約 1/4，09-29 實測辨識正常）；每筆工作最多 20 個素材。
- Session 驗證快取 60 秒（登出後 token 最多仍可用 60 秒）。
- Artifact Registry 只保留最新 3 份 image，其餘 7 天後刪除。
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
