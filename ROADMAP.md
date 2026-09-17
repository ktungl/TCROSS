# GCP 整合規劃

這份文件記錄「導入 GCP」後，現況與目標架構之間的落差，以及規劃的實作階段。細節會隨著實作進度更新；GCP 的目標架構說明本身在 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)。

## 人力分工與時程（依《需求訪談.docx》，8/16 結論）

三名數位人才依主責領域分工，時程為**8 月底需求確認／9 月底 demo／10 月測試／10 月底完成**。每項交付物僅掛一位主責人，其餘成員為協作支援；三人皆參與需求訪談、驗收測試與場域溝通。

| 數位人才 | 主責領域 | 具體職掌 |
| --- | --- | --- |
| **鍾雅婷（技術總主責）** | 系統架構規劃、文件自動化產出、API 串接 | 整體系統架構與部署規劃（GCP 評估）、Excel 與 Word 範本產出引擎（xlsx／docx）、API 規格制定、雲端費用與備份策略、對外技術窗口 |
| 劉冠彤 | 報表製作、網頁前端設計 | 活動建檔表單、多類型附件上傳介面、時間區段篩選與匯出畫面、合照盟 logo 與配色套用、手機版介面適配 |
| 陳怡靜 | 後端資料串接、資料結構設計 | 資料模型設計（活動、計畫、附件、主子計畫標籤與多對多對應）、後端 CRUD 與檔案儲存命名規則、報表欄位對照表落地、缺漏檢核規則、帳號權限設定 |

### 鍾雅婷的分月工作項目與目前狀態

