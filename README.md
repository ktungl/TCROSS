# TCROSS 活動紀錄平台

Vue 3 + TypeScript + Vite 專案，資料層使用 [Parse Platform](https://parseplatform.org/)（後端建議用 [Back4App](https://www.back4app.com/)），檔案處理與 AI 生成擴充則導入 [Google Cloud Platform (GCP)](https://cloud.google.com/)。

`TCROSS.html` 是最早的單檔原型（vanilla JS + localStorage），保留在 repo 內作為畫面與邏輯的對照，不再維護。

## 開發設定

1. 安裝套件：

   ```bash
   npm install
   ```

2. 到 Back4App 建立一個 App，取得 **App ID**、**JavaScript Key**、**Server URL**（通常是 `https://parseapi.back4app.com/`）。

3. 複製環境變數檔並填入上一步拿到的值：

   ```bash
   cp .env.example .env
   ```

4. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

## 其他指令

- `npm run build` — 型別檢查（`vue-tsc`）+ 產生正式版建置
- `npm run preview` — 本地預覽建置結果

## 資料結構（Parse Classes）

- **Plan**：`name`
- **Activity**：`name` / `date` / `place` / `owner` / `headcount` / `plans`（對應多個 Plan）/ `summary` / `kpis` / `photoFiles` / `audioFiles` / `videoFiles` / `docFiles`
- **GenerationJob**：`activity`（指標）/ `kind`（成果報告/其他）/ `status`（pending/processing/done/error）/ `sourceFiles` / `resultFile` / `errorMessage`——AI 生成任務用，目前只有資料模型，前端還沒有 store/UI 在用它（見 [ROADMAP.md](ROADMAP.md)）

在 `.env` 尚未填入有效憑證前，畫面可以正常開啟與切換頁面，但清單會是空的（連線 Parse 失敗時會在畫面上方顯示錯誤提示）。

## 架構擴充：導入 GCP（Google Cloud Platform）

為了處理多格式文件的自動化解析與 AI 生成，架構在 Parse 之外擴充了 GCP，讓 Parse 專心處理使用者驗證與資料庫存取，重勞力的檔案處理與 AI 生成交給 GCP 服務。

### 輸入 / 輸出格式（已確認 2026-08-12）

- **輸入**：語音、影片、圖片、文字
- **輸出**：PDF、Word、Excel

輸入端以 Gemini 的原生多模態能力（語音、影片、圖片、文字都能直接餵給模型）為主要解析入口，不需要額外接 Speech-to-Text 或 Video Intelligence 轉檔；Document AI 僅在輸入圖片是「印刷掃描件/書面表單」需要高精度結構化擷取時才選配使用。輸出端因為 Gemini 只吐得出文字/JSON，實際的 PDF/Word/Excel 檔案要在 Cloud Run 裡用 Python 套件（如 `reportlab`、`python-docx`、`openpyxl`）組裝產出。

### 服務分工

| GCP 服務 | 角色 | 優勢 | 需注意的風險 |
| --- | --- | --- | --- |
| **Cloud Storage (GCS)** | 統一檔案儲存庫（輸入的語音/影片/圖片 + 輸出的 PDF/Word/Excel） | 支援 Signed URL，前端 Vue 可直傳檔案不經過 Parse，省頻寬又快 | IAM 權限設定要嚴格，避免上傳桶變成公開讀取的漏洞 |
| **Vertex AI (Gemini)** | 核心多模態分析引擎 | 原生直接讀取語音/影片/圖片/文字，具備百萬級 Tokens 的超大上下文窗口，一次輸入即可輸出結構化 JSON，不需個別轉檔 | 語音/影片檔案大小與時長有限制；需留意 API 的 Quota（配額）與非同步回應時間 |
| **Cloud Run / Cloud Functions** | 異步運算大腦（Python） | 上傳觸發後：呼叫 Gemini 取得結構化結果 → 用 `reportlab`/`python-docx`/`openpyxl` 組裝出 PDF/Word/Excel；Cloud Run 支援 Docker，套件安裝無限制 | Cloud Functions 有執行時間限制，大檔案生成建議用 Cloud Run（最長可跑 60 分鐘） |
| **Document AI**（選配） | 印刷掃描件的 OCR 與結構化 | 若輸入圖片是掃描表單、收據、合約等版面固定的印刷文件，用它加強欄位擷取的精準度 | 按頁數計費；一般口語錄音、生活照片、影片不需要，避免不必要成本 |

### 資料流向

```
[Vue + TS 前端] ──(1) 請求 Signed URL ──> [Parse Server]
       │
       ├──(2) 直傳輸入檔 (語音/影片/圖片/文字) ──> [Cloud Storage (GCS)]
                                                     │
                                       (3) EventArc 檔案上傳觸發
                                                     ▼
                                          [Cloud Run (Python)]
                                     (4) 呼叫 Vertex AI Gemini 解析多模態輸入
                                     (5) 依結構化結果組裝 PDF/Word/Excel
                                                     │
                                       (6) 產出檔案寫回 GCS
                                                     ▼
[Parse Database] <──(7) 寫回生成結果 / 檔案連結 ─────┘
       │
       └──(8) LiveQuery 即時推播結果 ──> [Vue + TS 前端渲染]
```

### 關鍵優勢：Gemini 的原生多模態

傳統流程要為語音、影片、圖片各接一套轉文字/轉描述的服務（STT、OCR、影片摘要）。Gemini 可以直接吃這些原始檔案並輸出結構化 JSON，省去分別轉檔、切段（Chunking）、向量化（Vectorizing）的工序，能大幅縮短前期開發時間；剩下要自建的主要是「結構化結果 → PDF/Word/Excel」這一段輸出組裝邏輯。

### 現況與實作規劃

以上是目標架構；**目前尚未實作**，現有系統仍是純前端直接讀寫 Parse，沒有 GCS/Cloud Run/Gemini。落差盤點、資料模型異動與分階段實作計畫見 [ROADMAP.md](ROADMAP.md)。

## 開發過程

0729（已完成）
1. ~~刪除確認 + 儲存回饋~~：`useConfirm`/`useToast` 已接上刪除計畫、刪除檔案、儲存活動/成果等操作
2. ~~檔案上傳體驗優化~~：`DetailView.vue` 已支援拖曳上傳到資料夾區塊，照片資料夾有縮圖預覽
3. ~~活動關鍵字搜尋~~：`ListView.vue` 已加上活動名稱/地點/負責人的關鍵字搜尋，與計畫/月份/缺漏篩選並存
4. ~~計畫詳情頁~~：點計畫卡片會導到 `PlanDetailView.vue`，列出該計畫底下的完整活動清單
5. ~~總覽儀表板~~：`DashboardView.vue` 已有活動總數、缺漏率、近 6 個月活動量小圖表
6. ~~活動複製功能~~：`DetailView.vue` 的「複製此活動」已可一鍵建立同名活動草稿

0814
- Parse 使用者驗證（登入頁 + 路由守衛）與 Class-Level Permissions（`Plan`/`Activity`/`GenerationJob` 都已限定需登入才能讀寫）
- 簽到表/活動紀錄表/領據/成果報告草稿改成真正的 `.xlsx`/`.docx` 格式，不再是改副檔名的 HTML
- 新增 `GenerationJob` 資料模型與 `server/`（Cloud Run signed URL 中介層程式碼），對應 [ROADMAP.md](ROADMAP.md) Phase 1/2；尚未部署、前端也還沒串接

0819
- 新增 `cloud/main.js`（Back4App Cloud Code）：`Plan`/`Activity`/`GenerationJob` 補上伺服器端 `beforeSave` 資料驗證，擋掉繞過前端直接打 API 寫入的畸形資料；程式碼寫好、用 mock Parse Cloud 環境跑過 22 組正常/異常案例，部署步驟見 `cloud/README.md`，尚未部署到 Back4App
- `server/`（Cloud Run 中介層）**已部署**到 GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`（`tcross-middleware`，`asia-east1`），`GET /status` 驗證回傳正常，對應 [ROADMAP.md](ROADMAP.md) Phase 1
- 前端串接 `GenerationJob` 上傳/建立/輪詢流程（`AiGenerationModal.vue`、`useGenerationJobPolling.ts`、`lib/middleware.ts`），對應 ROADMAP Phase 3a；Cloud Run 端的 Gemini 生成邏輯（Phase 3b）還沒開始，UI 上會誠實顯示「尚未接上自動生成後端」

0820（Gemini/AI 串接暫緩，先補其他缺口）
- `server/` 新增 `/download-url` 端點（`storage.py`/`utils.py`/`main.py`），讓已完成的 `GenerationJob` 可以簽發限時 GCS 下載網址；`AiGenerationModal.vue` 補上對應的下載按鈕（目前工作 + 過去工作清單皆可下載）。**已用 `gcloud run deploy` 部署到 `tcross-middleware`（revision `tcross-middleware-00004-zdh`）並在線上實測 `/status`、`/download-url` 通過**
- `cloud/main.js` 的 `GenerationJob` 驗證補上 `activity` 必填、`resultFile`/`errorMessage` 型別檢查，**已由使用者部署到 Back4App**（伺服器日誌確認 `main.js` 已載入），還沒有對應的 mock 測試案例