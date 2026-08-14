# GCP 整合規劃

這份文件記錄「導入 GCP」後，現況與目標架構之間的落差，以及規劃的實作階段。細節會隨著實作進度更新；GCP 的目標架構說明本身在 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)。

## 進度更新（2026-08-14）

- ✅ **Phase 0（Parse 使用者驗證/ACL）**：登入頁、路由守衛、`Plan`/`Activity`/`GenerationJob` 的 Class-Level Permissions 都已設定為 requiresAuthentication 並驗證生效，匿名 REST 請求會被擋。
- ✅ **附帶項目（模板真格式）**：簽到表/活動紀錄表改 `.xlsx`（exceljs），領據/成果報告草稿改 `.docx`（docx），CSV 匯出維持不動。
- 🟡 **Phase 1（Cloud Run 中介層）**：`server/` 目錄已寫好 signed URL 中介層程式碼（見 `server/README.md`），**尚未部署**——需要一個實際的 GCP 專案才能繼續。
- ✅ **Phase 2（`GenerationJob` 資料模型）**：Parse class 已建立（`activity`/`kind`/`status`/`sourceFiles`/`resultFile`/`errorMessage`），前端對應型別與 model 在 `src/types.ts`/`src/models/GenerationJob.ts`。**只有資料模型，沒有任何 store/UI 在用它**——建立/輪詢/顯示 job 的邏輯要等 Phase 3。
- ⬜ **Phase 3（前端串接）+ Gemini 串接**：都還沒開始，卡在需要先有 GCP 專案把 Phase 1 部署起來。

## 現況盤點（2026-08-12）

README 裡規劃的「語音/影片/圖片/文字 → Gemini 分析 → Cloud Run 組裝 PDF/Word/Excel」目前**完全還沒實作**。現有系統是純前端 SPA，直接用瀏覽器端的 Parse SDK 讀寫 Back4App，沒有任何後端、沒有 GCS、沒有 Gemini：

- **檔案上傳**：`src/stores/db.ts` 的 `uploadFiles()` 用 `Parse.File` 直接把照片/錄音/影片/文件傳進 Back4App，存成 `Activity.photoFiles` 等欄位裡的 `{name,size,url}` 陣列。
- **文件生成**：`src/views/ExportView.vue`、`src/components/GeneratedDocModal.vue`、`src/utils/download.ts` 全部是同步、純前端的字串樣板，填入使用者手動輸入的 `summary`/`kpis`，輸出 `.html`（改副檔名，不是真正的 docx/xlsx/pdf 格式），沒有 AI 涉入。
- **沒有後端**：沒有 Cloud Code、沒有任何伺服器，瀏覽器直接帶 App ID + JS Key 打 Parse（見 [[tech_stack]] / [[parse_schema]] 記憶）。
- **沒有 auth/ACL**：任何拿到前端 bundle 的人都能讀寫全部資料。

這個落差代表：README 裡的 GCP 架構是**全新能力**，不是取代現有功能。現有的「簽到表/領據」這種空白表單套版本質上不需要 AI（欄位都是使用者自己填的），不需要繞去 Cloud Run + Gemini。

## 規劃階段

### Phase 0 — 安全前提（阻塞項，必須先做）

在接上任何會計費的 GCP 資源之前，先補上 Parse 使用者驗證（Parse User + ACL）。現在任何人都能打 Back4App 已經是風險，一旦接上 Gemini/GCS，沒有驗證等於任何人都能用專案的額度狂發 AI 請求或狂傳檔案，帳單風險完全不同等級。這件事排在 GCP 整合之前，不是之後。

### Phase 1 — 建立可信的後端邊界

現在前端直接握有 Parse App ID/JS Key 已經是妥協，但如果讓前端直接拿 GCP service account 或直接呼叫 Vertex AI，風險更高。加一個單一的 Cloud Run 服務當「可信中介層」：

- 前端向 Cloud Run 要 GCS Signed URL（不是直接把憑證給前端）。
- Cloud Run 是唯一持有 GCP 服務帳戶金鑰的地方。
- Cloud Run 用 Parse **Master Key**（絕不進前端 bundle）把生成結果寫回 Parse，不透過 Cloud Code webhook 的複雜度。

### Phase 2 — 資料模型異動

新增一個 `GenerationJob` Parse class，而不是硬塞進 `Activity` 現有欄位：

- `activity`（指標）、`kind`（成果報告/其他）、`status`（pending/processing/done/error）
- `sourceFiles`（GCS 路徑，語音/影片/圖片/文字輸入）
- `resultFile`（GCS 路徑，Gemini 分析後由 Cloud Run 組出的真正 PDF/Word/Excel）

「使用者上傳原始素材 → AI 生成」跟現有的 `photoFiles`/`audioFiles`（單純附件保存）分開，不會互相污染；`Activity.summary`/`kpis` 可以選擇性地被生成結果回填，但保留使用者手動編輯的權利。

### Phase 3 — 前端串接方式

新增一個「AI 自動生成成果報告」的入口（例如 `DetailView.vue` 現有的三個「產生 XXX」按鈕旁加一個新按鈕），流程：

1. 上傳素材（語音/影片/圖片/文字）→ 建立 `GenerationJob`
2. 前端輪詢（或 LiveQuery，如果 Back4App 方案有支援）job 狀態
3. 完成後提供真正檔案下載

**現有的簽到表/領據/CSV 匯出保持純前端不動**，不需要牽動 GCP。

### 附帶項目：模板輸出格式修正（與 GCP 無關，可獨立先做）

既然確認輸出格式要是「真正的」PDF/Word/Excel，現有 `downloadFile()` 產生的其實是改副檔名的 HTML，不是真正格式。可以先用前端函式庫（`docx`、`exceljs`、`pdf-lib`）把簽到表/領據這幾個模板升級成真格式，不需要等後端。

## 建議優先序

1. Parse 使用者驗證/ACL（阻塞項）
2. 前端模板改成真正 docx/xlsx/pdf 格式（小工程、立即見效、跟 GCP 無關）
3. Cloud Run 中介層 + GCS signed URL（GCP 整合的地基）
4. `GenerationJob` 資料模型 + Gemini 串接（核心新功能）

第 1、2 項風險最低、能立刻推進，且不依賴還沒申請的 GCP 資源，建議優先處理。
