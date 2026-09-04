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

## 前端架構

`src/` 底下依職責分層：

- **`router/`**：`vue-router` 設定所有頁面路由（`DashboardView`/`ListView`/`DetailView`/`PlansView`/`PlanDetailView`/`ExportView`/`LoginView`）；`beforeEach` 守衛檢查 `Parse.User.current()`，未登入且非 `meta.public` 的路由一律導回 `/login`，已登入的人存取 `/login` 則導回列表頁。
- **`stores/`**（Pinia）：`db.ts` 是核心資料 store，包著 `Plan`/`Activity`/`GenerationJob` 的讀取、建立、更新、刪除，共用的「建指標 → set 欄位 → save → 同步本地」邏輯抽成 `patchActivity()`；`auth.ts` 管登入/登出狀態，包一層 `Parse.User`。
- **`lib/`**：`parse.ts` 用 `.env` 的 App ID/JS Key/Server URL 初始化 Parse SDK，全專案共用同一個實例；`middleware.ts` 封裝呼叫 Cloud Run 中介層（`server/`）的三支 API——`requestSignedUploadUrl()`、`requestDownloadUrl()`、`deleteObjects()`，都會帶上 `Parse.User.current()?.getSessionToken()` 做驗證。
- **`composables/`**：`useToast.ts`/`useConfirm.ts` 是全域的提示訊息與刪除確認彈窗狀態（`reactive` 陣列/物件，搭配 `components/ToastStack.vue`、`components/ConfirmDialogHost.vue` 掛在 `App.vue` 顯示）；`useGenerationJobPolling.ts` 每 5 秒輪詢 `GenerationJob.status`。
- **`components/`**：頁面共用的 UI 元件，例如活動卡片（`ActivityEntry.vue`）、活動新增/編輯表單（`ActivityFormModal.vue`）、AI 生成任務彈窗（`AiGenerationModal.vue`）、四個資料夾共用的拖曳上傳卡（`FolderDropzone.vue`）、產出文件預覽（`GeneratedDocModal.vue`）。
- **`utils/`**：`download.ts` 用 `docx`/`exceljs` 產生真正格式的簽到表/活動紀錄表/領據/成果報告草稿；`activity.ts` 是活動相關的純函式（篩選、格式化等）。
- **`models/`**：`Activity.ts`/`Plan.ts`/`GenerationJob.ts` 定義對應 Parse Class 的型別/轉換邏輯，供 `stores/db.ts` 使用。

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
| **Cloud Run / Cloud Functions** | 異步運算大腦（Python） | 前端呼叫觸發後：呼叫 Gemini 取得結構化結果 → 用 `reportlab`/`python-docx`/`openpyxl` 組裝出 PDF/Word/Excel；Cloud Run 支援 Docker，套件安裝無限制 | Cloud Functions 有執行時間限制，大檔案生成建議用 Cloud Run（最長可跑 60 分鐘） |
| **Document AI**（選配） | 印刷掃描件的 OCR 與結構化 | 若輸入圖片是掃描表單、收據、合約等版面固定的印刷文件，用它加強欄位擷取的精準度 | 按頁數計費；一般口語錄音、生活照片、影片不需要，避免不必要成本 |

### 資料流向

觸發方式**不用** GCS EventArc（檔案一上傳到 GCS 就觸發）——一個 `GenerationJob` 通常對應多個輸入檔，EventArc 沒有「這個 job 的檔案都上傳完了」這種語意，還要另外做計數/等待邏輯，而且跟現有前端「上傳完才建立 GenerationJob」的流程對不上。改成**前端在建立好 `GenerationJob` 後，直接呼叫 Cloud Run 新端點觸發生成**，觸發時機精準，也不需要讓 Parse／Back4App Cloud Code 另外持有一份 GCP 憑證去發 Cloud Tasks——沿用 Phase 1 定案的「只有 Cloud Run 持有 GCP 服務帳戶」這條信任邊界。

```
[Vue + TS 前端] ──(1) 請求 Signed URL ──> [Cloud Run 中介層]
       │
       ├──(2) 直傳輸入檔 (語音/影片/圖片/文字) ──> [Cloud Storage (GCS)]
       │
       ├──(3) 建立 GenerationJob（記錄 sourceFiles）──> [Parse Database]
       │
       └──(4) 呼叫 Cloud Run 新端點觸發生成（帶 session token）──> [Cloud Run (Python)]
                                     (5) 用 Master Key 把 status 改成 processing
                                     (6) 呼叫 Vertex AI Gemini 解析多模態輸入
                                     (7) 依結構化結果組裝 PDF/Word/Excel
                                     (8) 產出檔案寫回 GCS
                                     (9) 用 Master Key 把結果／status=done 寫回 Parse
                                                     │
                                                     ▼
[Vue + TS 前端] <──(10) 輪詢 GenerationJob.status（現有 useGenerationJobPolling.ts，5 秒一次）
       └──(11) status === 'done' 後呼叫 /download-url 下載產出檔案
```

（Back4App 方案目前沒有用 LiveQuery，第 10 步是既有的輪詢機制，不是即時推播。）

### 關鍵優勢：Gemini 的原生多模態

傳統流程要為語音、影片、圖片各接一套轉文字/轉描述的服務（STT、OCR、影片摘要）。Gemini 可以直接吃這些原始檔案並輸出結構化 JSON，省去分別轉檔、切段（Chunking）、向量化（Vectorizing）的工序，能大幅縮短前期開發時間；剩下要自建的主要是「結構化結果 → PDF/Word/Excel」這一段輸出組裝邏輯。

### 現況與實作規劃

以上是目標架構；**目前尚未實作**，現有系統仍是純前端直接讀寫 Parse，沒有 GCS/Cloud Run/Gemini。落差盤點、資料模型異動與分階段實作計畫見 [ROADMAP.md](ROADMAP.md)。

