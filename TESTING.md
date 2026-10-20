# TCROSS 測試計畫

2026-10-19 · 雅婷（10-20 更新：資料庫搬到 GCP 期間的測試環境）　｜　線上協作版：[TCROSS 測試計畫](https://claude.ai/code/artifact/c0784b6e-b08a-46f0-ab04-0c049db17d0e)

## 目的與範圍

這份文件定義 TCROSS 活動平台要測什麼、用什麼方法測、誰來測，目標是讓每次上線前都有一套可重複執行的檢查，而不是靠記憶手動點過。

涵蓋範圍是整個 `TCROSS/` 專案的四個部分：

| 部分 | 位置 | 技術 |
| --- | --- | --- |
| 前端網站 | `src/` | Vue 3 + Vite + Pinia + TypeScript |
| AI 中介層 | `server/` | Python，部署在 Cloud Run，呼叫 Vertex AI Gemini |
| 雲端函式 | `cloud/main.js` | Parse Cloud Code（目前跑在 Back4App；切換後由自架 Parse Server 執行，同一份檔案） |
| 自架 Parse Server | `parse-server/` | Node，部署在 Cloud Run `tcross-parse`，資料庫是 Firestore MongoDB 相容模式（搬移中，見 [parse-server/README.md](parse-server/README.md)） |
| 維運腳本 | `scripts/` | Node 腳本：備份、還原、附件搬移、帳號與 schema 同步 |

不在範圍內：Back4App、Google Cloud、Google Maps 等第三方服務本身的可用性。

## 測試環境（10-20 起，資料庫搬到 GCP 期間）

| 環境 | 網址 | 資料庫 | 用來測 |
| --- | --- | --- | --- |
| **測試網址** | `https://tacc-iip--parse-test-wsf5d7qa.web.app`（Firebase 預覽頻道，10/27 10:42 失效，要延長就重新部署） | 新伺服器 `tcross-parse`（正式切換後就是正式站） | 前端主線、端到端；寫入的資料切換時會清掉重匯，可以放心新增刪除 |
| 正式站 | `https://tacc-iip.web.app` | Back4App（切換前） | 中介層、AI 功能；附件上傳 |

測試網址目前**不能**測附件與 AI：前端會呼叫 Cloud Run 中介層，而中介層還在向 Back4App 驗證登入，也不認得預覽網址。這兩類要等正式切換後在正式站測（下方檢查表標「切換後」的項目）。

為什麼前端以測試網址為主：切換後測試網址背後的伺服器就是正式站，現在在 Back4App 上測，切換後還得重測。單元測試（TC-01～37）不連任何網站，跟環境無關。

## 現況

全站目前沒有任何自動化測試，也沒有 CI。`package.json` 只有 `dev`、`build`、`preview` 三個指令，`server/` 沒有 pytest。唯一自動的把關是 `build` 時 `vue-tsc` 的型別檢查。

現在實際在用的手動把關：

- **部署後健康檢查**：curl `/status`，再帶 session token 打 `/signed-url`、`/download-url`（見 [OPERATIONS.md](OPERATIONS.md)、[server/README.md](server/README.md)）。
- **範本修改**：`npm run dev` 後到「匯出成果」實際匯出，打開檔案核對。
- **Cloud Code**：手動貼到 Back4App，沒有任何驗證步驟。切換後改由 `parse-server/scripts/deploy.sh` 部署，`node parse-server/scripts/smoke-test.mjs <備份資料夾>` 會以成員身分跑 15 項檢查（登入、CLP、Cloud Code 驗證、稽核紀錄）。
- **備份還原演練**：10-05 還原到 `TCROSS-restore-test`，2058 個欄位 0 差異。
- **搬家演練**：10-20 把 Back4App 備份匯入新伺服器，9606 個欄位 0 差異；`smoke-test.mjs` 15 項全過；瀏覽器在測試網址走過新增→改計畫→封存→解除封存→刪除活動、新增刪除計畫與分類，稽核紀錄全部正確。

[ROADMAP.md](ROADMAP.md) 裡跟測試有關的 #3、#4、#5、#7 都已過 10/15 期限、仍未完成，而 10/31 要驗收交付。所以這份計畫分兩步：先用手動檢查表撐過驗收，再逐步補上自動化測試。

## 測試對象與風險

風險最高的是「匯出檔內容錯了沒人發現」和「權限或驗證規則被改壞」，這兩類都不會報錯、只會安靜地出錯，所以優先寫測試。

| 模組 | 主要檔案 | 做什麼 | 出錯的後果 | 優先 |
| --- | --- | --- | --- | --- |
| 匯出文件 | `src/utils/download.ts`、`outcomeStats.ts` | 簽到表、活動紀錄、領據、公文、大事紀、內政部結案、成果統計 | 金額大寫、民國日期、人數錯了直接交到主管機關 | P0 |
| 缺漏檢核 | `src/utils/activity.ts` | 評分、月統計、日期不符提示、基本資料檢查 | 該提醒的沒提醒 | P0 |
| Cloud Code 驗證 | `cloud/main.js` | 封存鎖定、欄位格式、附件來源與大小、操作者蓋章、AuditLog 不可改 | 髒資料寫入、稽核紀錄可偽造 | P0 |
| Cloud Run 驗證與工具函式 | `server/main.py`、`utils.py`、`parse_auth.py` | session 驗證、限流、檔名與路徑檢查、附件刪除參照檢查 | 未登入者取得檔案、誤刪附件 | P0 |
| AI 成果報告 | `server/report.py`、`document.py`、`charts.py` | Gemini 分析後組裝 docx/pdf、畫圖 | 報告缺段、中文亂碼、圖表數字錯 | P1 |
| AI 輔助 | `server/assist.py`、`rewrite.py` | 簽到表辨識、海報轉欄位、分類建議、文件摘要、改寫 | 建議不準（使用者會確認，影響較小） | P2 |
| 前端資料轉換 | `src/models/`、`utils/registration.ts`、`actor.ts` | Parse 物件與前端資料互轉、報名 CSV 解析 | 欄位遺失或存錯 | P1 |
| 頁面流程 | `src/views/`、`components/` | 登入、活動增修、上傳、AI 生成、匯出 | 使用者卡住 | P1 |
| 維運腳本 | `scripts/` | 備份、還原、schema 與角色同步 | 備份無法還原 | P2（靠定期演練） |

## 測試策略

以單元測試為主：風險最高的匯出與驗證邏輯幾乎都是純函式，不用連線就能測，成本最低。會花錢或寫入正式資料的部分（Gemini、GCS、Parse）一律用 mock，只在手動驗收時碰真服務。

| 層級 | 工具 | 測什麼 | 何時跑 |
| --- | --- | --- | --- |
| 前端單元 | Vitest（與 Vite 共用設定） | `src/utils/`、`src/models/` 的純函式；匯出檔用 exceljs / JSZip 解開後斷言內容 | 每次 commit、部署前 |
| 後端單元 | pytest | `server/utils.py`、`charts.py` 的純函式；`document.py` 產出後用 python-docx 讀回來比對 | 每次部署 Cloud Run 前 |
| 後端整合 | pytest + FastAPI TestClient，mock Parse / GCS / Gemini | 各端點的 401 / 403 / 429、參數驗證、正常路徑的回傳格式 | 每次部署 Cloud Run 前 |
| Cloud Code | Node 測試把 `cloud/main.js` 載入假的 `Parse.Cloud`，直接呼叫 beforeSave | 封存鎖定、欄位規則、附件來源、操作者蓋章 | 貼到 Back4App 前 |
| 端到端 | Playwright（第二階段再做） | 登入 → 新增活動 → 上傳 → 匯出的主線 | 每週或大改版前；切換前對測試網址跑（上傳除外），切換後對正式站跑 |
| 手動驗收 | 檢查表（見下方「部署後手動回歸檢查」） | 真的 Gemini 生成、PDF 中文、圖表、CSP | 每次部署後 |

端到端測試原本規劃用還原演練的 `TCROSS-restore-test`（Back4App），搬到 GCP 後它已不代表正式環境，改用上方「測試環境」的測試網址。測試帳號用 `Test123`（新伺服器上的密碼在 `backups/passwords-current.json`，不進 git）；測試資料名稱請加「【測試】」並在結束時刪除。

## 測試案例清單

共 39 個案例，其中 P0 有 25 個，要在 10/31 驗收前完成。狀態欄請改成：未開始／撰寫中／通過／失敗。

### 匯出文件（前端單元，`src/utils/download.ts`、`outcomeStats.ts`）

| 編號 | 案例 | 預期結果 | 優先 | 狀態 |
| --- | --- | --- | --- | --- |
| TC-01 | `buildCsv` 收到以 `=` `+` `-` `@` 開頭的文字 | 前面補 `'`，Excel 不會當成公式執行 | P0 | 通過 |
| TC-02 | `buildCsv` 欄位內含雙引號、逗號 | 雙引號轉成 `""`，整欄用引號包起來 | P0 | 通過 |
| TC-03 | `toChineseUpperAmount` 收到 0 或負數 | 回傳空字串 | P0 | 通過 |
| TC-04 | `toChineseUpperAmount(10050)` | 萬與伍拾之間補「零」 | P0 | 通過 |
| TC-05 | `toChineseUpperAmount` 收到小數 | 無條件捨去到整數 | P0 | 通過 |
| TC-06 | `formatRocChinese('2025-01-03')`；不合法日期 | `114年1月3日`；空字串 | P0 | 通過 |
| TC-07 | `buildReceiptXlsx` 產檔後用 exceljs 讀回 | 金額、國字大寫金額、日期儲存格都正確 | P0 | 通過 |
| TC-08 | `buildSignInSheetDocx` 每種 `SIGN_IN_LAYOUTS` 各產一份，用 JSZip 解開 | 都能產出，內容含活動名稱與日期 | P0 | 通過 |
| TC-09 | 大事紀照片挑選：有標記精選與沒標記各一組 | 有精選只取精選，最多 3 張 | P1 | 通過 |
| TC-10 | `computeOutcomeStats` 給固定活動清單 | 場次、男女與總人數、各計畫分組加總正確 | P0 | 通過 |

### 缺漏檢核與資料解析（前端單元，`src/utils/activity.ts`、`registration.ts`）

| 編號 | 案例 | 預期結果 | 優先 | 狀態 |
| --- | --- | --- | --- | --- |
| TC-11 | `gaps` 收到資料齊全的活動 | 回傳空陣列，`score` 為 100 | P0 | 通過 |
| TC-12 | 分別缺計畫、照片不足、圖說空白、無簽到表與紀錄、摘要空白 | 各回報一條，`score` 每缺一項扣 20 | P0 | 通過 |
| TC-13 | `averageScore([])` | 回傳 0 | P1 | 通過 |
| TC-14 | `dateMentionMismatches`：內文寫「10/18(六)」但實際不是週六；內文有「（一）」條列編號 | 前者回報不符；後者不誤報 | P0 | 通過 |
| TC-15 | `checkBasicInfo` 傳入固定的 `today` | 日期相關提醒穩定，不隨執行當天改變 | P1 | 通過 |
| TC-16 | `parseCsv`：引號內有逗號、換行、`""` | 正確切成欄位 | P1 | 通過 |
| TC-17 | 報名表表頭用「名字／職務／服務處」等別名 | 都辨識成姓名、職稱、單位 | P1 | 通過 |

### Cloud Code 驗證（`cloud/main.js`）

| 編號 | 案例 | 預期結果 | 優先 | 狀態 |
| --- | --- | --- | --- | --- |
| TC-18 | 編輯或刪除已封存（`archivedAt`）的活動 | 被拒 | P0 | 通過 |
| TC-19 | 非 master 新增、修改、刪除 AuditLog | 被拒 | P0 | 通過 |
| TC-20 | Activity 名稱空白或超過 200 字、人數負數、日期不是 YYYY-MM-DD | 各自被拒 | P0 | 通過 |
| TC-21 | 附件 url 不是 `gcs:attachments/` 也不是原有的；單檔超過 50MB；大事紀照片超過 3 張 | 各自被拒 | P0 | 通過 |
| TC-22 | 前端送出偽造的建立者／修改者 | 被伺服器以實際登入者覆蓋 | P0 | 通過 |
| TC-23 | 非 master 新建 status 不是 pending 的 GenerationJob；建立後改 activity | 被拒 | P0 | 通過 |
| TC-24 | 非 master 修改 `_User` 的 username | 被拒 | P1 | 通過 |

### Cloud Run 中介層（pytest，`server/`）

| 編號 | 案例 | 預期結果 | 優先 | 狀態 |
| --- | --- | --- | --- | --- |
| TC-25 | `sanitize_filename('測試照片.png')` | 保留 `.png` 副檔名 | P0 | 通過 |
| TC-26 | `is_extension_blocked('evil.exe.')` | 回傳 True | P0 | 通過 |
| TC-27 | `is_valid_object_path` 收到含 `..` 或不是 `activities/` 開頭的路徑 | 回傳 False | P0 | 通過 |
| TC-28 | `is_content_type_allowed('image/svg+xml')` | 回傳 False | P0 | 通過 |
| TC-29 | `parse_attachment_path` 收到不在允許清單的資料夾 | 回傳 None | P1 | 通過 |
| TC-30 | 各端點不帶 token 或帶無效 token | 回 401 | P0 | 通過 |
| TC-31 | 同一人一分鐘內第 31 次呼叫 | 回 429 | P1 | 通過 |
| TC-32 | 對自己讀不到的活動要上傳或下載網址 | 回 403 | P0 | 通過 |
| TC-33 | `/attachments/delete` 刪除仍被其他活動引用的檔案 | 不刪除該物件 | P0 | 通過 |
| TC-34 | `/generate` 遇到處理中但未逾時的 job；遇到已逾時的 | 前者不重跑；後者可重跑 | P1 | 通過 |
| TC-35 | `render_docx` 給固定 Block 清單，用 python-docx 讀回 | 段落順序與文字一致 | P1 | 通過 |
| TC-36 | `build_report` 給固定 analysis（mock Gemini） | 產出的 Block 包含所有必要章節 | P1 | 通過 |
| TC-37 | `headcount_of` 男女或總數缺值 | 不出錯，數字合理 | P1 | 通過 |

### 端到端（Playwright，切換前對測試網址、切換後對正式站）

| 編號 | 案例 | 預期結果 | 優先 | 狀態 |
| --- | --- | --- | --- | --- |
| TC-38 | 未登入開 `/`；已登入開 `/login` | 前者導向 `/login`；後者導向 `/dashboard` | P1 | 通過 |
| TC-39 | 新增活動 → 上傳照片 → 到「匯出成果」下載 ZIP | ZIP 內含該活動的照片與文件 | P1 | 受環境限制（要上傳，切換後再測） |

## 部署後手動回歸檢查

自動化測試補齊之前，每次部署後照這張表走一遍。指令細節見 [OPERATIONS.md](OPERATIONS.md) 與 [server/README.md](server/README.md)「驗證部署是否正確」。

每項後面標的是**在哪裡測**：「測試網址」＝上方測試環境的預覽網址；「正式站」＝`tacc-iip.web.app`；「切換後」＝要等資料庫正式切換到 GCP（中介層也改指向新伺服器）才能測。正式切換完成後，全部項目都在正式站測，這些標記就可以拿掉。

**自架 Parse Server（改到 `parse-server/` 或 `cloud/main.js` 時）**

- [ ] curl `https://tcross-parse-502746951565.asia-east1.run.app/health`，回傳 `{"ok":true}`
- [ ] `node parse-server/scripts/smoke-test.mjs <已匯入的備份資料夾>`，15 項全過（會留下一筆登入與新增＋刪除的稽核紀錄）
- [ ] 全新的 Firestore 資料庫第一次部署前，先在本機跑一次 `node index.js` 把索引建好，否則會超過 Cloud Run 4 分鐘啟動上限（見 [parse-server/README.md](parse-server/README.md)）

**Cloud Run 中介層**（正式站）

- [ ] curl `/status`，回傳 `{"ok": true}`
- [ ] `gcloud run services describe` 確認運行中的是剛部署的 revision
- [ ] 帶 session token curl `/signed-url`、`/download-url`，各成功一次（無 body 的 POST 要加 `-d ''`）
- [ ] 不帶 token 再打一次，確認回 401
- [ ] 用 `gcloud logging read` 查 `rejected`，沒有非預期的 401 / 403 / 429

**前端主線（用 `Test123` 登入）**

- [ ] 登入後進儀表板，活動列表與缺漏分數正常顯示（測試網址）
- [ ] 新增一筆活動 → 改對應計畫 → 封存 → 解除封存 → 刪除，「操作紀錄」頁每一步都有記到（測試網址；10-20 已走過一次，全部正確）
- [ ] 新增、刪除一個計畫與一個分類（測試網址；10-20 已走過一次）
- [ ] 新增一筆活動、上傳一張照片，重新整理後照片仍在（**切換後**）
- [ ] 「匯出成果」各匯出一次簽到表、領據、大事紀，打開檢查金額大寫、民國日期（測試網址）；照片是否正確帶入（**切換後**，測試網址載不到照片）
- [ ] 瀏覽器 Console 沒有 CSP 違規訊息（測試網址會看到中介層連線被擋，屬預期；切換後在正式站再確認一次）

**AI 功能（會花 Gemini 費用，只在改到 `server/` 或 AI 相關前端時跑；正式站，切換後再跑一次）**

- [ ] 產一份成果報告：Word 與 PDF 都能下載，PDF 中文不亂碼、圖表數字與活動資料一致
- [ ] 產一份會議紀錄
- [ ] 用 AI 改寫一段文案

**清理**

- [ ] 刪除測試建立的活動與附件（AuditLog 會保留紀錄，屬正常）

改 `cloud/main.js` 時，部署後（切換前：貼到 Back4App；切換後：跑 `parse-server/scripts/deploy.sh`）額外手動試：編輯一筆已封存活動，應該被拒。

## 導入時程與分工

建議先集中做 P0：10/20 架好 Vitest 與 pytest，10/28 前完成 25 個 P0 案例，趕在 10/29 Back4App 方案到期與 10/31 驗收之前。P1 與端到端測試排到 11 月。

| 工作 | 期間（2026） | 負責人 |
| --- | --- | --- |
| 架設 Vitest 與 pytest | 10/20–10/21 | 待定 |
| P0 前端單元測試（TC-01–14 中的 P0） | 10/21–10/24 | 待定 |
| P0 後端單元與整合（TC-25–33 中的 P0） | 10/22–10/24 | 待定 |
| Cloud Code 驗證測試（TC-18–24） | 10/24–10/28 | 待定 |
| **節點：Back4App 方案到期** | 10/29 | — |
| **節點：驗收交付** | 10/31 | — |
| P1 案例與端到端（Playwright） | 11/2–11/13 | 待定 |
| 接上 CI 自動執行 | 11/16–11/20 | 待定 |

Cloud Code 測試排在 Back4App 到期前，是為了在搬家或續約前先留下一份驗證規則的規格。日期都是建議值，可以直接改。

待決定：

- [ ] 各階段由誰負責（雅婷、陳怡靜、冠彤如何分工）
- [ ] CI 要接在既有的 GitHub 部署流程裡，還是另外一個 workflow
