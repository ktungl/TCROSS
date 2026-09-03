# Back4App Cloud Code：伺服器端資料驗證 + 檔案清理

`main.js` 幫 `Plan`／`Activity`／`GenerationJob` 補上 `beforeSave` 驗證，擋掉繞過前端、直接打 REST API 寫入的畸形資料（必填欄位、數字範圍、日期格式、陣列欄位形狀）。這跟 GCP 完全無關，是 Back4App 自己的 Cloud Code 功能。

`Plan`/`Activity` 的驗證邏輯已經用 mock 過的 Parse Cloud 環境跑過 22 組正常/異常案例（必填、trim、負數人數、錯誤日期格式、kpis/檔案陣列格式等），全部符合預期。`GenerationJob` 後續補上的 `activity` 必填檢查、`resultFile`/`errorMessage` 型別檢查（2026-08-20）沒有對應的 mock 測試案例，但已部署到 Back4App 並用 Master Key 對 `Activity`（空 name、錯誤日期格式）、`Plan`（空白 name）、`GenerationJob`（缺 `activity`）各送一筆畸形資料實測，四筆都被正確擋下（`code:142`），確認正式環境的驗證邏輯生效。

**2026-08-20 新增 `afterSave('Activity', ...)`**：前端 `removeFile()`（`src/stores/db.ts`）只把項目從檔案欄位陣列拿掉再存回去，從沒刪過底層的 Parse.File，會一直堆孤兒檔案。這個 hook 在每次 `Activity` 存檔後比對 `request.original` 跟 `request.object` 的檔案欄位，把消失的項目對應的檔案用 Master Key 刪掉。`Parse.File.destroy()` 需要 Master Key，前端不會也不該持有，所以只能放在 Cloud Code。**已由使用者貼到 Back4App Cloud Code Dashboard 並部署**（System Logs 確認 2026-08-20T00:34 之後的重啟不再出現「main.js not found」警告），但尚未實際觸發過一次刪檔測試——見下方「部署後驗證」或找一個測試活動實際刪張照片確認檔案真的消失。

**2026-09-03 對齊《需求訪談》欄位**：前端的活動欄位與附件分類依需求訪談規格改版（見 `README.md` 0903 段落），這份驗證跟著補上：

- `FOLDER_FIELDS` 從舊的 4 分類擴充成 11 個欄位——新的 8 分類（`photoFiles`/`signInFiles`/`recordFiles`/`agendaFiles`/`documentFiles`/`receiptFiles`/`socialFiles`/`mediaFiles`）加上舊版殘留的 `audioFiles`/`videoFiles`/`docFiles`（舊資料可能還在，繼續驗證＋清孤兒檔，不主動刪欄位）。這個常數同時被 `beforeSave` 驗證與 `afterSave` 清檔案共用，所以新分類的附件刪除也會一併清掉底層檔案
- 新欄位驗證：`category`（限居場所/會務/合作教育/社區關懷/其他）、`dateEnd`（`YYYY-MM-DD`）、`maleCount`/`femaleCount`/`totalCount`（不小於 0 的數字）、`attendees`／`participantDesc`（上限 200 字）、`remark`（上限 500 字）
- 檔案陣列項目新增選填的 `caption`（圖說，字串）與 `featured`（精選照片，布林值）型別檢查
- 舊的單一數字 `headcount` 驗證保留：前端已改用 `maleCount`/`femaleCount`/`totalCount`，但舊資料可能還帶著這個欄位

這批改動用 mock 過的 Parse Cloud 環境跑過 7 組案例（1 組合法 + 6 組異常：亂填分類、`dateEnd` 格式錯、人數負值、字串超長、`caption`/`featured` 型別錯），全部符合預期。**已由使用者貼到 Back4App Cloud Code Dashboard 並部署。**

> **Back4App 不會自動建欄位**：Cloud Code 部署跟資料表欄位是兩回事。前端新增欄位後，第一次寫入會收到 `Permission denied for action addField on class Activity`，要先用 `node scripts/sync-schema.mjs --apply`（用 `.env` 的 Master Key 建欄位）或到 Dashboard 手動加欄位。詳見專案根目錄 `scripts/sync-schema.mjs`。

## 部署步驟（Back4App Dashboard，沒有額外工具需要裝）

1. 登入 [dashboard.back4app.com](https://dashboard.back4app.com) → 選你的 App
2. 左側選單找 **Cloud Code**（或 "Cloud Code Settings"）
3. 進去會看到一個檔案總管，預設會有 `cloud/main.js`
4. 把這個檔案（`cloud/main.js`）的內容整個貼進去，覆蓋掉預設內容
5. 點 **Deploy** 按鈕發佈

## 部署後驗證

拿一個已登入帳號的 session token（跟前面驗證 CLP 時同樣的拿法：瀏覽器 devtools 執行 `Parse.User.current().getSessionToken()`），故意送一筆畸形資料，應該要被拒絕：

```bash
curl -X POST \
  -H "X-Parse-Application-Id: 你的APPID" \
  -H "X-Parse-JavaScript-Key: 你的JSKEY" \
  -H "X-Parse-Session-Token: 你的SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"","headcount":-1}' \
  "https://parseapi.back4app.com/classes/Activity"
```

預期會收到類似：

```json
{"code":142,"error":"活動名稱不能為空"}
```

如果還是回傳 200 且成功建立，代表 Deploy 沒有真的生效（可以參考之前 CLP 的經驗：Back4App 有時候第一次存/部署不會立刻生效，重新點一次 Deploy 再測一次）。
