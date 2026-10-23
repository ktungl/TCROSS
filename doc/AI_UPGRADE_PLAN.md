# 智慧活動管家：功能升級實作規劃

依《智慧活動管家_功能升級規劃.docx》對照現有程式碼整理，作為修改網站的工作依據。待辦與期限追蹤在 [ROADMAP.md](ROADMAP.md)（AI 功能實測是 #18）。

> 建立：2026-10-13｜最後整理：2026-10-23｜狀態：第一、二批已上線（10-13）；第三批 1-5 公文快讀、1-3 會議錄音整理已上線（10-14）；都還沒用真資料在正式站實測

## 待辦

**1. 正式站實測**（ROADMAP #18；結果記到下方「進度」表，全部通過後刪掉 #18）
- [ ] 簽到表辨識：用一張真的手寫簽到表（含一份 PDF），看名單、性別、人數準不準；黃色「不確定」列標得合不合理
- [ ] 海報帶入：用一張活動海報，核對日期（尤其民國年／只寫月日）、時間、地址
- [ ] 分類推薦：建活動時按一次，看推薦合不合理
- [ ] AI 改寫文案：挑一場成果摘要已填的活動，三種格式各產一次，核對有沒有杜撰
- [ ] 公文快讀：用一份真公文（PDF），核對摘要與「需人工核對」清單
- [ ] 會議錄音整理：用一段真錄音，核對決議／待辦，並看 Cloud Logging 的 `seconds=` 離 900 秒還有多遠
- [ ] 成效統計表：實際下載一份，對照活動列表的數字

**2. 待團隊提供／決定**（見文末「待團隊決定」）
- 新聞稿／社群文案／主管摘要範本 → 改 `server/rewrite.py` 的 `FORMATS`
- 成效統計表公版格式 → 改 `src/utils/outcomeStats.ts`
- 第三批週報寄送管道（Email／LINE／只放總覽頁）

**3. 第三批還沒做的**
1. **3-1 結案報告打包**：擴充 `buildNeimuReportDocx()`（`src/utils/download.ts`）加「總體成果統計」（可直接用 `computeOutcomeStats()`）＋AI 總結段落（後端讀該計畫所有活動的 `summary`／`kpis`，只送文字）
2. **3-3 每週週報**：等寄送管道決定。讀上週 `AuditLog` 彙整；排程用 Cloud Scheduler 觸發 Cloud Run

**部署提醒**：Cloud Run 部署與 push `main` 都要由使用者在提示列用 `!` 自己執行（auto mode 會擋）；部署帳號要用 `--account tainanjade@gmail.com`（預設帳號沒權限）。改到 `cloud/main.js` 時另跑 `bash parse-server/scripts/deploy.sh`。目前運行的 revision 用 [OPERATIONS.md](OPERATIONS.md)「日常健康檢查」的指令查。
```
! gcloud run deploy tcross-middleware --source server --region asia-east1 --service-account tcross-middleware-sa@project-80ac5e1a-2ea4-4000-9ff.iam.gserviceaccount.com --account tainanjade@gmail.com --project project-80ac5e1a-2ea4-4000-9ff --quiet
! git push origin Donna:main
```

## 進度

