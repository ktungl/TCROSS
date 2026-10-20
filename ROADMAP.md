# ROADMAP

合照盟計畫資料整合平台的待辦。架構見 [README.md](README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運、費用控制、帳號異動見 [OPERATIONS.md](OPERATIONS.md)。

處理完就刪掉。編號固定不重排（其他文件會用編號引用）。

> 最後整理：2026-10-20（15:43 已切換到 GCP 自架 Parse Server）。下一個里程碑：**10/31 驗收交付**。

---

## 10/31 驗收前

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 3 | 🔴 匯出格式細節 | 10/15（已逾期） | 拿實際範本核對抬頭／頁碼／編號。 |
| 18 | ⬜ 預算警示移到新帳單帳戶 | 10/31 | 專案帳單已改掛 hzm202202 的 `01B29E-2525AB-35A869`，但 09-29 設的每月預算警示還在舊帳戶 `015911-92E019-179E03`，對現在的帳單沒有作用。要用有帳單權限的帳號在主控台重設（`tainanjade@gmail.com` 沒有帳單權限）。見 OPERATIONS.md「費用控制」。 |
| 10 | ⬜ OPERATIONS.md 組織面 | 10/31 | 技術面已完成。待團隊補上：值班窗口、通報流程、還原演練週期（建議每季）。 |

## Back4App 退場

10-20 起系統已不依賴 Back4App，只當回滾用的備份。依時間順序處理：

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 16 | ⬜ 切換後收尾 | 10/27 | 新系統觀察一週沒問題後，刪 Secret Manager `parse-master-key`（Back4App 的 Master Key，回滾才用）。測試站 10-27 自動失效。 |
| 9 | ⬜ Back4App 方案到期 | 10/29 | 到期後降回免費方案即可，不用續約付費。 |
| 17 | ⬜ 刪除 Back4App 與清除殘留 | 10/31 驗收後 | 刪除後就無法回滾，所以等 #16 觀察期和驗收都過了再刪。步驟見下方。 |
| 12 | ⬜ Back4App 擁有者帳號開 MFA | 到 #17 為止 | Back4App 後台安全建議：擁有者帳號未啟用兩步驟驗證。只當備份，優先度低；#17 刪掉帳號就不用做。 |

**#17 刪除 Back4App 步驟**

- **刪除前**
  - 確認切換當下的備份 `backups/2026-10-20T07-43-21` 另存一份在 GCS 或雲端硬碟。
  - 已搬到 GCS 的附件原檔（對照表 `backups/attachment-migration-2026-10-09T07-59-51.json`）不用另外清，刪 app 時一起消失。
  - 若在刪除前需要回滾到 Back4App：先到 App Settings 關閉「Allow client class creation」，否則拿到公開 App ID＋JS Key 的人能自己建 class 塞資料（新伺服器已設 `allowClientClassCreation: false`）。
- **刪除後一次清掉殘留**
  - `firebase.json` CSP 白名單的 Back4App 網域
  - `cloud/main.js` 放行舊附件網址的判斷（資料裡已 0 個）與對應測試
  - 程式註解裡提到 Back4App 的地方
  - 備份 workflow 名稱「Backup Back4App to GCS」
  - Secret Manager `parse-master-key`（若 #16 還沒刪）
  - `.env` 的 `BACK4APP_*`
- **注意**：自架的 Parse Server（`tcross-parse`）還在用，不能一起刪。

## 沒有期限

| # | 項目 | 說明 |
| --- | --- | --- |
| 13 | 🟡 AI 報告圖表核對 | 10-20 本機用正式資料的真實活動（環球境地，男 15／女 20，3 個計畫）產 Word／PDF：性別組成、同計畫比較圖、KPI 圖、PDF 中文都正常。修了 PDF 圖說被擠到下一頁的問題（`server/document.py`，10-20 已部署 revision `tcross-middleware-00032-lf9`）。只剩：在正式站用有素材的活動實際產一份，核對 AI 辨識的 KPI 是否正確。Excel 輸出尚未做。 |
| 11 | 🟠 初始密碼可猜 | 6 個帳號密碼都是「帳號＋1234」（`Test123` 是 `Test123`），規則可猜，依決定暫不處理。建議請成員自行改密碼，或之後加首次登入強制改密碼。 |

---

## 相關連結

- 討論清單網頁：⧉ https://claude.ai/artifact/SbRHW84nxiWrn5HJn8FUKP
- 測試站：https://tacc-iip--parse-test-wsf5d7qa.web.app（2026-10-27 10:42 自動失效）
