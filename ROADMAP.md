# GCP 整合規劃

這份文件記錄「導入 GCP」後，現況與目標架構之間的落差，以及規劃的實作階段。細節會隨著實作進度更新；GCP 的目標架構說明本身在 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)。

> **文件結構說明**：最上面兩節是「待辦」與「已完成」的總覽，方便快速掃過目前狀態；後面的章節保留完整細節（日期、revision 編號、實測結果）供追溯查證。

---

## ⬜ 待辦事項總覽（依優先序，2026-09-17 更新）

🔴 **高風險 / 需你決定才能動手**
1. **Parse CLP 無角色分級**——`cloud/main.js` 仍是「所有登入使用者可讀寫」，沒有 viewer/editor/admin 區分。任一帳號外洩＝整個資料庫外洩。需要你先決定角色設計（見[資安檢視](#資安檢視依-iso-27001-annex-a-對照)第 2 項）。
2. **`cloud/main.js` 實際部署版本無法從程式碼確認**——CLP 驗證、上傳大小/副檔名檢查、Category `beforeSave` 都要手動貼回 Back4App Dashboard 才生效，目前不確定線上跑的是哪一版（見[部署落差](#資安檢視依-iso-27001-annex-a-對照)）。

🟠 **中—需要你確認是否接受風險**
3. **`npm` 套件漏洞未解**——`uuid`（經 `exceljs`）／`ws`（經 `parse` SDK）需要 `npm audit fix --force` 換主版本才能解，會影響匯出與登入功能。
4. **`fastapi`/`starlette` 升級是否已部署到 Cloud Run 無法確認**——程式碼（`requirements.txt`）已是新版，但部署紀錄前後矛盾，需要你跑一次健康檢查指令核對線上 revision。
5. **Google Places API 金鑰申請中**，尚未拿到，地址自動建議功能還沒接。

⬜ **尚未到期的里程碑**
6. 9/30 Demo（Phase 3b 已完成並實測，可展示）、10/15 場域測試、10/31 驗收交付。

⬜ **其他待辦**
7. 匯出格式細節（抬頭／頁碼／編號）還沒拿實際範本逐項核對。
8. 備份機制頻率與還原演練排程還沒訂。
9. 正式網域（現為 Netlify `luminous-moxie-07a76c.netlify.app`）之後若再更換，記得同步更新 Cloud Run 的 `ALLOWED_ORIGIN` 與（拿到金鑰後）Google Maps API 金鑰的網域白名單。
10. 目前只有 `.docx` 輸出，還沒做 PDF/Excel（README 目標架構寫三種格式都要支援）。
11. 若要更換 GCP／Back4App 的付款卡片或使用權人，流程見[帳號與帳單異動（換卡、換使用權人）](#帳號與帳單異動換卡換使用權人)，工作量小、不動 `.env`。

---

## ✅ 已完成事項總覽

- GCP 整合 Phase 0／1／2／3a 全部完成並部署上線並實測驗證。
- 《需求訪談》欄位對照表已落地：活動欄位、8 分類附件、大紀事 Excel／內政部結案 Word 雙報告匯出，含真實照片驗證圖片內嵌排版正確。
- `cloud/main.js` 伺服器端驗證已部署並用畸形資料實測擋下。
- 部署維運文件（`OPERATIONS.md`）與範本修改流程文件已完成。
- 資安檢視 9 項風險中 7 項已修正並部署上線（物件層級授權、稽核紀錄、CORS fail-closed、容器非 root、rate limit、`nanoid` 漏洞、上傳驗證前端＋Cloud Run 端）。
- 正式網域已確定為 Netlify，Cloud Run 的 `ALLOWED_ORIGIN` 已同步更新並實測。
- 2026-09-17 新功能（匯出排版改版、地點串接 Google Map、活動分類自訂管理）程式碼已完成。
- 2026-09-17 **Phase 3b 已完成、部署上線並通過真實端到端測試**（revision `tcross-middleware-00011-hdv`）——用瀏覽器實際跑過一次「上傳照片→建立工作→觸發生成→Gemini 分析→下載 `.docx`」全流程，下載下來的文件內容經確認正確（Gemini 正確讀出測試照片裡的文字並填入摘要／重點／KPI 表格）。測試資料已清除。
- 2026-09-17 **修正一個既有 bug**：`DetailView.vue` 的「AI 自動生成成果報告」入口在當天稍早的另一筆 commit（`ae87e4e`）中被意外拿掉，導致 Phase 3a/3b 完全沒有 UI 入口可用；已修回並在測試中確認可正常開啟。

---

## 人力分工與時程（依《需求訪談.docx》，8/16 結論）

三名數位人才依主責領域分工，時程為**8 月底需求確認／9 月底 demo／10 月測試／10 月底完成**。每項交付物僅掛一位主責人，其餘成員為協作支援；三人皆參與需求訪談、驗收測試與場域溝通。

| 數位人才 | 主責領域 | 具體職掌 |
| --- | --- | --- |
| **鍾雅婷（技術總主責）** | 系統架構規劃、文件自動化產出、API 串接 | 整體系統架構與部署規劃（GCP 評估）、Excel 與 Word 範本產出引擎（xlsx／docx）、API 規格制定、雲端費用與備份策略、對外技術窗口 |
| 劉冠彤 | 報表製作、網頁前端設計 | 活動建檔表單、多類型附件上傳介面、時間區段篩選與匯出畫面、合照盟 logo 與配色套用、手機版介面適配 |
| 陳怡靜 | 後端資料串接、資料結構設計 | 資料模型設計（活動、計畫、附件、主子計畫標籤與多對多對應）、後端 CRUD 與檔案儲存命名規則、報表欄位對照表落地、缺漏檢核規則、帳號權限設定 |

### 鍾雅婷的分月工作項目與目前狀態

| 月份／里程碑 | 工作項目 | 目前狀態（2026-09-17 更新） |
| --- | --- | --- |
| **8 月｜需求確認** | 1. 完成系統架構圖與 input → output 流程圖 | ✅ 已完成——README.md「架構擴充：導入 GCP」的服務分工表與資料流向圖 |
| | 2. GCP 完成與測試 | ✅ 已完成——Phase 1 Cloud Run 中介層已部署並實測 |
| | 3. 提出部署方案建議 | ✅ 已完成——`tcross-middleware` 已部署至 GCP `asia-east1` |
| | 共同里程碑：8/31 需求與欄位凍結 | ✅ 已完成——《需求訪談》欄位對照表已確認，資料模型與 Back4App schema 皆已對齊 |
| **9 月｜Demo** | 1. 完成 Excel／Word 匯出模組原型並套用實際範本 | 🟡 大致完成——`buildLedgerXlsx`／`buildNeimuReportDocx` 已實作並用真實照片驗證圖片內嵌正確；**⬜ 還沒拿實際範本逐項核對抬頭/編號等格式細節**（待實際範本到手） |
| | 2. 系統內部 API 規格 | ✅ 已定案並實作——`/signed-url`／`/download-url`／`/delete-objects`／`/generate/{job_id}` 都已上線／已寫好待部署 |
| | 3. Gemini API 的呼叫規格 | ✅ 已定案並實作（2026-09-17）——`server/report.py` 的 `analyze_sources()`：多模態輸入直接以 `gs://` URI 餵給 Gemini，用 `response_schema` 強制回傳結構化 JSON（`summary`／`highlights`／`kpis`）；🟡 尚未用真實 GCP 專案跑過端到端測試（需先完成部署前提） |
| | 共同里程碑：9/30 Demo | 🟡 未到期——Phase 3b 程式碼已完成，只要完成部署前提（見[待辦事項總覽](#-待辦事項總覽依優先序2026-09-17-更新)第 6 項）就能在 demo 展示 |
| **10 月上半｜測試** | 1. 部署至外部主機、建立備份機制 | 🟡 部分完成——Cloud Run 已正式部署，✅ 正式網域已確定（Netlify）並更新 `ALLOWED_ORIGIN`；⬜ 備份機制細節仍待訂 |
| | 2. 修正匯出格式細節（抬頭、頁碼、編號） | ⬜ 未開始 |
| | 共同里程碑：10/15 進入場域測試 | ⬜ 未到期 |
| **10 月下半｜結案** | 1. 撰寫部署與維運說明 | ✅ 技術面已完成——[OPERATIONS.md](OPERATIONS.md)；⬜ 組織面（值班窗口、備份排程、通報流程）待團隊補上 |
| | 2. 訂定後續範本修改流程 | ✅ 已完成——併入 [OPERATIONS.md](OPERATIONS.md#範本修改流程) |
| | 共同里程碑：10/31 完成驗收並交付操作手冊 | ⬜ 未到期 |

### 跨組銜接重點（鍾雅婷的責任）

1. ✅ **已完成**：欄位對照表（陳怡靜主責）→ 匯出模組（鍾雅婷）→ 表單欄位（劉冠彤）三方對齊——《需求訪談》欄位對照表 → `src/types.ts`／`models/Activity.ts` 資料模型 → `ActivityFormModal.vue` 建檔表單 → `utils/download.ts` 雙報告匯出，一條鏈都已實作完成。
2. API 規格由**鍾雅婷定稿**、陳怡靜實作、劉冠彤串接（已於 9 月第一週凍結一版）。
3. 附件命名與儲存路徑規則由陳怡靜訂定，**鍾雅婷於部署時確認容量與備份方式**（⬜ 備份方式待訂）。
4. 每兩週召開一次同步會議，檢視各項交付狀態並視情況調整分工。

### 備註：文件中「工程師 A／B／C」技術分工代號對照

《需求訪談.docx》後段另有一份以代號描述的技術分工表，**文件本身沒有明講代號對應到誰**，以下是依職掌內容比對推論出的對應（建議跟劉冠彤、陳怡靜當面確認一次）：

| 代號 | 推論對應 | 依據 |
| --- | --- | --- |
| 工程師 A（前端體驗大師／UI-UX 總管） | 劉冠彤 | 技術棧為純 Vue 3 + TS 前端，職掌與跨組銜接重點第 2 點「劉冠彤串接」相符 |
| 工程師 B（資料煉金術士／AI 導入顧問） | 陳怡靜 | 技術棧為 Parse Cloud Code + Gemini API，跟她「後端 CRUD 與檔案儲存命名規則」「API 由她實作」相符 |
| 工程師 C（成果收割機／GCP 基礎建設大師） | **鍾雅婷** | 技術棧為 Parse Server 部署 + GCP Infra，「圖文排版引擎」「Cloud Run 容器化」「GCP IAM」對應鍾雅婷的職掌，且「API 規格由鍾雅婷定稿」對應 C→B→A 的分工鏈 |

**已決策**：工程師 B 職掌原文建議把 Gemini 呼叫寫在 Parse Cloud Code 的 `afterSave` 觸發器裡，評估後**不採用**，改採「前端呼叫 Cloud Run 新端點觸發」，理由見下方 [Phase 3b](#gcp-整合進度) 說明。

---

## GCP 整合進度

### ✅ 已完成

| 階段 | 說明 |
| --- | --- |
| Phase 0 — Parse 使用者驗證/ACL | 登入頁、路由守衛、`Plan`/`Activity`/`GenerationJob` 的 Class-Level Permissions 都已設定為 requiresAuthentication 並驗證生效，匿名 REST 請求會被擋。 |
| 附帶項目 — 模板真格式 | 簽到表/活動紀錄表改 `.xlsx`（exceljs），領據改 `.docx`（docx），CSV 匯出維持不動。 |
| 附帶項目 — 需求訪談欄位對照 | 活動欄位（分類/起訖日期/與會單位或成員/參加對象說明/男女合計人數/備註）、8 分類附件（含照片圖說與精選標記）、大紀事 Excel + 內政部結案 Word 雙報告匯出都已實作；`cloud/main.js` 的驗證已同步擴充並部署；Back4App schema 的 16 個新欄位已用 `scripts/sync-schema.mjs --apply` 建立完成。2026-09-04 已用真實照片跑完整的上傳→匯出流程，確認 `xl/media/image1.jpeg`／`word/media/*.jpg` 內嵌圖片位元組與原始檔案（85,077 bytes）完全一致、JPEG SOI/EOI 標記正常。 |
| 附帶項目 — Cloud Code 伺服器端驗證 | `cloud/main.js`（含 `GenerationJob` `activity` 必填檢查與 `resultFile`/`errorMessage` 型別檢查）已由使用者貼回 Back4App Cloud Code Dashboard 並部署——Back4App 伺服器日誌確認 `main.js` 已載入。已用 REST API（Master Key）實測 4 筆畸形資料全部正確被 `beforeSave` 擋下。 |
| Phase 1 — Cloud Run 中介層 | GCP 專案 `project-80ac5e1a-2ea4-4000-9ff`（Tcross，billing 已啟用），服務 `tcross-middleware` 跑在 `asia-east1`。歷次部署：`/download-url`（revision `00004-zdh`）→ 新增 `/delete-objects`（`00005-nmb`）→ 修物件層級授權（`00006-qlz`）→ 修 Python 套件漏洞＋稽核log＋rate limit＋非root（`00007-nfm`／`00008-rmc`）→ 更新 `ALLOWED_ORIGIN` 為 Netlify 網域（`00010-d9z`，`/status` 已 200 確認）。 |
| Phase 2 — `GenerationJob` 資料模型 | Parse class 已建立，前端型別/model 在 `src/types.ts`/`src/models/GenerationJob.ts`。 |
| Phase 3a — 前端串接（上傳/建立 job/輪詢/下載） | `AiGenerationModal.vue`（掛在 `DetailView.vue`）支援選檔 → 呼叫 `/signed-url` → 直傳 GCS → 建立 `GenerationJob` → 每 5 秒輪詢（`useGenerationJobPolling.ts`）→ `status === 'done'` 時可下載。UI 上明白標註「目前尚未接上自動生成後端」。 |
| Cloud Run `ALLOWED_ORIGIN` 更新為正式網域 | ✅ 2026-09-17——正式網域確定是 Netlify 的 `https://luminous-moxie-07a76c.netlify.app`，已改成 `http://localhost:5173,https://luminous-moxie-07a76c.netlify.app`（`server/main.py` 支援逗號分隔多來源），部署為 revision `tcross-middleware-00010-d9z`，`/status` 已 200 確認正常。**若之後正式網域又換了，記得回來再更新這個環境變數**，否則瀏覽器 CORS 會擋掉新網域的請求。 |

### 🟡 Phase 3b — Cloud Run 端 Gemini 生成（程式碼已完成，2026-09-17，部署待你執行）

**觸發方式已定案並已實作**：前端在建立好 `GenerationJob` 後直接呼叫 Cloud Run 新端點 `POST /generate/{jobId}`（沿用同一套 `Depends(require_user)` session token 驗證）來觸發生成，**不用 GCS EventArc**——一個 job 通常有多個輸入檔，沒有「這個 job 的檔案都上傳完了」的語意，且跟現有前端流程對不上。

《需求訪談.docx》內部技術分工提案建議把 Gemini 呼叫寫在 Parse Cloud Code 的 `afterSave` 觸發器裡搭配 Cloud Tasks——**評估後不採用**：會打破「只有 Cloud Run 持有 GCP 憑證」的信任邊界，且 Back4App Cloud Code 執行時間限制更緊，容易在多模態 Gemini 呼叫時逾時。

**已完成的程式碼**：
- `server/report.py`——`analyze_sources()` 把 `GenerationJob.sourceFiles`（GCS 路徑）直接以 `gs://` URI 餵給 Vertex AI Gemini（不用先下載進 Cloud Run），要求回傳結構化 JSON（`summary`／`highlights`／`kpis`，對應 `Activity.summary`／`kpis` 同款欄位形狀）；`build_report_docx()` 用 `python-docx` 把結果組成真正的 `.docx`（標題／摘要／重點條列／指標表格）。
- `server/main.py` 新增 `POST /generate/{job_id}`：驗證呼叫者能讀到這筆 job 且狀態是 `pending`，用 Master Key 把狀態改成 `processing` 後立即回應 202，實際生成交給 FastAPI `BackgroundTasks` 背景執行；成功寫回 `status=done`＋`resultFile`，任何失敗（Gemini 錯誤、配額超限、組裝失敗等）都會寫回 `status=error`＋`errorMessage`，不會卡在 `processing`（除非 Cloud Run instance 被砍掉，見下面已知限制）。
- `server/storage.py` 新增 `upload_bytes()`（伺服器端直接寫入 GCS，不經過 signed URL）；`server/parse_auth.py` 新增 `get_activity()`／`get_generation_job()`。
- 前端 `src/lib/middleware.ts` 新增 `triggerGeneration()`；`AiGenerationModal.vue` 建立 `GenerationJob` 後立即呼叫，移除了原本「尚未接上後端」的提示文字。
- 本機驗證：`python -m py_compile` 全部通過；用假環境變數 import `report`／`main` 模組成功，路由確實註冊了 `/generate/{job_id}`；`build_report_docx()` 實際跑過一次，產出 36,906 bytes 的有效 `.docx`。**還沒有用真實 GCP 專案（真正的 Gemini API、GCS、Parse）跑過端到端測試**，需要下面的部署前提就位後才能測。

**部署前提三件事**——✅ **2026-09-17 已執行並驗證**：
1. ✅ 已啟用 Vertex AI API（`aiplatform.googleapis.com`）。
2. ✅ 已授權 `tcross-middleware-sa` 的 `roles/aiplatform.user`（`gcloud projects get-iam-policy` 已確認該綁定存在）。
3. ✅ 已重部署（revision `tcross-middleware-00011-hdv`），帶 `--no-cpu-throttling`（`run.googleapis.com/cpu-throttling: 'false'` 已在 service describe 確認）與新環境變數 `GCP_PROJECT`／`GCP_LOCATION=us-central1`／`GEMINI_MODEL=gemini-2.5-flash`（其餘既有環境變數用 `--update-env-vars` 保留未動）。`/status` 200；`/generate/<id>` 對正式網址直接 curl 驗證：缺 `Authorization` 回 422、假 session token 回 401（跟其他端點一致）。

**✅ 端到端測試已完成（2026-09-17）**：用瀏覽器在一筆測試活動上實際跑了一次完整流程——上傳 2 張含文字內容的測試照片 → 建立 `GenerationJob` → 觸發 `/generate` → Gemini 分析 → 下載真正的 `.docx`。第一次觸發遇到 `400 FAILED_PRECONDITION`（Google 訊息：「Service agents are being provisioned...please try again in a few minutes」——剛啟用 Vertex AI API 後的正常過渡狀態，不是程式碼問題），錯誤有正確寫回 `status=error`＋`errorMessage` 並在前端顯示；幾分鐘後重新上傳同樣素材再觸發一次，狀態正確變成 `done`，下載下來的 `.docx` 內容確認：Gemini 正確讀出測試照片裡嵌的文字（「32 人、20 女／12 男、2 場分組討論」），摘要／重點／KPI 表格都用繁體中文正確填入，文件結構（標題／摘要／重點條列／指標表格）符合預期。測試用的活動、`GenerationJob`、GCS 檔案已清除，不留在正式資料庫裡。

**🐛 過程中發現並修正一個既有 bug（跟 Phase 3b 本身無關）**：`src/views/DetailView.vue` 完全沒有引用 `AiGenerationModal.vue`，「AI 自動生成成果報告」這個按鈕在畫面上根本不存在——`git log` 追出來是今天稍早的 [[0917 新功能]] 那個commit（`ae87e4e`，分類管理／地圖／匯出排版那筆）意外把這個按鈕跟入口都拿掉了（同一個 diff 裡被换成了「產生成果報告」，看起来像是改動時的疏漏，不是刻意移除）。這代表 ROADMAP／README 原本寫的「Phase 3a 已完成並上線」在今天這筆commit之後其實是不成立的——程式碼都在，但 UI 沒有入口，使用者點不到。已修正：`DetailView.vue` 重新掛回 `AiGenerationModal`，新增一個獨立的「AI 自動生成成果報告」按鈕（跟手動的「產生成果報告」並列，兩者不互相取代），修好後才能做上面的端到端測試。

**已知限制**：用 `BackgroundTasks` 而不是 Cloud Tasks 佇列，如果 Cloud Run instance 在背景工作跑到一半被縮容砍掉，job 會卡在 `processing` 沒有自動重試（需要手動改回 `pending` 重新觸發，或刪除重建）；`--no-cpu-throttling` 讓 instance 常駐運算資源，這會提高 Cloud Run 的閒置計費，是用可靠性換取的成本。目前只組裝 `.docx`，還沒做 PDF／Excel 輸出（README 目標架構寫三種格式都要支援，這裡先做一種當 MVP）。

### ⬜ 待處理

| 項目 | 說明 |
| --- | --- |
| Google Places API 金鑰 | **申請中，尚未拿到金鑰**。目的是讓「地點」欄位支援 Google 地址自動建議（比目前「地點旁加連結開 Google 地圖」更進一步）。拿到金鑰後待辦：①「Application restrictions → Websites」加上 `http://localhost:5173/*` 與 `https://luminous-moxie-07a76c.netlify.app/*`；②`API restrictions` 只勾 Places API 與 Maps JavaScript API；③放進 `.env` 的 `VITE_GOOGLE_MAPS_API_KEY`；④接 `ActivityFormModal.vue` 的地點欄位。**若之後正式網域再換掉，這把金鑰的網域限制也要一併更新**。 |

### 背景：現況與目標架構的落差（2026-08-12 盤點，僅供歷史對照）

README 裡規劃的「語音/影片/圖片/文字 → Gemini 分析 → Cloud Run 組裝 PDF/Word/Excel」在盤點當下**完全還沒實作**：沒有後端、沒有 GCS、沒有 Gemini、沒有 auth/ACL，前端直接用瀏覽器端 Parse SDK 讀寫 Back4App。上述落差目前只剩 **Phase 3b 的部署**還沒完成，程式碼已於 2026-09-17 補上，狀態以上方表格為準。

---

## 資安檢視（依 ISO 27001 Annex A 對照）

針對前端 Vue SPA、Back4App/Parse 後端、Cloud Run 中介層、Cloud Code 做的程式碼層級檢視。**範圍限制**：ISO 27001 是管理系統標準，正式合規還需要風險評估文件、資產清冊、事件應變計畫、供應商合約（Back4App／GCP 的 DPA）等組織面文件，這些無法從程式碼判斷，以下只涵蓋能從原始碼驗證的技術控制項（A.8 為主）。首次檢視 2026-09-04，複查 2026-09-17（複查結論已併入下表「狀態」欄）。

| # | 風險 | 對應控制項 | 狀態 |
| --- | --- | --- | --- |
| 1 | 🔴 高｜Cloud Run 端點缺少物件層級授權——只驗證「是不是已登入的 Parse 使用者」，沒驗證檔案是否屬於該使用者有權存取的活動 | A.8.3／A.5.15 | ✅ **已修正並部署上線**（09-04，revision `00006-qlz`）——`server/parse_auth.py` 新增 `activity_exists()`／`find_generation_job_for_object_path()`，改用呼叫者 session token 查詢授權；已用真實資料實測 4 種情境全部正確。**09-17 複查程式碼仍成立。** |
| 2 | 🔴 高｜**Parse CLP 無角色分級**——`cloud/main.js` 註解明講「CLP 開放給所有登入使用者讀寫」，沒有 row-level ACL 或 viewer/editor/admin 區分 | A.5.15／A.5.18 | ⬜ **未處理**。09-17 複查仍未修正。需要你先決定角色設計（例如現有 3 人是否都要保留完整讀寫權限）才能動手，不宜自行決定。 |
| 3 | 🟠 中｜檔案上傳無型別／大小限制 | A.8.7／A.8.28 | ✅ 前端＋Cloud Run 端已修正生效（`fileUploadRejectionReason()` 50MB 上限＋副檔名黑名單；`/signed-url` 也加了副檔名檢查）。🟡 **`cloud/main.js` 的同款檢查要貼回 Back4App Dashboard 才生效，09-17 仍無法確認線上版本是否已包含**（見下方「部署落差」）。 |
| 4 | 🟠 中｜相依套件已知漏洞（npm） | A.8.8 | 🟡 **部分完成**——`nanoid` 已升到 3.3.18（高風險已解）。`ws`（經 `parse` SDK，高）與 `uuid`（經 `exceljs`，中）**09-17 複查仍未解決**，需 `npm audit fix --force` 換主版本（`parse@3.4.2`／`exceljs@3.4.0`），會影響登入與匯出功能，需你確認是否接受 breaking change。 |
| 5 | 🟠 中｜相依套件已知漏洞（Python，`fastapi`/`starlette`） | A.8.8 | 🟡 **程式碼已修正**（`requirements.txt` 已是 `fastapi==0.141.1`／`starlette` 新版，09-17 直接讀檔確認），本機 `TestClient` 測試通過。**部署到 Cloud Run 的狀態原始記錄前後矛盾**（09-04 記錄一度寫「已部署上線 revision `00008-rmc`」，又寫「尚未部署，等你確認後再跑 `gcloud run deploy`」），09-17 沒有 `gcloud` 存取權限核對，**需要你跑一次 [OPERATIONS.md](OPERATIONS.md) 的健康檢查指令確認線上 revision 是否已含這次升級**。 |
| 6 | 🟠 中｜缺應用層稽核紀錄 | A.8.15／A.8.16 | ✅ **已修正並部署上線**（09-04）——`server/main.py` 新增 `audit_log`，對敏感操作與 401/403/429 拒絕都記錄；已在 Cloud Logging 實測確認。 |
| 7 | 🟠 中｜`ALLOWED_ORIGIN` 預設 fail-open | A.8.20／A.8.26 | ✅ **已修正並部署上線**（09-04）——未設定會直接啟動失敗（`RuntimeError`），不再靜默放行所有來源。 |
| 8 | 🟡 低｜Cloud Run 容器以 root 執行 | A.8.9 | ✅ **已修正並部署**（09-04）——新增 `useradd appuser` + `USER appuser`。 |
| 9 | 🟡 低｜無速率限制 | A.8.16 | ✅ **已修正（輕量版）並部署**（09-04）——每使用者每分鐘 30 次記憶體內限流，超過回 429；已對正式網址實測 32 次連續請求驗證。**已知限制**：狀態不共享、重啟歸零，多 instance 下不是精確硬上限，只拉高濫用門檻。 |

**已符合的作法**（值得保留，不需要動）：`PARSE_MASTER_KEY` 存於 Secret Manager、非明文環境變數；Signed URL 用 IAM 自我模擬簽章且 15 分鐘短效期；`.env` 正確被 `.gitignore`、全 git 歷史掃描未發現硬編碼金鑰；`objectPath` 有路徑穿越（`..`）與前綴白名單檢查；Cloud Code `beforeSave` 對前端請求做了伺服器端二次驗證；前端無 `v-html`／`innerHTML` 等 XSS 注入點。

### ⬜ 部署落差（無法從程式碼確認，2026-09-17 新發現）

`cloud/main.js` 的每一版修正（CLP 相關驗證、上傳大小/副檔名檢查、Category `beforeSave`）都要**手動貼回 Back4App Cloud Code Dashboard** 才會生效；程式碼裡有修正**不代表**正式環境已經套用。目前沒有 Back4App Dashboard 存取權限，無法確認線上實際執行的是哪一版 `cloud/main.js`。**建議每次貼回 Dashboard 後在這份文件記錄日期**，方便之後對照。

### 資安待辦優先序

1. **Parse CLP 角色分級**——⬜ 還沒動，需要先確認角色設計才能動手。
2. **`exceljs`／`parse` SDK 的 breaking change 升級**（解 `uuid`／`ws` 漏洞）——⬜ 需要你確認是否接受主版本升級風險。
3. **確認 `cloud/main.js` 與 Python 套件升級的實際部署狀態**——⬜ 需要你核對 Back4App Dashboard 與 Cloud Run 線上 revision。

---

## 帳號與帳單異動（換卡、換使用權人）

情境：GCP 專案與 Back4App app 本身**不搬家**（Project ID、App ID、Service Account、Bucket 名稱都保留），只是要**換付款信用卡**、以及**換掉有使用權限的人**。這純粹是後台帳號設定，不動程式碼、不用重新部署，跟前面「整個換新帳號重建專案」（工作量大很多）是完全不同層級的事。

### Google Cloud

- **換信用卡**：主控台 → 帳單 → 付款方式 → 新增新卡片 → 設為預設 → 移除舊卡片。
- **換使用權的人**：IAM 與管理 → IAM → 新增成員（新 email）→ 給 Owner 或需要的角色；舊帳號角色降級或移除。
- Project ID、Service Account（`GCS_SIGNING_SERVICE_ACCOUNT` 等）、Bucket 名稱都不會變，`.env` 不用動。

### Back4App（Parse）

- **換信用卡**：Account Settings → Billing → 更新付款方式。
- **換使用權的人**：進到這個 App → App Settings → Collaborators → 邀請新 email，設為 Admin；新帳號接受邀請後把舊帳號移除或降權。
- App ID／JS Key／Master Key 都不會變，`.env` 不用動。

### 注意事項

1. Back4App 若目前是舊帳號的付費方案，換卡前先確認舊卡到期/移除的時間點不會導致服務中斷。
2. GCP 帳單帳戶若換成別人持有，該帳號需要「帳單帳戶管理員」角色，跟專案的 IAM 角色是分開設定的兩個地方。
3. 若舊帳號之後要整個移除存取權，記得先確認沒有東西是綁定「舊帳號個人身分」而非服務帳號在跑（例如本機開發用 `gcloud auth login` 登入的是舊帳號，之後要換成新帳號重新登入）。

---

## 近期功能更新（2026-09-17）

1. **活動照片匯出排版**（`src/utils/download.ts`）——✅ 程式碼已完成。`buildNeimuReportDocx` 的活動照片區塊，從原本一張張直向堆疊，改成 2 欄表格排版，照片統一縮放到高度 5cm（無邊框、居中，圖說在照片下方），符合 PDF 範例的呈現方式。
2. **地點串接 Google Map**（`src/utils/activity.ts`、`ActivityFormModal.vue`、`DetailView.vue`）——✅ 程式碼已完成。新增 `googleMapsUrl()` 輔助函式；建立/編輯活動表單的「地點」欄位旁，有填值時會出現「地圖」按鈕開新分頁搜尋；活動詳情頁的地點文字也直接變成可點的地圖連結。
3. **活動分類可自訂管理**（新增 `src/models/Category.ts`、`src/views/CategoriesView.vue`，以及 `types.ts`／`stores/db.ts`／`ActivityFormModal.vue`／`ExportView.vue`）——✅ 程式碼已完成。新增一個「分類管理」頁面（側邊選單、路由 `/categories`），可自由新增／改名／刪除分類，取代原本寫死的 5 個選項。設計上刻意讓活動的 `categories` 欄位繼續存純文字（不是像「計畫」那樣存參照 id）——調整分類清單（改名/刪除）不會影響已建立活動上已記錄的分類文字，只影響往後新增/編輯活動時看到的選項。第一次讀取時，若 Back4App 的 Category 集合還是空的，會自動用舊的 5 個分類名稱當種子建立。

### ⬜ 待你手動完成的部署步驟（跟以前改 `cloud/main.js` 一樣的流程）

- 把更新後的 `cloud/main.js` 貼回 Back4App Cloud Code Dashboard（分類驗證已改成檢查格式而非固定清單，並新增了 Category class 的 `beforeSave`）。
- 到 Back4App 把新的 Category class 的 Class-Level Permissions 設成跟 Plan/Activity 一樣的 `requiresAuthentication`。

---

## 附錄：原始規劃背景（僅供歷史對照，執行狀態以上方章節為準）

### Phase 0 — 安全前提（阻塞項，必須先做）

在接上任何會計費的 GCP 資源之前，先補上 Parse 使用者驗證（Parse User + ACL）。這件事排在 GCP 整合之前，不是之後。

### Phase 1 — 建立可信的後端邊界

前端直接握有 Parse App ID/JS Key 已經是妥協，加一個單一的 Cloud Run 服務當「可信中介層」：前端向 Cloud Run 要 GCS Signed URL；Cloud Run 是唯一持有 GCP 服務帳戶金鑰的地方；Cloud Run 用 Parse Master Key 把生成結果寫回 Parse。

### Phase 2 — 資料模型異動

新增一個 `GenerationJob` Parse class，而不是硬塞進 `Activity` 現有欄位：`activity`（指標）、`kind`、`status`（pending/processing/done/error）、`sourceFiles`、`resultFile`。「使用者上傳原始素材 → AI 生成」跟現有的 `photoFiles`/`audioFiles`（單純附件保存）分開，不會互相污染。

### Phase 3 — 前端串接方式

新增一個「AI 自動生成成果報告」的入口：①上傳素材建立 `GenerationJob` ②前端輪詢 job 狀態 ③完成後提供真正檔案下載。現有的簽到表/領據/CSV 匯出保持純前端不動，不需要牽動 GCP。

### 附帶項目：模板輸出格式修正（與 GCP 無關）

既然確認輸出格式要是「真正的」PDF/Word/Excel，現有 `downloadFile()` 原本產生的其實是改副檔名的 HTML。已用前端函式庫（`docx`、`exceljs`）把簽到表/領據這幾個模板升級成真格式，不需要等後端
