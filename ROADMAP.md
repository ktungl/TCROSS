# GCP 整合規劃

這份文件記錄「導入 GCP」後，現況與目標架構之間的落差，以及規劃的實作階段。細節會隨著實作進度更新；GCP 的目標架構說明本身在 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)。

## 目前進度（2026-08-20，Gemini 串接暫緩，先補齊其他缺口）

| 階段 | 狀態 | 說明 |
| --- | --- | --- |
| Phase 0 — Parse 使用者驗證/ACL | ✅ 完成 | 登入頁、路由守衛、`Plan`/`Activity`/`GenerationJob` 的 Class-Level Permissions 都已設定為 requiresAuthentication 並驗證生效，匿名 REST 請求會被擋。 |
| 附帶項目 — 模板真格式 | ✅ 完成 | 簽到表/活動紀錄表改 `.xlsx`（exceljs），領據/成果報告草稿改 `.docx`（docx），CSV 匯出維持不動。 |
| 附帶項目 — Cloud Code 伺服器端驗證 | ✅ **已部署並驗證生效** | `cloud/main.js`（含 2026-08-20 補上的 `GenerationJob` `activity` 必填檢查與 `resultFile`/`errorMessage` 型別檢查）已由使用者貼回 Back4App Cloud Code Dashboard 並部署——Back4App 伺服器日誌確認 `main.js` 已載入。已用 REST API（Master Key）實測 4 筆畸形資料（空 `Activity.name`、錯誤日期格式、空白 `Plan.name`、缺 `GenerationJob.activity`）全部正確被 `beforeSave` 擋下。與 GCP 無關（Back4App 自己的功能）。 |
| Phase 1 — Cloud Run 中介層 | ✅ **已部署（含今天新增的 `/delete-objects`）** | GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`（Tcross，billing 已啟用），服務 `tcross-middleware` 跑在 `asia-east1`。2026-08-20 上午用 `gcloud run deploy` 部署 `/download-url`（revision `tcross-middleware-00004-zdh`）。2026-08-20 下午（架構健檢後）新增 `POST /delete-objects`（`GenerationJob` 刪除時清 GCS 檔案用）並把三個端點的登入驗證改成共用 `Depends()`，已再次 `gcloud run deploy`（revision `tcross-middleware-00005-nmb`），`GET /status` 與新路由都已在線上確認。環境變數/secrets/服務帳戶皆沿用原設定未變動。 |
| Phase 2 — `GenerationJob` 資料模型 | ✅ 完成 | Parse class 已建立，前端型別/model 在 `src/types.ts`/`src/models/GenerationJob.ts`。 |
| Phase 3a — 前端串接（上傳/建立 job/輪詢/下載） | ✅ **已完成並上線** | `AiGenerationModal.vue`（掛在 `DetailView.vue`）支援選檔 → 呼叫 `/signed-url` → 直傳 GCS → 建立 `GenerationJob` → 每 5 秒輪詢（`useGenerationJobPolling.ts`）→ `status === 'done'` 時可下載（呼叫已上線的 `/download-url`）。UI 上明白標註「目前尚未接上自動生成後端」。 |
| Phase 3b — Cloud Run 端 Gemini 生成 | ⬜ **未開始（暫緩，等使用者確認再做）** | `server/main.py` 沒有任何程式碼呼叫 Gemini 或組裝 PDF/Word/Excel；`write_with_master_key()` 已寫好但沒有端點在用。`requirements.txt` 也還沒有 Gemini SDK 或文件組裝套件。GCP 專案的 Vertex AI API（`aiplatform.googleapis.com`）也還沒啟用。**這是目前唯一還沒做的功能性缺口**，但依使用者指示暫緩，先不動。 |

**下一步（依使用者指示，Gemini 部分先擱置）**：

1. Cloud Run 的 `ALLOWED_ORIGIN` 目前只設了 `http://localhost:5173`（本機開發網域）——前端還沒有正式上線網域，等有了正式網域再回來更新這個環境變數，否則瀏覽器 CORS 會擋掉正式環境的請求。這項目前卡在「還沒決定/取得正式網域」，不是程式碼問題。
2. **Phase 3b（Cloud Run 接 Gemini + 組裝真正檔案）**——使用者已表示先不要串 AI，待之後回來做時再展開：啟用 Vertex AI API、`requirements.txt` 加 Gemini SDK + 文件組裝套件、決定觸發方式（建議前端呼叫新端點觸發，而非 EventArc）、實作「讀 GCS 素材 → 呼叫 Gemini → 組裝 PDF/Word/Excel → 寫回 GCS → `write_with_master_key()` 回寫 Parse」的處理邏輯。

這兩項是目前整條 GCP 主線唯一剩下的工作，其餘（Phase 0/1/2/3a、附帶項目）都已完成、部署並實測驗證過。

## 背景：現況與目標架構的落差（2026-08-12 盤點，僅供歷史對照）

README 裡規劃的「語音/影片/圖片/文字 → Gemini 分析 → Cloud Run 組裝 PDF/Word/Excel」在盤點當下**完全還沒實作**。現有系統是純前端 SPA，直接用瀏覽器端的 Parse SDK 讀寫 Back4App，沒有任何後端、沒有 GCS、沒有 Gemini：