| 月份／里程碑 | 工作項目 | 目前狀態（依專案現況，2026-09-03） |
| --- | --- | --- |
| **8 月｜需求確認** | 1. 完成系統架構圖與 input → output 流程圖 | ✅ 已完成——README.md「架構擴充：導入 GCP」的服務分工表與資料流向圖 |
| | 2. GCP 完成與測試 | ✅ 已完成——Phase 1 Cloud Run 中介層已部署並實測（見下方進度表） |
| | 3. 提出部署方案建議 | ✅ 已完成——`tcross-middleware` 已部署至 GCP `asia-east1` |
| | 共同里程碑：8/31 需求與欄位凍結 | ✅ 已完成——《需求訪談》欄位對照表已確認，9/3 完成實作（活動欄位、8 分類附件、大紀事/內政部雙報告匯出），資料模型與 Back4App schema 皆已對齊 |
| **9 月｜Demo** | 1. 完成 Excel／Word 匯出模組原型並套用實際範本 | 🟡 大致完成——已依欄位對照表實作大紀事 Excel（`buildLedgerXlsx`）與內政部結案 Word（`buildNeimuReportDocx`）；✅ 2026-09-04 已用真實照片跑過一次完整上傳→匯出流程並驗證圖片內嵌排版：建立測試活動、上傳 3 張真實 jpg 附件，匯出後解壓 `.xlsx`/`.docx` 內部 zip，確認 `xl/media/image1.jpeg`／`word/media/*.jpg` 內嵌圖片位元組與原始檔案（85,077 bytes）完全一致、JPEG SOI/EOI 標記正常，非空白或壞檔；**還沒拿實際範本逐項核對抬頭/編號等格式細節**（對應 10 月上半第 2 項，待實際範本到手） |
| | 2. 系統內部 API 規格（前端 ↔ Parse 的介面約定） | 🟡 部分完成——`/signed-url`／`/download-url`／`/delete-objects` 規格已定並上線，但觸發生成用的新端點規格尚未定案細節（見下方 Phase 3b 下一步） |
| | 3. Gemini API 的呼叫規格（提示詞、輸入格式、回傳的 JSON 結構） | ⬜ 未開始——對應 Phase 3b，依使用者指示暫緩 |
| | 共同里程碑：9/30 Demo（用車計畫統計／參訪活動跑通完整流程） | ⬜ 未到期，但 Phase 3b 暫緩中，若 9 月中前不重啟會影響這個里程碑 |
| **10 月上半｜測試** | 1. 部署至外部主機、建立備份機制 | 🟡 部分完成——Cloud Run 已是正式部署，但正式網域還沒決定（`ALLOWED_ORIGIN` 目前只設 localhost，見下方「下一步」第 1 項），備份機制細節待訂 |
| | 2. 修正匯出格式細節（抬頭、頁碼、編號） | ⬜ 未開始 |
| | 共同里程碑：10/15 進入場域測試 | ⬜ 未到期 |
| **10 月下半｜結案** | 1. 撰寫部署與維運說明 | ✅ **2026-09-04 完成技術面**——新增 [OPERATIONS.md](OPERATIONS.md)：系統組成、健康檢查、稽核紀錄查詢、部署／回滾指令、密鑰輪替方式（含驗證過 `PARSE_MASTER_KEY` 是環境變數形式掛載、換金鑰要重部署新 revision 才生效這個容易誤解的細節）。組織面（值班窗口、備份排程、通報流程）仍列在文件底部「待補」，需要團隊補上 |
| | 2. 訂定後續範本修改流程 | ✅ **2026-09-04 完成**——併入 [OPERATIONS.md](OPERATIONS.md#範本修改流程)：說明 `src/utils/download.ts` 的樣板函式改法、如何用真實資料本機驗證、圖片內嵌要怎麼用解壓 zip 比對位元組（沿用 9/4 驗證過的方法），以及改欄位對照時 `types.ts`／`Activity.ts`／`cloud/main.js`／schema 四處要一起改的提醒 |
| | 共同里程碑：10/31 完成驗收並交付操作手冊 | ⬜ 未到期 |

### 跨組銜接重點（鍾雅婷的責任）

1. ~~欄位對照表（陳怡靜主責）→ **匯出模組（鍾雅婷）** → 表單欄位（劉冠彤）：三方須於 8 月底前對齊，否則 9 月底 demo 將無可展示內容。~~ ✅ 2026-09-03 已對齊：《需求訪談》欄位對照表 → `src/types.ts`／`models/Activity.ts` 資料模型 → `ActivityFormModal.vue` 建檔表單 → `utils/download.ts` 雙報告匯出，一條鏈都已實作完成。
2. API 規格由**鍾雅婷定稿**、陳怡靜實作、劉冠彤串接，建議 9 月第一週先凍結一版。
3. 附件命名與儲存路徑規則由陳怡靜訂定，**鍾雅婷於部署時確認容量與備份方式**。
4. 每兩週召開一次同步會議，檢視各項交付狀態並視情況調整分工。

### 備註：文件中「工程師 A／B／C」技術分工代號對照

《需求訪談.docx》後段另有一份以代號描述的技術分工表，**文件本身沒有明講代號對應到誰**，以下是依職掌內容比對推論出的對應（建議跟劉冠彤、陳怡靜當面確認一次）：

| 代號 | 推論對應 | 依據 |
| --- | --- | --- |
| 工程師 A（前端體驗大師／UI-UX 總管） | 劉冠彤 | 技術棧為純 Vue 3 + TS 前端，職掌與跨組銜接重點第 2 點「劉冠彤串接」相符 |
| 工程師 B（資料煉金術士／AI 導入顧問） | 陳怡靜 | 技術棧為 Parse Cloud Code + Gemini API，跟她「後端 CRUD 與檔案儲存命名規則」「API 由她實作」相符 |
| 工程師 C（成果收割機／GCP 基礎建設大師） | **鍾雅婷** | 技術棧為 Parse Server 部署 + GCP Infra，「圖文排版引擎」「Cloud Run 容器化」「GCP IAM」對應鍾雅婷的職掌，且「API 規格由鍾雅婷定稿」對應 C→B→A 的分工鏈 |

工程師 B 職掌原文建議把 Gemini 呼叫寫在 Parse Cloud Code 的 `afterSave` 觸發器裡，這點跟下方 Phase 3b 的技術決策不同——評估後已改採「前端呼叫 Cloud Run 新端點觸發」，理由見下方「下一步」第 2 項。

## 目前進度（2026-09-03，Gemini 串接暫緩，先補齊其他缺口）

| 階段 | 狀態 | 說明 |
| --- | --- | --- |
| Phase 0 — Parse 使用者驗證/ACL | ✅ 完成 | 登入頁、路由守衛、`Plan`/`Activity`/`GenerationJob` 的 Class-Level Permissions 都已設定為 requiresAuthentication 並驗證生效，匿名 REST 請求會被擋。 |
| 附帶項目 — 模板真格式 | ✅ 完成 | 簽到表/活動紀錄表改 `.xlsx`（exceljs），領據改 `.docx`（docx），CSV 匯出維持不動。 |
| 附帶項目 — 需求訪談欄位對照 | ✅ **已完成並部署（2026-09-03，2026-09-04 補上真實照片驗證）** | 活動欄位（分類/起訖日期/與會單位或成員/參加對象說明/男女合計人數/備註）、8 分類附件（含照片圖說與精選標記）、大紀事 Excel + 內政部結案 Word 雙報告匯出都已實作；`cloud/main.js` 的驗證已同步擴充並由使用者部署；Back4App schema 的 16 個新欄位已用 `scripts/sync-schema.mjs --apply` 建立完成。2026-09-04 已用真實照片跑完整的上傳→匯出流程，確認圖片內嵌排版正確（見上方 9 月 Demo 項目 1）。 |
| 附帶項目 — Cloud Code 伺服器端驗證 | ✅ **已部署並驗證生效** | `cloud/main.js`（含 2026-08-20 補上的 `GenerationJob` `activity` 必填檢查與 `resultFile`/`errorMessage` 型別檢查）已由使用者貼回 Back4App Cloud Code Dashboard 並部署——Back4App 伺服器日誌確認 `main.js` 已載入。已用 REST API（Master Key）實測 4 筆畸形資料（空 `Activity.name`、錯誤日期格式、空白 `Plan.name`、缺 `GenerationJob.activity`）全部正確被 `beforeSave` 擋下。與 GCP 無關（Back4App 自己的功能）。 |
| Phase 1 — Cloud Run 中介層 | ✅ **已部署（含今天新增的 `/delete-objects`）** | GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`（Tcross，billing 已啟用），服務 `tcross-middleware` 跑在 `asia-east1`。2026-08-20 上午用 `gcloud run deploy` 部署 `/download-url`（revision `tcross-middleware-00004-zdh`）。2026-08-20 下午（架構健檢後）新增 `POST /delete-objects`（`GenerationJob` 刪除時清 GCS 檔案用）並把三個端點的登入驗證改成共用 `Depends()`，已再次 `gcloud run deploy`（revision `tcross-middleware-00005-nmb`），`GET /status` 與新路由都已在線上確認。環境變數/secrets/服務帳戶皆沿用原設定未變動。2026-09-04 為修 ISO 27001 檢視發現的物件層級授權缺口，再部署一版（revision `tcross-middleware-00006-qlz`），環境變數/secrets/服務帳戶同樣沿用未變動，細節見下方「資安檢視」章節。 |
| Phase 2 — `GenerationJob` 資料模型 | ✅ 完成 | Parse class 已建立，前端型別/model 在 `src/types.ts`/`src/models/GenerationJob.ts`。 |
| Phase 3a — 前端串接（上傳/建立 job/輪詢/下載） | ✅ **已完成並上線** | `AiGenerationModal.vue`（掛在 `DetailView.vue`）支援選檔 → 呼叫 `/signed-url` → 直傳 GCS → 建立 `GenerationJob` → 每 5 秒輪詢（`useGenerationJobPolling.ts`）→ `status === 'done'` 時可下載（呼叫已上線的 `/download-url`）。UI 上明白標註「目前尚未接上自動生成後端」。 |
| Phase 3b — Cloud Run 端 Gemini 生成 | ⬜ **未開始（暫緩，等使用者確認再做）** | `server/main.py` 沒有任何程式碼呼叫 Gemini 或組裝 PDF/Word/Excel；`write_with_master_key()` 已寫好但沒有端點在用。`requirements.txt` 也還沒有 Gemini SDK 或文件組裝套件。GCP 專案的 Vertex AI API（`aiplatform.googleapis.com`）也還沒啟用。**這是目前唯一還沒做的功能性缺口**，但依使用者指示暫緩，先不動。 |

**下一步（依使用者指示，Gemini 部分先擱置）**：

1. ~~Cloud Run 的 `ALLOWED_ORIGIN` 只設了 `http://localhost:5173`~~ ✅ **2026-09-17 已更新並部署**——正式網域確定是 Netlify 的 `https://luminous-moxie-07a76c.netlify.app`，已用 `gcloud run services update --update-env-vars` 把 `ALLOWED_ORIGIN` 改成 `http://localhost:5173,https://luminous-moxie-07a76c.netlify.app`（`server/main.py` 本來就支援逗號分隔多個來源），部署為 revision `tcross-middleware-00010-d9z`，`/status` 已 200 確認正常。**如果之後正式網域又換了（例如換成自訂網域），要記得回來再更新一次這個環境變數**，否則瀏覽器 CORS 會擋掉新網域的請求。
2. **Google Places API 金鑰申請中（使用者正在申請，尚未給金鑰）**——目的是讓「地點」欄位支援 Google 地址自動建議、選完自動填回欄位（比先前做的「地點旁加連結開 Google 地圖」更進一步）。金鑰建立好之後，**「Application restrictions → Websites」的允許網域清單，記得同時加上 `http://localhost:5173/*` 跟 `https://luminous-moxie-07a76c.netlify.app/*` 這兩個**（不是只加 localhost）；`API restrictions` 只勾 Places API 與 Maps JavaScript API。金鑰到手後會放進 `.env` 的 `VITE_GOOGLE_MAPS_API_KEY`（比照 `VITE_PARSE_APP_ID` 的模式，不寫死進程式碼），再接 `ActivityFormModal.vue` 的地點欄位。**未來如果正式網域又換掉，這把金鑰的網域限制也要一併更新**，跟上面第 1 項 Cloud Run 的 `ALLOWED_ORIGIN` 是同一個「換網域要記得改哪些地方」清單裡的項目。
3. **Phase 3b（Cloud Run 接 Gemini + 組裝真正檔案）**——使用者已表示先不要串 AI，待之後回來做時再展開：啟用 Vertex AI API、`requirements.txt` 加 Gemini SDK + 文件組裝套件、實作「讀 GCS 素材 → 呼叫 Gemini → 組裝 PDF/Word/Excel → 寫回 GCS → `write_with_master_key()` 回寫 Parse」的處理邏輯。
   - **觸發方式已定案**：前端在建立好 `GenerationJob` 後直接呼叫 Cloud Run 新端點（例如 `POST /generate/{jobId}`，沿用 `/signed-url`／`/download-url` 同一套 `Depends(require_user)` session token 驗證）來觸發生成，**不用 GCS EventArc**——EventArc 是「檔案一上傳就觸發」，一個 job 通常有多個輸入檔，沒有「這個 job 的檔案都上傳完了」的語意，還要另外做計數/等待邏輯，且跟現有前端「上傳完才建立 GenerationJob」的流程對不上。
   - 另有一份《需求訪談.docx》內部技術分工提案，建議把 Gemini 呼叫寫在 **Parse (Back4App) Cloud Code 的 `afterSave` 觸發器**裡、搭配 GCP Cloud Tasks 做非同步重試——**評估後不採用這個方向**：一來 Back4App Cloud Code 不在 GCP 上，要嘛得讓它額外持有一份 GCP 服務帳戶憑證去發 Cloud Tasks（打破 Phase 1 定案的「只有 Cloud Run 持有 GCP 憑證」信任邊界），要嘛還是得繞回 Cloud Run 做事，等於多繞一手；二來 Back4App Cloud Code 的執行時間限制通常比 Cloud Run 更緊，更容易在多模態 Gemini 呼叫時逾時。Cloud Tasks 的「背景非同步＋退避重試」這個點子仍然有價值，但應該放在 Cloud Run 內部（例如 FastAPI `BackgroundTasks` 或 Cloud Run 呼叫 Cloud Tasks 佇列），而不是由 Back4App Cloud Code 發起。

第 1 項已完成；第 2、3 項是目前整條 GCP 主線還剩下的工作，其餘（Phase 0/1/2/3a、附帶項目）都已完成、部署並實測驗證過。

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

## 資安檢視（依 ISO 27001 Annex A 對照，2026-09-04）

針對前端 Vue SPA、Back4App/Parse 後端、Cloud Run 中介層、Cloud Code 做的程式碼層級檢視。**範圍限制**：ISO 27001 是管理系統標準，正式合規還需要風險評估文件、資產清冊、事件應變計畫、供應商合約（Back4App／GCP 的 DPA）等組織面文件，這些無法從程式碼判斷，以下只涵蓋能從原始碼驗證的技術控制項（A.8 為主）。

| 風險 | 說明 | 對應控制項 | 狀態 |
| --- | --- | --- | --- |
| 🔴 高｜Cloud Run 端點缺少物件層級授權 | `server/main.py` 的 `/download-url`／`/delete-objects`／`/signed-url` 只驗證「是不是已登入的 Parse 使用者」（`require_user`），`utils.is_valid_object_path()` 只檢查路徑落在 `activities/` 前綴且不含 `..`，**沒有驗證這個 activity 的檔案是否屬於該使用者有權存取的範圍**。任何有效帳號的 session token 理論上可對任意 activity 的檔案發下載連結、甚至呼叫刪除 | A.8.3 資訊存取限制／A.5.15 存取控制 | ✅ **2026-09-04 已修正並部署上線**——`server/parse_auth.py` 新增 `activity_exists()`／`find_generation_job_for_object_path()`，改用呼叫者自己的 session token（而非 JS Key 萬用）向 Parse 查詢：`/signed-url` 驗證 `activityId` 是否為呼叫者可讀的真實活動；`/download-url`／`/delete-objects` 驗證 `objectPath` 是否確實被某筆呼叫者可讀的 `GenerationJob`（`sourceFiles`／`resultFile`）引用，不是就回 403。已用真實 Back4App 資料實測 4 種情境（真實 activityId／假 activityId／已引用路徑／未引用路徑）全部正確；已部署到 Cloud Run（`tcross-middleware-00006-qlz`），對正式線上網址直接 curl 驗證：未引用路徑下載回 403、假 activityId 簽發上傳回 403、真實 activityId 正常回 200。這個檢查天然會跟著 Parse CLP／ACL 未來收緊而變嚴，不需要再改 Cloud Run 端 |
| 🔴 高｜Parse CLP 無角色分級 | `cloud/main.js` 註解明講「CLP 開放給所有登入使用者讀寫」；`Activity`／`Plan`／`GenerationJob` 沒有 row-level ACL，也沒有 viewer/editor/admin 角色區分——任一帳號外洩等同整個資料庫（含刪除權）外洩 | A.5.15 存取控制／A.5.18 存取權限管理 | ⬜ 未處理 |
| 🟠 中｜檔案上傳無型別／大小限制 | `FolderDropzone.vue` 的 `<input type="file">` 沒有 `accept` 限制；`db.ts` 的 `uploadFiles()` 與 Cloud Code 的 `beforeSave('Activity')` 只驗證附件陣列**格式**（`{name,size,url}`），不驗證實際檔案大小上限或副檔名／MIME 白名單 | A.8.7 惡意軟體防護／A.8.28 安全程式設計 | ✅ **2026-09-04 已修正**——`src/types.ts` 新增 `fileUploadRejectionReason()`（50MB 大小上限＋執行檔類副檔名黑名單），前端 `db.ts` 的 `uploadFiles()` 與 `AiGenerationModal.vue` 的 `addFiles()` 都會即時擋下並提示；真正的防線是 `cloud/main.js` 的 `beforeSave('Activity')` 加了同樣的大小／副檔名檢查（前端能繞過，Cloud Code 繞不過），`server/main.py` 的 `/signed-url` 也加了副檔名檢查（GCS 直傳無法在簽發階段強制大小上限，這點在 `server/utils.py` 註解說明）。**`cloud/main.js` 待你貼回 Back4App Cloud Code Dashboard才會生效**（跟以前的部署方式一樣） |
| 🟠 中｜相依套件已知漏洞（npm） | `npm audit`：`nanoid` <3.3.18（高，DoS 無限迴圈）、`ws` 8.0.0–8.20.1／`parse` SDK 依賴（高，記憶體洩漏＋DoS）、`uuid` <11.1.1／`exceljs` 依賴（中，buffer 邊界檢查缺失） | A.8.8 技術漏洞管理 | 🟡 **部分完成**——`npm audit fix` 已套用不含 breaking change 的部分，`nanoid` 已升級到 3.3.18（高風險已解）。剩下 `ws`（`parse` SDK 依賴）與 `uuid`（`exceljs` 依賴）都需要 `--force` 降版／換主版本（`parse@3.4.2`、`exceljs@3.4.0`），會影響核心登入與匯出功能，**故意沒有自動套用**——需要你確認要不要接受這個 breaking change 再處理 |
| 🟠 中｜相依套件已知漏洞（Python，原檢視漏檢） | 原本的 ISO 27001 檢視只跑了 `npm audit`，沒檢查 `server/requirements.txt`。補跑 `pip-audit` 後發現 `fastapi==0.115.0` 帶的 `starlette==0.38.6` 有 7 個已知漏洞（`PYSEC-2026-161`／`248`／`249`／`1943`／`1941`／`2281`／`2280`），需要升到 `starlette>=1.3.1` 才算解決 | A.8.8 技術漏洞管理 | ✅ **2026-09-04 已修正並部署上線**（revision `tcross-middleware-00008-rmc`，對正式網址實測 `/status`、副檔名黑名單、真實活動上傳都正常）——升級 `fastapi` 0.115.0→0.141.1（連帶 `starlette` 升到 1.6.0）、`uvicorn` 0.30.6→0.52.4、`pydantic` 2.9.2→2.13.5、`httpx` 0.27.2→0.28.1、`google-cloud-storage` 2.18.2→3.13.1、`google-auth` 2.34.0→2.57.1。這幾個套件本身走小版號緊密相容策略（不像 npm 的 `parse`／`exceljs` 需要換主版本），實測風險低：升級後 `pip-audit` 對 `starlette` 乾淨（只剩 `pip`／`setuptools` 這兩個非執行期的打包工具本身有已知漏洞，不影響應用程式）；用 FastAPI `TestClient` 對本機跑過路由／`Depends`／CORS／`BaseModel` 驗證，行為與升級前一致（`/status` 200、缺 token 422、錯 token 401、擋副檔名 400 都正確）。**尚未部署到 Cloud Run**，等你確認後再跑 `gcloud run deploy` |
| 🟠 中｜缺應用層稽核紀錄 | 刪除檔案、簽發下載連結、Master Key 寫回等敏感操作，除了 GCP／Back4App 預設基礎設施日誌外，沒有「誰在何時做了什麼」的稽核軌跡 | A.8.15 日誌記錄／A.8.16 監控活動 | ✅ **2026-09-04 已修正**——`server/main.py` 新增 `audit_log`（Python `logging`，Cloud Run 會自動收進 Cloud Logging），對 `/signed-url`／`/download-url`／`/delete-objects` 的成功操作與 401/403 拒絕都記錄使用者、objectPath／activityId。**已部署並在 Cloud Logging 實測確認**（`gcloud logging read` 查得到 `rejected: rate limit exceeded user=...` 等紀錄） |
| 🟠 中｜`ALLOWED_ORIGIN` 預設 fail-open | `server/main.py:16` 的 `os.environ.get("ALLOWED_ORIGIN", "*")`——部署時若忘記設定此環境變數，CORS 會預設放行所有來源而非安全預設（fail-closed），目前靠 README 提醒補救 | A.8.20 網路安全／A.8.26 安全開發原則 | ✅ **2026-09-04 已修正**——沒設 `ALLOWED_ORIGIN` 現在會讓服務直接啟動失敗（`RuntimeError`），不會再靜默放行所有來源。已用本機測試確認：未設時匯入即拋錯、設定後正常啟動。線上目前已有設定 `ALLOWED_ORIGIN`，重部署不會中斷服務。**已部署上線** |
| 🟡 低｜Cloud Run 容器以 root 執行 | `server/Dockerfile` 沒有設定非 root `USER`，不符合容器安全基準 | A.8.9 組態管理 | ✅ **2026-09-04 已修正並部署**——新增 `useradd appuser` + `USER appuser`，容器不再以 root 執行 |
| 🟡 低｜無速率限制 | 登入與 `/signed-url` 等端點沒有 rate limiting，外洩的 session token 理論上可被用來大量簽發下載連結耗用配額 | A.8.16 監控活動 | ✅ **2026-09-04 已修正（輕量版）並部署**——`server/main.py` 新增每使用者每分鐘 30 次的記憶體內 rate limit，套用在 `/signed-url`／`/download-url`／`/delete-objects`，超過回 429。**已知限制**：狀態只存在單一 Cloud Run instance 記憶體裡，重啟或多 instance 情況下不是精確硬上限，只是拉高濫用門檻；正式的分散式限流要接 Memorystore/Redis，先不做。已對正式線上網址直接打 32 次連續請求實測：前 27 次正常回應（前面測試已用掉 3 次額度)，第 28 次起全部正確回 429 |

