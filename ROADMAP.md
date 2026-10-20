# ROADMAP

合照盟計畫資料整合平台的待辦。架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運、費用控制、帳號異動見 [OPERATIONS.md](OPERATIONS.md)。

處理完就刪掉。

> 最後整理：2026-10-20（15:43 已切換到 GCP 自架 Parse Server）。下一個里程碑：**10/31 驗收交付**（部署維運說明技術面已完成，組織面見待辦 10）。

---

## 待辦

依截止時間排序。

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 2 | ⬜ 確認關閉 client class creation | 回滾才需要 | Back4App App Settings「Allow client class creation」要關閉，否則拿到公開 App ID＋JS Key 的人能自己建 class 塞資料（10-19 已刪除權限全開的範例 class `B4aVehicle`）。新伺服器已設 `allowClientClassCreation: false`，只剩回滾到 Back4App 時才需要。 |
| 3 | ⬜ 匯出格式細節 | 10/15 | 拿實際範本核對抬頭／頁碼／編號。 |
| 5 | ⬜ 附件搬到 GCS 收尾 | — | 10-20 已在正式站確認匯出檔含照片（大事紀 16 張）。只剩：清除 Back4App 上已搬走的原檔（對照表在 `backups/attachment-migration-2026-10-09T07-59-51.json`）；Back4App 10-20 起只當備份，不清也不影響使用。 |
| 9 | ⬜ Back4App 方案到期 | 10/29 | 10-20 已切換到 GCP，Back4App 只當備份：到期後降回免費方案即可，不用續約付費。 |
| 10 | ⬜ OPERATIONS.md 組織面 | 10/31 | 值班窗口、通報流程、還原演練週期（建議每季），待團隊補上。 |
| 11 | 🟠 初始密碼可猜 | — | 6 個帳號密碼都是「帳號＋1234」（`Test123` 是 `Test123`），規則可猜，依決定暫不處理；建議請成員自行改密碼，或之後加首次登入強制改密碼。 |
| 12 | ⬜ Back4App 擁有者帳號開 MFA | — | Back4App 後台安全建議：擁有者帳號未啟用兩步驟驗證。（10-20 起 Back4App 只當備份，優先度降低）。 |
| 13 | 🟡 AI 報告圖表核對 | — | AI 報告同時產 Word／PDF 已上線（10-20 正式站實測兩種都能下載）。只剩：用有 KPI、男女人數的真實活動產一份成果報告，核對 KPI、性別組成、同計畫各場次人數比較圖與 PDF 中文。Excel 輸出尚未做。 |
| 16 | ⬜ 切換後收尾 | 10/27 | 新系統觀察一週沒問題後：刪 Secret Manager `parse-master-key`（Back4App 的 Master Key，回滾才用）；測試站 10-27 自動失效。 |


討論清單網頁：⧉ https://claude.ai/artifact/SbRHW84nxiWrn5HJn8FUKP

測試網址
https://tacc-iip--parse-test-wsf5d7qa.web.app   2026-10-27 10:42 自動失效。



