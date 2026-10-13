# 智慧活動管家：功能升級實作規劃

依《智慧活動管家_功能升級規劃.docx》對照現有程式碼整理，作為修改網站的工作依據。現況與部署見 [ROADMAP.md](ROADMAP.md)。

> 建立：2026-10-13｜狀態：第一批已上線（2026-10-13），見下方「進度」

## 進度

| 項目 | 狀態 | 修改檔案 |
| --- | --- | --- |
| 1-6 成效統計表 Excel | ✅ 10-13 上線（前端） | 新增 `src/utils/outcomeStats.ts`；`src/views/ExportView.vue` 加「成效統計表 Excel」勾選與預覽統計卡 |
| 2-4 規則式防呆 | ✅ 10-13 上線（前端） | `src/utils/activity.ts`（`checkBasicInfo`／`checkResults`）；`ActivityFormModal.vue`、`DetailView.vue`（成果補充）即時列出提醒，存檔前確認；`ConfirmDialogHost.vue` 訊息支援換行 |
| 1-1 AI 改寫文案 | 🟡 10-13 上線（Cloud Run `00019-86n`）；⬜ 正式站實際產生一次並核對內容 | 新增 `server/rewrite.py`、`POST /rewrite/{activityId}`（`server/main.py`）、`get_plan_names()`（`server/parse_auth.py`）；前端新增 `src/components/RewriteModal.vue`、`requestRewrite()`（`src/lib/middleware.ts`），詳細頁「AI 改寫文案」按鈕 |
| 1-2 簽到表辨識 | 🟡 後端 10-13 上線（`00020-8jn`）；前端 10-13 上線；⬜ 用真實手寫簽到表測準確度 | 新增 `server/assist.py`、`POST /assist/sign-in`；前端 `SignInReviewModal.vue`（詳細頁「簽到表」卡片的按鈕）、`src/utils/aiImages.ts`、`db.saveAttendance()` |
| 2-1 海報帶入 | 🟡 10-13 上線；⬜ 用真實海報實測 | `POST /assist/poster`；前端 `PosterAssist.vue`（建立活動表單上方） |
| 2-2 分類／計畫推薦 | 🟡 10-13 上線；⬜ 正式站實測 | `POST /assist/classify`、`list_names()`（`server/parse_auth.py`）；前端 `ClassifySuggest.vue`（表單計畫／分類下方） |

**第二批設計**
- 圖片在瀏覽器先縮到長邊 2400px 的 JPEG，以 base64 隨請求送出、不存檔（建立活動時還沒有 activityId；舊的 Back4App 附件也能一併處理）。PDF 簽到表用既有的 `renderPdfPages` 轉圖。後端限制 JPEG／PNG／WebP、單張 5 MB、簽到表最多 6 張。
- 簽到表：模型只回名單（單位／職稱／姓名／性別／是否不確定），**人數由前端依名單計算**；解析度固定 `HIGH`（手寫小字）。對照畫面左原圖、右可編輯表格，不確定列標黃；勾選「更新與會人數」「更新與會單位」後才寫入，仍有不確定列時再確認一次。
- 海報：今天日期由前端帶入，讓「10/18」這類沒寫年份的日期補對年份。結果逐欄列出「建議值（目前值）」，表單已有值的欄位預設不勾。海報上的活動簡述會一併給分類推薦參考。
- 分類推薦：後端用呼叫者 session 讀現有 Category／Plan 清單，模型只能從清單挑，清單外的名稱一律丟棄；結果以「＋計畫／＋分類」標籤顯示，點了才加入。

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

## 現況盤點

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| AI 生成 | 只有「成果報告」一種，素材（照片／錄音／影片／文件）→ Gemini 回 `summary`／`highlights`／`kpis` → 組 `.docx` | `server/report.py`、`server/main.py` `/generate/{job_id}`、`src/components/AiGenerationModal.vue` |
| `GenerationJob.kind` | 型別只有 `'成果報告' \| '其他'` | `src/types.ts:206` |
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
- **同步改**：`src/types.ts` 的 `GenerationJobKind`、`cloud/main.js` 的 `GenerationJob` 驗證、`server/parse_auth.py` 預設值；`cloud/main.js` 改完要手動貼回 Back4App 並記入 ROADMAP 部署紀錄。

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
| 注意 | 長錄音費用高：前端顯示預估長度、限制單檔長度（建議先 90 分鐘）；Cloud Run timeout 900 秒需實測 2 小時錄音是否跑得完，不行就改分段。 |

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
| 做法 | 純前端，不需 AI。`ExportView.vue` 加「成效統計表」：依篩選條件彙整場次、總人數、男女、各分類／計畫小計，用 `exceljs` 產出。另把 ROADMAP 待辦 8：AI 報告加 Excel 輸出一併處理。 |
| 前置 | ⚠️ 需各單位**公版表格**，依公版欄位排版（同 `buildLedgerXlsx` 做法）。 |
| 位置 | `src/utils/download.ts` 新增 `buildOutcomeStatsXlsx()`、`ExportView.vue` |

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

每批上線流程同 ROADMAP：Cloud Run 部署 → `cloud/main.js` 貼回 → schema 同步 → push main 自動部署前端 → 正式站實測 → 記入 ROADMAP 部署紀錄。

---

## 待團隊決定

- [ ] 新聞稿、社群文案、主管摘要的**標準範本**（1-1）
- [ ] 成效統計 Excel 的**各單位公版表格**（1-6）
- [ ] 結案報告格式依哪個補助單位（3-1）
- [ ] 錄音／影片檔案大小與長度上限，是否放寬 50 MB（1-3、1-4）
- [ ] 週報寄送管道：Email、LINE 或只放總覽頁（3-3）
- [ ] Gemini 每月預算上限（目前預算警示只寄信、不會自動停用）