**已符合的作法**（檢視時一併確認，值得保留）：`PARSE_MASTER_KEY` 存於 Secret Manager、非明文環境變數；Signed URL 用 IAM 自我模擬簽章且 15 分鐘短效期，沒有落地長效 JSON 金鑰檔；`.env` 正確被 `.gitignore`、全 git 歷史掃描未發現硬編碼金鑰；`objectPath` 有路徑穿越（`..`）與前綴白名單檢查；Cloud Code `beforeSave` 對前端請求做了伺服器端二次驗證；前端無 `v-html`／`innerHTML` 等 XSS 注入點。

**建議優先序**（2026-09-04 更新）：
1. ~~Cloud Run 物件層級授權~~ ✅ 已修正並部署上線
2. ~~`npm audit fix`（不含 breaking change 的部分）~~ ✅ 已完成（`nanoid` 已升級）
3. ~~上傳加檔案大小上限＋副檔名白名單~~ ✅ 程式碼已修正（前端＋Cloud Run 已生效；`cloud/main.js` 待你貼回 Back4App Cloud Code Dashboard）
4. ~~`ALLOWED_ORIGIN` 預設值改成 fail-closed~~ ✅ 已修正並部署上線
5. ~~應用層稽核紀錄~~ ✅ 已修正並部署上線，Cloud Logging 已可查到紀錄
6. ~~容器非 root 執行~~ ✅ 已修正並部署上線
7. ~~輕量 rate limit~~ ✅ 已修正並部署上線，對正式網址實測驗證通過
8. **Parse CLP 角色分級**——還沒動，這項牽動資料模型與現有 3 人共用帳號的協作方式，需要先確認角色設計（例如是否所有人仍需要完整讀寫權限）才能動手，不宜自行決定
9. **`exceljs`／`parse` SDK 的 breaking change 升級**（解 `uuid`／`ws` 中高風險漏洞）——需要你確認是否接受主版本升級風險後再處理