| 項目 | 狀態 | 修改檔案 |
| --- | --- | --- |
| 1-6 成效統計表 Excel | ✅ 10-13 上線（前端） | 新增 `src/utils/outcomeStats.ts`；`src/views/ExportView.vue` 加「成效統計表 Excel」勾選與預覽統計卡 |
| 2-4 規則式防呆 | ✅ 10-13 上線（前端） | `src/utils/activity.ts`（`checkBasicInfo`／`checkResults`）；`ActivityFormModal.vue`、`DetailView.vue`（成果補充）即時列出提醒，存檔前確認；`ConfirmDialogHost.vue` 訊息支援換行 |
| 1-1 AI 改寫文案 | 🟡 10-13 上線（Cloud Run `00019-86n`）；⬜ 正式站實際產生一次並核對內容 | 新增 `server/rewrite.py`、`POST /rewrite/{activityId}`（`server/main.py`）、`get_plan_names()`（`server/parse_auth.py`）；前端新增 `src/components/RewriteModal.vue`、`requestRewrite()`（`src/lib/middleware.ts`），詳細頁「AI 改寫文案」按鈕 |
| 1-2 簽到表辨識 | 🟡 後端 10-13 上線（`00020-8jn`）；前端 10-13 上線；⬜ 用真實手寫簽到表測準確度 | 新增 `server/assist.py`、`POST /assist/sign-in`；前端 `SignInReviewModal.vue`（詳細頁「簽到表」卡片的按鈕）、`src/utils/aiImages.ts`、`db.saveAttendance()` |
| 2-1 海報帶入 | 🟡 10-13 上線；⬜ 用真實海報實測 | `POST /assist/poster`；前端 `PosterAssist.vue`（建立活動表單上方） |
| 2-2 分類／計畫推薦 | 🟡 10-13 上線；⬜ 正式站實測 | `POST /assist/classify`、`list_names()`（`server/parse_auth.py`）；前端 `ClassifySuggest.vue`（表單計畫／分類下方） |
| 1-5 公文快讀 | 🟡 10-14 上線（Cloud Run `00021-j5x`、前端 `main` = `7b67cc7`）；⬜ 用真公文實測 | `server/assist.py`（`decode_document`、`digest_document`、`MAX_PDF_BYTES`）、`POST /assist/document`；前端 `DocumentDigestModal.vue`（詳細頁「公文」卡片按鈕）、`assistDocument()`、`loadDocumentForAi()`（`src/utils/aiImages.ts`） |
| 1-3 會議錄音整理 | 🟡 10-14 上線（Cloud Run `00022-jmz`、前端 `main` = `c0f6ac3`）；⬜ 用真錄音實測耗時 | `server/report.py`（`analyze_meeting`、`build_meeting_docx`）、`server/main.py`（`GENERATION_KINDS`、`MAX_MEETING_FILES`、依 `kind` 分派、log 記錄耗時秒數）；`cloud/main.js` `GENERATION_JOB_KINDS` 加「會議紀錄」（10-14 當時貼到 Back4App，10-20 起隨 `tcross-parse` 部署）；前端 `GenerationJobKind`、`AiGenerationModal.vue` 加 `kind` prop（會議紀錄只收錄音、讀取長度）、詳細頁「AI 會議音檔轉錄紀錄」按鈕（10-23 由「AI 會議紀錄」改名） |

**第二批設計**
- 圖片在瀏覽器先縮到長邊 2400px 的 JPEG，以 base64 隨請求送出、不存檔（建立活動時還沒有 activityId）。PDF 簽到表用既有的 `renderPdfPages` 轉圖。後端限制 JPEG／PNG／WebP、單張 5 MB、簽到表最多 6 張。
- 簽到表：模型只回名單（單位／職稱／姓名／性別／是否不確定），**人數由前端依名單計算**；解析度固定 `HIGH`（手寫小字）。對照畫面左原圖、右可編輯表格，不確定列標黃；勾選「更新與會人數」「更新與會單位」後才寫入，仍有不確定列時再確認一次。
- 海報：今天日期由前端帶入，讓「10/18」這類沒寫年份的日期補對年份。結果逐欄列出「建議值（目前值）」，表單已有值的欄位預設不勾。海報上的活動簡述會一併給分類推薦參考。
- 分類推薦：後端用呼叫者 session 讀現有 Category／Plan 清單，模型只能從清單挑，清單外的名稱一律丟棄；結果以「＋計畫／＋分類」標籤顯示，點了才加入。

**1-5 設計**：PDF 原檔直接以 base64 送出（Gemini 原生讀 PDF 的文字與版面，不轉圖），上限 10 MB（base64 後約 13 MB，留在 Gemini 單次請求與 Cloud Run 請求上限內）；照片沿用縮圖成 JPEG。後端驗 `%PDF` 檔頭。回傳 `{docType, issuer, docNumber, subject, summary, keyPoints[], checkItems[{category: 期限／預算／法規／其他, item, source}], notes}`，只顯示不存檔；畫面頂端固定加註「AI 摘要僅供掌握方向，法規與預算請核對原文」，可複製成文字。目前綁在活動詳細頁（需要 activityId 驗權限），之後要獨立頁面再把 `activityId` 改成選填。Word 公文請先轉 PDF。

