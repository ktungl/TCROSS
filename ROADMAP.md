# ROADMAP

合照盟計畫資料整合平台的待辦。架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運、費用控制、帳號異動見 [OPERATIONS.md](OPERATIONS.md)。

處理完就刪掉。

> 最後整理：2026-10-20（15:43 已切換到 GCP 自架 Parse Server）。下一個里程碑：**10/31 驗收交付**（部署維運說明技術面已完成，組織面見待辦 10）。

---

## 待辦

依截止時間排序。

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 2 | ⬜ 確認關閉 client class creation | 回滾才需要 | Back4App App Settings「Allow client class creation」要關閉，否則拿到公開 App ID＋JS Key 的人能自己建 class 塞資料（10-19 已刪除權限全開的範例 class `B4aVehicle`）。；新伺服器已設 `allowClientClassCreation: false`，只剩回滾到 Back4App 時才需要。 |
| 3 | ⬜ 匯出格式細節 | 10/15 | 拿實際範本核對抬頭／頁碼／編號。 |
| 4 | ⬜ 實際上傳＋AI 生成實測 | 10/15 | 會寫資料、花 Gemini 費用，在正式網址上跑一次，排在場域測試時。 |
| 5 | ⬜ 附件搬到 GCS 收尾 | 10/15 | 實際下載匯出檔核對照片、團隊實測；場域測試後清除 Back4App 上已搬走的原檔（對照表在 `backups/attachment-migration-2026-10-09T07-59-51.json`）。 |

| 7 | ⬜ 正式站驗證 AI 新功能 | 10/15 | 登入後實際產生一次改寫文案（10-13 上線）；建立第一筆「會議紀錄」，確認 10-14 貼回的 Cloud Code 有生效。 |
| 8 | ⬜ CSP 改正式 | 待辦 4 之後 | 10-05 瀏覽主要頁面 0 個違規，還沒測上傳與 AI 生成／下載。待辦 4 跑過也沒違規，就把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改成正式 `Content-Security-Policy`。 |
| 9 | ⬜ Back4App 方案到期 | 10/29 | 10-20 已切換到 GCP，Back4App 只當備份：到期後降回免費方案即可，不用續約付費。 |
| 10 | ⬜ OPERATIONS.md 組織面 | 10/31 | 值班窗口、通報流程、還原演練週期（建議每季），待團隊補上。 |
| 11 | 🟠 初始密碼可猜 | — | 6 個帳號密碼都是「帳號＋1234」（`Test123` 是 `Test123`），規則可猜，依決定暫不處理；建議請成員自行改密碼，或之後加首次登入強制改密碼。 |
| 12 | ⬜ Back4App 擁有者帳號開 MFA | — | Back4App 後台安全建議：擁有者帳號未啟用兩步驟驗證。（10-20 起 Back4App 只當備份，優先度降低）。 |
| 13 | 🟡 部署 AI 報告 PDF＋圖表 | — | 10-19 程式已改、未 commit：AI 報告（成果報告／會議紀錄）同時產 `.docx` 與 `.pdf`；成果報告加 KPI、性別組成、同計畫各場次人數比較圖；下載拆成 Word／PDF 兩顆按鈕。**順序**：① Cloud Run 先部署（Dockerfile 會下載字型，建置會比較久）② 再合併到 `main` 部署前端（反過來的話，舊後端不認得 `pdf` 參數，PDF 按鈕會下載到 Word）。部署後在正式站產一份成果報告，核對圖表與 PDF 中文。舊工作沒有 PDF，按 PDF 會提示重新產生。Excel 輸出尚未做。 |
| 15 | ✅ 資料庫搬到 GCP | 10-20 完成 | 10-20 15:43 正式切換：Cloud Run `tcross-parse`（自架 Parse Server）＋Firestore MongoDB 相容模式 `tcross`，用當下備份重新匯入（9983 欄位 0 差異），前端、中介層、每日備份都已改指向新伺服器；正式站驗證登入、照片（活動內頁 26／26、歷史檔案 29／29）、AI 報告 Word／PDF 下載、每日備份都正常。Back4App 保留不動當備份，回滾步驟見 OPERATIONS.md。**剩**：在正式站實際產生一次 AI 報告（併入待辦 4）；觀察一週沒問題後可刪 Secret Manager `parse-master-key` 與測試站。 |


討論清單網頁：⧉ https://claude.ai/artifact/SbRHW84nxiWrn5HJn8FUKP

測試網址
https://tacc-iip--parse-test-wsf5d7qa.web.app   2026-10-27 10:42 自動失效。