- **檔案上傳**：`src/stores/db.ts` 的 `uploadFiles()` 用 `Parse.File` 直接把照片/錄音/影片/文件傳進 Back4App，存成 `Activity.photoFiles` 等欄位裡的 `{name,size,url}` 陣列。
- **文件生成**：`src/views/ExportView.vue`、`src/components/GeneratedDocModal.vue`、`src/utils/download.ts` 全部是同步、純前端的字串樣板，填入使用者手動輸入的 `summary`/`kpis`，輸出 `.html`（改副檔名，不是真正的 docx/xlsx/pdf 格式），沒有 AI 涉入。
- **沒有後端**：沒有 Cloud Code、沒有任何伺服器，瀏覽器直接帶 App ID + JS Key 打 Parse（見 [[tech_stack]] / [[parse_schema]] 記憶）。
- **沒有 auth/ACL**：任何拿到前端 bundle 的人都能讀寫全部資料。

這個落差代表：README 裡的 GCP 架構是**全新能力**，不是取代現有功能。現有的「簽到表/領據」這種空白表單套版本質上不需要 AI（欄位都是使用者自己填的），不需要繞去 Cloud Run + Gemini。

> 上面盤點的落差目前只剩 Phase 3b（Gemini 分析 + 真正檔案組裝，依使用者指示暫緩）還沒補上，其餘都已解決或程式碼已寫好待部署，狀態以上方「目前進度」表為準。

## 規劃階段（原始規劃內容，執行細節/狀態以上方表格與「下一步」為準）

### Phase 0 — 安全前提（阻塞項，必須先做）✅ 已完成

在接上任何會計費的 GCP 資源之前，先補上 Parse 使用者驗證（Parse User + ACL）。現在任何人都能打 Back4App 已經是風險，一旦接上 Gemini/GCS，沒有驗證等於任何人都能用專案的額度狂發 AI 請求或狂傳檔案，帳單風險完全不同等級。這件事排在 GCP 整合之前，不是之後。

### Phase 1 — 建立可信的後端邊界 ✅ 已部署

現在前端直接握有 Parse App ID/JS Key 已經是妥協，但如果讓前端直接拿 GCP service account 或直接呼叫 Vertex AI，風險更高。加一個單一的 Cloud Run 服務當「可信中介層」：

- 前端向 Cloud Run 要 GCS Signed URL（不是直接把憑證給前端）。
- Cloud Run 是唯一持有 GCP 服務帳戶金鑰的地方。
- Cloud Run 用 Parse **Master Key**（絕不進前端 bundle）把生成結果寫回 Parse，不透過 Cloud Code webhook 的複雜度。

### Phase 2 — 資料模型異動 ✅ 已完成

新增一個 `GenerationJob` Parse class，而不是硬塞進 `Activity` 現有欄位：

- `activity`（指標）、`kind`（成果報告/其他）、`status`（pending/processing/done/error）
- `sourceFiles`（GCS 路徑，語音/影片/圖片/文字輸入）
- `resultFile`（GCS 路徑，Gemini 分析後由 Cloud Run 組出的真正 PDF/Word/Excel）

「使用者上傳原始素材 → AI 生成」跟現有的 `photoFiles`/`audioFiles`（單純附件保存）分開，不會互相污染；`Activity.summary`/`kpis` 可以選擇性地被生成結果回填，但保留使用者手動編輯的權利。

### Phase 3 — 前端串接方式 🟡 前端（3a）已完成並上線，後端 Gemini 生成（3b）暫緩

新增一個「AI 自動生成成果報告」的入口（`DetailView.vue` 已加上按鈕開啟 `AiGenerationModal.vue`），流程：

1. ✅ 上傳素材（語音/影片/圖片/文字）→ 建立 `GenerationJob`
2. ✅ 前端輪詢 job 狀態（`useGenerationJobPolling.ts`，5 秒一次；目前 Back4App 方案未用 LiveQuery）
3. ✅ 完成後提供真正檔案下載——前端下載按鈕、Cloud Run 的 `/download-url` 簽名下載網址端點都已部署上線並實測通過；但 Cloud Run 那端還是沒有任何程式碼會真的把 `status` 更新成 `done` 或產生 `resultFile`（那是 Phase 3b，暫緩）

**現有的簽到表/領據/CSV 匯出保持純前端不動**，不需要牽動 GCP。

### 附帶項目：模板輸出格式修正（與 GCP 無關）✅ 已完成

既然確認輸出格式要是「真正的」PDF/Word/Excel，現有 `downloadFile()` 原本產生的其實是改副檔名的 HTML，不是真正格式。已用前端函式庫（`docx`、`exceljs`）把簽到表/領據這幾個模板升級成真格式，不需要等後端。

## 建議優先序（依目前進度更新）

1. ~~Parse 使用者驗證/ACL（阻塞項）~~ ✅ 已完成
2. ~~前端模板改成真正 docx/xlsx/pdf 格式~~ ✅ 已完成
3. ~~Cloud Run 中介層 + GCS signed URL（GCP 整合的地基）~~ ✅ 已部署並驗證（含 `/download-url`）
4. ~~Phase 3a 前端串接（上傳/建立 job/輪詢/下載）~~ ✅ 已完成並上線
5. ~~`cloud/main.js` 部署到 Back4App~~ ✅ 使用者已部署並經 curl 實測驗證生效
6. **Phase 3b：Cloud Run 加 Gemini 呼叫 + 文件組裝 + 寫回 Parse（核心新功能）**——依使用者指示暫緩，之後再回來做時見上方「下一步」第 3 項的子項清單。

第 1–5 項都已完成並有實際驗證（GCP 專案存在、Cloud Run 服務健康檢查通過、`/download-url` 線上實測通過、前端 UI 已能建立/輪詢/下載 job、Back4App Cloud Code 已部署）；第 6 項是目前唯一還沒動的功能性缺口，先擱置。