**1-3 設計**：沿用 `GenerationJob`（錄音大，走 Signed URL 直傳 GCS → `/generate`），`kind=會議紀錄`。只收 `audio` 資料夾、最多 3 個檔；前端用 `<audio>` 讀長度，每次合計上限 **60 分鐘**（10-14 決定；`AiGenerationModal.vue` `MAX_MEETING_MINUTES`），讀不出長度的檔案不收。只要結構化紀錄（摘要、與會者、討論重點、決議、待辦 `{task, owner, due}`），不做逐字稿，輸出 token 少。Word 末尾加註「決議、負責人與期限請與主持人確認」。每次完成或失敗都在 Cloud Logging 記 `seconds=`，用來看長錄音離 900 秒還有多遠。**部署順序**：先部署 `cloud/main.js`（`bash parse-server/scripts/deploy.sh`，否則建立會議紀錄工作會被擋）→ Cloud Run → push main。⚠️ 單檔仍受 50 MB 上限：手機 128 kbps 錄音 60 分鐘約 57 MB 會被擋，96 kbps 約 43 MB、64 kbps 約 29 MB 可以（待團隊決定是否放寬，見文末）。

**1-1 設計**：後端用呼叫者的 session 讀活動資料（基本資料、成果摘要、KPI、照片圖說），只送文字給 Gemini，同步回傳 `{title, paragraphs, bullets, hashtags}`；不建 `GenerationJob`、不需改 Cloud Code／schema。前端結果放進可編輯文字框，可複製或下載 Word（瀏覽器端 `docx` 產生）。三種格式的寫法目前是暫定，集中在 `server/rewrite.py` 的 `FORMATS`，團隊提供範本後改那裡。

**防呆規則（只提醒、不擋存檔）**：名稱／參加對象／備註／成果摘要提到的星期、月日、年份與活動日期不符；結束時間早於開始時間；合計人數少於男女加總；日期距今超過一年；日期已過但人數為 0；實體地址看起來是線上會議；線上活動沒填會議連結；KPI「參與人數」類（單位「人」）與合計人數不符。

---

## 目標

- **省去重複行政作業**：同一份活動資料，一鍵產出不同用途的文件。
- **打通成果資料庫**：從「管單場活動」升級到「跨專案彙整、查詢、結案」。

## 共同原則（來自規劃檔第四節「評估建議」）

1. **AI 結果一律先給人確認，不能直接覆寫資料。** 數字類（人數、簽到名單）必須有「原始圖檔 vs. 辨識結果」左右對照畫面，使用者按「套用」才寫入 `Activity`。
2. **先做低學習成本、有感的功能**：報告格式切換、Excel 匯出優先；智慧問答等資料量夠了再做。
3. **沿用現有架構**：AI 一律走 Cloud Run `tcross-middleware` → Gemini（`gemini-2.5-flash`），前端不持有 GCP 憑證；新功能優先擴充 `GenerationJob`，不另開新流程。
4. **費用控管**：沿用 `MAX_SOURCE_FILES`、`media_resolution=LOW`、每人每分鐘 30 次限制；錄音／影片類功能另加長度上限。

---

## 規劃前的現況（2026-10-13）

動工前的盤點，保留作為對照；之後的變動見上方「進度」。

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| AI 生成 | 只有「成果報告」一種，素材（照片／錄音／影片／文件）→ Gemini 回 `summary`／`highlights`／`kpis` → 組 `.docx` | `server/report.py`、`server/main.py` `/generate/{job_id}`、`src/components/AiGenerationModal.vue` |
| `GenerationJob.kind` | 型別只有 `'成果報告' \| '其他'`（10-14 已加「會議紀錄」） | `src/types.ts` |
| 匯出（非 AI） | 大事紀 Excel、內政部結案 Word、簽到表／活動紀錄表／領據／公文 | `src/utils/download.ts`、`src/views/ExportView.vue` |
| 報名表帶入 | 只解析 `.xlsx`／`.csv` 表頭，圖片／PDF 無法帶入 | `src/utils/registration.ts` |
| 活動表單 | 純手動填寫，無 AI 輔助 | `src/components/ActivityFormModal.vue` |
| 總覽 | 活動數、缺漏數、近 6 月場次 | `src/views/DashboardView.vue`、`src/utils/activity.ts` |
| 異動紀錄 | `AuditLog` 已完整記錄誰改了什麼 | `cloud/main.js`、`src/views/AuditLogView.vue` |

---

## 一、一鍵生成多樣化素材（低開發成本）

### 共用改法：把 `GenerationJob` 做成多種輸出

