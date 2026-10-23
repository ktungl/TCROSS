# ROADMAP

合照盟計畫資料整合平台的待辦。架構見 [README.md](../README.md#架構擴充導入-gcpgoogle-cloud-platform)，部署維運、費用控制、帳號異動見 [OPERATIONS.md](OPERATIONS.md)，AI 功能升級規劃見 [AI_UPGRADE_PLAN.md](AI_UPGRADE_PLAN.md)。

處理完就刪掉。編號固定不重排（其他文件會用編號引用）。

> 最後整理：2026-10-23（10-20 15:43 已切換到 GCP 自架 Parse Server；10-23 全面掃描、整理並部署；Back4App 於 10-23 退場，切換當下的備份另存在備份桶 `archive/`）。下一個里程碑：**10/31 驗收交付**。

---

## 10/31 驗收前

| # | 項目 | 期限 | 說明 |
| --- | --- | --- | --- |
| 10 | ⬜ OPERATIONS.md 組織面 | 10/31 | 技術面已完成。待團隊補上：值班窗口、通報流程、還原演練週期（建議每季）。 |

## 系統整理（10-23 全面掃描）

10-23 掃描前端、後端、設定、腳本與文件，#19–#29、#25 已全部處理、部署並在正式站實測。

不處理的項目（10-23 評估過）：
- GenerationJob 的 `deletedAt` 是 Parse 日期欄位、附件的 `deletedAt` 存在 JSON 陣列裡只能用字串，各自是對的型別，統一反而要搬資料。
- shell 腳本與 workflow 裡寫死的專案 ID：workflow 不能 source 共用檔，抽出來只多一層間接；Node 腳本的伺服器網址已改由 `.env` 讀。
- `parse-server/scripts/` 的 `smoke-test.mjs`、`clear-database.mjs`、`rehearse-local.mjs` 保留：重新匯入／還原流程還用得到（`OPERATIONS.md`「資料備份」）。

## 沒有期限

| # | 項目 | 說明 |
| --- | --- | --- |
| 13 | 🟡 AI 報告圖表核對 | 10-20 本機用正式資料的真實活動（環球境地，男 15／女 20，3 個計畫）產 Word／PDF：性別組成、同計畫比較圖、KPI 圖、PDF 中文都正常。修了 PDF 圖說被擠到下一頁的問題（`server/document.py`，10-20 已部署 revision `tcross-middleware-00032-lf9`）。只剩：在正式站用有素材的活動實際產一份，核對 AI 辨識的 KPI 是否正確。Excel 輸出尚未做。 |
| 18 | ⬜ AI 功能正式站實測 | 10-13／10-14 上線的簽到表辨識、海報帶入、分類推薦、AI 改寫文案、公文快讀、會議錄音整理，以及成效統計表，都還沒用真資料在正式站跑過。逐項清單在 [AI_UPGRADE_PLAN.md](AI_UPGRADE_PLAN.md)「待辦」，結果記在該檔「進度」表。 |
| 11 | 🟠 初始密碼可猜 | 6 個帳號密碼都是「帳號＋1234」（`Test123` 是 `Test123`），規則可猜，依決定暫不處理。建議請成員自行改密碼，或之後加首次登入強制改密碼。 |

---

## 相關連結

- 討論清單網頁：⧉ https://claude.ai/artifact/SbRHW84nxiWrn5HJn8FUKP
- 測試站：https://tacc-iip--parse-test-wsf5d7qa.web.app（2026-10-27 10:42 自動失效）