**部署狀態**：`server/main.py`／`parse_auth.py`／`utils.py`／`Dockerfile` 的變更已於 2026-09-04 部署上線（revision `tcross-middleware-00007-nfm`），對正式網址直接測試確認：副檔名黑名單擋 400、假 activityId 擋 403、rate limit 第 28 次起擋 429、Cloud Logging 查得到稽核紀錄。**`cloud/main.js` 的變更還沒生效**，要貼回 Back4App Cloud Code Dashboard 才會生效（跟以前的部署方式一樣，這步只有你能做）。



0917
1. 活動照片匯出排版(src/utils/download.ts)
buildNeimuReportDocx 的活動照片區塊,從原本一張張直向堆疊,改成 2 欄表格排版,照片統一縮放到高度 5cm(無邊框、居中,圖說在照片下方),符合 PDF 範例的呈現方式。

2. 地點串接 Google Map(src/utils/activity.ts、ActivityFormModal.vue、DetailView.vue)
新增 googleMapsUrl() 輔助函式。建立/編輯活動表單的「地點」欄位旁,有填值時會出現「地圖」按鈕開新分頁搜尋;活動詳情頁的地點文字也直接變成可點的地圖連結。

3. 活動分類可自訂管理(新增 src/models/Category.ts、src/views/CategoriesView.vue,以及 types.ts／stores/db.ts／ActivityFormModal.vue／ExportView.vue)
新增一個「分類管理」頁面(側邊選單、路由 /categories),可自由新增／改名／刪除分類,取代原本寫死的 5 個選項。設計上刻意讓活動的 categories 欄位繼續存純文字(不是像「計畫」那樣存參照 id)——這直接回答了 PDF 裡的疑問:調整分類清單(改名/刪除)不會影響已建立活動上已記錄的分類文字,只影響往後新增/編輯活動時看到的選項。第一次讀取時,若 Back4App 的 Category 集合還是空的,會自動用舊的 5 個分類名稱當種子建立。

需要你手動做的部署步驟(跟以前改 cloud/main.js 一樣的流程):
- 把更新後的 cloud/main.js 貼回 Back4App Cloud Code Dashboard(分類驗證已改成檢查格式而非固定清單,並新增了 Category class 的 beforeSave)
- 到 Back4App 把新的 Category class 的 Class-Level Permissions 設成跟 Plan/Activity 一樣的 requiresAuthentication(目前專案是這樣鎖住其他 class 的)