- `kind` 擴充為：`成果報告`／`新聞稿`／`社群文案`／`主管摘要`／`會議紀錄`／`影片亮點`／`文件摘要`／`簽到辨識`。
- `server/report.py`：每種 `kind` 各一組 `_PROMPT` + `_RESPONSE_SCHEMA` + 組檔函式（建議拆成 `server/generators/{kind}.py`，以字典註冊）。
- `server/main.py` `_run_generation()` 依 `job["kind"]` 分派；輸出副檔名依種類（`.docx`／`.xlsx`／`.json`）。
- 前端 `AiGenerationModal.vue` 加「產出類型」選單；結果除了下載檔案，文字類（社群文案、摘要）直接在 `GeneratedDocModal.vue` 預覽並可複製。
- **同步改**：`src/types.ts` 的 `GenerationJobKind`、`cloud/main.js` 的 `GenerationJob` 驗證、`server/parse_auth.py` 預設值；`cloud/main.js` 改完跑 `bash parse-server/scripts/deploy.sh` 部署。

### 1-1 一鍵切換報告格式 ⭐ 第一批

| | |
| --- | --- |
| 做法 | 不必重新上傳素材：以**活動既有欄位**（`name`／`date`／`place`／`summary`／`kpis`／人數）＋已完成的成果報告分析結果為輸入，讓 Gemini 改寫成指定格式。新增 `/rewrite/{activityId}` 或沿用 `/generate` 但 `sourceFiles` 可為空。 |
| 輸出 | 正式成果報告（`.docx`，現有）、新聞稿（`.docx`）、社群文案（純文字，可附 hashtag、字數上限）、主管一頁摘要（`.docx`，一頁） |
| 前置 | ⚠️ 需團隊先提供各通路**標準範本**（新聞稿抬頭、社群字數、主管摘要欄位），寫進 prompt 與組檔函式。 |
| 位置 | `server/report.py`、`AiGenerationModal.vue`、`DetailView.vue` 按鈕 |

### 1-2 手寫簽到表自動辨識

| | |
| --- | --- |
| 做法 | 從 `signInFiles` 選照片 → `kind=簽到辨識` → Gemini 回 `[{unit, title, name, gender?}]` ＋總人數。 |
| 確認畫面 | 新元件 `SignInReviewModal.vue`：左邊原始照片（可放大）、右邊可編輯表格；低信心欄位標黃。按「套用」才寫入 `attendees`／`maleCount`／`femaleCount`／`totalCount`。 |
| 注意 | 小字可能需把 `GEMINI_MEDIA_RESOLUTION` 提到 `MEDIUM`（只對這個 kind）；結果不直接覆寫，保留人工微調。可與 `registration.ts` 的 `Participant` 型別共用。 |

### 1-3 會議錄音整理成紀錄

| | |
| --- | --- |
| 做法 | `mediaFiles` 或 AI 素材的錄音 → `kind=會議紀錄` → 回 `summary`／`decisions[]`／`todos[{task, owner, due}]` → `.docx`。 |
| 注意 | 長錄音費用高：前端顯示預估長度、每次合計限 60 分鐘（10-14 決定）；60 分鐘約 11.5 萬 token，仍需實測耗時是否遠低於 Cloud Run timeout 900 秒。 |

### 1-4 活動影片抓亮點

| | |
| --- | --- |
| 做法 | `kind=影片亮點` → 回 `[{start, end, description}]` → 表格 `.docx` 或直接在頁面列出時間軸。 |
| 注意 | 影片大、上傳慢：沿用 Signed URL 直傳 GCS，顯示上傳進度；檔案上限需另訂（目前 50 MB 不夠用，影片要評估放寬或只開放此 kind）。 |

### 1-5 企劃書／公文快讀

| | |
| --- | --- |
| 做法 | PDF → `kind=文件摘要` → 回重點摘要＋「需人工核對」清單（法規、預算、期限）。 |
| 注意 | 輸出加註「AI 摘要僅供掌握方向，法規與預算請核對原文」。此功能不一定綁活動，之後可考慮獨立頁面。 |

### 1-6 成效報表匯出 Excel ⭐ 第一批

| | |
| --- | --- |
| 做法 | 純前端，不需 AI。`ExportView.vue` 加「成效統計表」：依篩選條件彙整場次、總人數、男女、各分類／計畫小計，用 `exceljs` 產出。AI 報告的 Excel 輸出另見 ROADMAP #13。 |
| 前置 | ⚠️ 需各單位**公版表格**，依公版欄位排版（同 `buildLedgerXlsx` 做法）。 |
| 位置 | 新增 `src/utils/outcomeStats.ts`（`buildOutcomeStatsXlsx()`）、`ExportView.vue` |

