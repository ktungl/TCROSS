# ROADMAP

合照盟計畫資料整合平台的待辦。架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運、費用控制、帳號異動見 [OPERATIONS.md](OPERATIONS.md)。

處理完就刪掉。

> 最後整理：2026-10-19。下一個里程碑：**10/31 驗收交付**（部署維運說明技術面已完成，組織面見待辦 10）。

---

## 待辦

依截止時間排序。

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 2 | ⬜ 確認關閉 client class creation | 儘快 | Back4App App Settings「Allow client class creation」要關閉，否則拿到公開 App ID＋JS Key 的人能自己建 class 塞資料（10-19 已刪除權限全開的範例 class `B4aVehicle`）。 |
| 3 | ⬜ 匯出格式細節 | 10/15 | 拿實際範本核對抬頭／頁碼／編號。 |
| 4 | ⬜ 實際上傳＋AI 生成實測 | 10/15 | 會寫資料、花 Gemini 費用，在正式網址上跑一次，排在場域測試時。 |
| 5 | ⬜ 附件搬到 GCS 收尾 | 10/15 | 實際下載匯出檔核對照片、團隊實測；場域測試後清除 Back4App 上已搬走的原檔（對照表在 `backups/attachment-migration-2026-10-09T07-59-51.json`）。 |
| 6 | ⬜ 刪除 Netlify 網站 | 10/15 | Netlify 已停用，到後台刪除網站，避免 push 後還在建置。 |
| 7 | ⬜ 正式站驗證 AI 新功能 | 10/15 | 登入後實際產生一次改寫文案（10-13 上線）；建立第一筆「會議紀錄」，確認 10-14 貼回的 Cloud Code 有生效。 |
| 8 | ⬜ CSP 改正式 | 待辦 4 之後 | 10-05 瀏覽主要頁面 0 個違規，還沒測上傳與 AI 生成／下載。待辦 4 跑過也沒違規，就把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改成正式 `Content-Security-Policy`。 |
| 9 | ⬜ Back4App 方案到期 | 10/29 | 方案頁顯示「Valid until 10/29/2026」，到期前確認續用方式，避免服務中斷。 |
| 10 | ⬜ OPERATIONS.md 組織面 | 10/31 | 值班窗口、通報流程、還原演練週期（建議每季），待團隊補上。 |
| 11 | 🟠 初始密碼可猜 | — | 4 個新帳號初始密碼規則可猜，依決定暫不處理；建議請成員自行改密碼，或之後加首次登入強制改密碼。 |
| 12 | ⬜ Back4App 擁有者帳號開 MFA | — | Back4App 後台安全建議：擁有者帳號未啟用兩步驟驗證。 |
| 13 | 🟡 部署 AI 報告 PDF＋圖表 | — | 10-19 程式已改、未 commit：AI 報告（成果報告／會議紀錄）同時產 `.docx` 與 `.pdf`；成果報告加 KPI、性別組成、同計畫各場次人數比較圖；下載拆成 Word／PDF 兩顆按鈕。**順序**：① Cloud Run 先部署（Dockerfile 會下載字型，建置會比較久）② 再合併到 `main` 部署前端（反過來的話，舊後端不認得 `pdf` 參數，PDF 按鈕會下載到 Word）。部署後在正式站產一份成果報告，核對圖表與 PDF 中文。舊工作沒有 PDF，按 PDF 會提示重新產生。Excel 輸出尚未做。 |
| 15 | ⬜ 評估資料庫搬到 GCP | 10/31 後 | Cloud Run 自架 Parse Server＋MongoDB（Atlas 可經 GCP Marketplace 計費；或試 Firestore MongoDB 相容模式），前端與 `cloud/main.js` 幾乎不用改，估 7～9 個工作天。Back4App Free 不會給密碼雜湊，除非客服能匯出完整資料庫，否則帳號要重設密碼。 |


討論清單網頁：⧉ https://claude.ai/artifact/SbRHW84nxiWrn5HJn8FUKP