---

## 二、表單智慧輔助（中度優化）

都在 `ActivityFormModal.vue` 內加入，需新增 Cloud Run 同步端點（不建 `GenerationJob`，直接回 JSON，幾秒內完成）：`POST /assist/{action}`。

| # | 功能 | 做法 | 確認方式 |
| --- | --- | --- | --- |
| 2-1 | 上傳海報自動帶入 | 海報／邀請函圖片 → 回 `name`／`date`／`time`／`place`／`summary` | 表單上以「建議值」顯示，可一鍵全部套用或逐欄套用；`place` 套用後走既有 Google 地點建議校正 |
| 2-2 | 智慧推薦分類與計畫 | 活動名稱＋簡述 → 從**現有** `Category`／`Plan` 清單中挑選（prompt 傳入清單，只能選不能新造） | 以標籤形式建議，使用者點選才加入 |
| 2-3 | 照片貼標籤與估人數 | 上傳照片時回 `tags[]`／`estimatedCount`／場景描述 | `FileMeta` 新增 `tags?`／`aiCount?`；估計人數只作參考，不寫入正式人數欄位。`HistoryFilesView.vue` 加標籤搜尋 |
| 2-4 | 資料防呆 | 送出前檢查矛盾（內文星期 vs. 日期欄位、人數加總、線上活動有實體地址等） | **規則式檢查先做**（純前端、免費、即時），放 `src/utils/activity.ts`；AI 檢查列為之後再評估 |

**同步改**：`FileMeta` 加欄位要更新 `src/types.ts`、`cloud/main.js` 驗證、`scripts/sync-schema.mjs`。

---

## 三、跨專案數據整合（進階）

| # | 功能 | 做法 | 備註 |
| --- | --- | --- | --- |
| 3-1 | 期中／期末結案報告一鍵打包 | 擴充現有 `buildNeimuReportDocx()`：以計畫為單位撈全部活動，加「總體成果統計」與 AI 撰寫的總結段落（輸入為各活動 `summary`／`kpis`，不重送素材，費用低） | 依計畫補助單位的結案格式，需範本 |
| 3-2 | 說人話查數據（智慧問答） | Gemini function calling：模型把問題轉成結構化查詢條件（日期區間、地區、分類、計畫），**由程式計算**數字後再回答，避免模型自己算錯 | 需先補「地區」欄位（目前只有地址字串）；資料量夠了再做 |
| 3-3 | 每週異動智慧週報 | Cloud Scheduler 每週一早上觸發 Cloud Run → 讀上週 `AuditLog` → 彙整成摘要 → 寄信或顯示在總覽頁 | `AuditLog` 已有，主要工作是排程與寄送管道（Email／LINE 待決定） |

---

## 推動順序

| 階段 | 內容 | 理由 |
| --- | --- | --- |
| **第一批** | 1-6 成效報表 Excel、1-1 報告格式切換、2-4 規則式防呆 | 使用者感受最深、幾乎零學習成本；1-6 與 2-4 不花 AI 費用 |
| **第二批** | 1-2 簽到表辨識（含對照確認畫面）、2-1 海報帶入、2-2 分類推薦 | 直接減少填表時間；建立「AI 建議 → 人確認」的共用 UI 模式 |
| **第三批** | 1-3 會議紀錄、1-5 文件快讀、3-1 結案打包、3-3 週報 | 需評估費用與排程 |
| **之後** | 1-4 影片亮點、2-3 照片標籤、3-2 智慧問答 | 檔案大／維護成本高，等資料累積後再做 |

每批上線流程：Cloud Run 部署 → `cloud/main.js` 部署（`bash parse-server/scripts/deploy.sh`）→ schema 同步 → push main 自動部署前端 → 正式站實測 → 從 ROADMAP 刪掉對應待辦。

---

## 待團隊決定

- [ ] 新聞稿、社群文案、主管摘要的**標準範本**（1-1）
- [ ] 成效統計 Excel 的**各單位公版表格**（1-6）
- [ ] 結案報告格式依哪個補助單位（3-1）
- [ ] 錄音／影片檔案大小與長度上限，是否放寬 50 MB（1-3、1-4）
- [ ] 週報寄送管道：Email、LINE 或只放總覽頁（3-3）
- [ ] Gemini 每月預算上限（目前預算警示只寄信、不會自動停用）
