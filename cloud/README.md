# Back4App Cloud Code：伺服器端資料驗證 + 檔案清理

`main.js` 幫 `Plan`／`Activity`／`GenerationJob` 補上 `beforeSave` 驗證，擋掉繞過前端、直接打 REST API 寫入的畸形資料（必填欄位、數字範圍、日期格式、陣列欄位形狀）。這跟 GCP 完全無關，是 Back4App 自己的 Cloud Code 功能。

`Plan`/`Activity` 的驗證邏輯已經用 mock 過的 Parse Cloud 環境跑過 22 組正常/異常案例（必填、trim、負數人數、錯誤日期格式、kpis/檔案陣列格式等），全部符合預期。`GenerationJob` 後續補上的 `activity` 必填檢查、`resultFile`/`errorMessage` 型別檢查（2026-08-20）沒有對應的 mock 測試案例，但已部署到 Back4App 並用 Master Key 對 `Activity`（空 name、錯誤日期格式）、`Plan`（空白 name）、`GenerationJob`（缺 `activity`）各送一筆畸形資料實測，四筆都被正確擋下（`code:142`），確認正式環境的驗證邏輯生效。

**2026-08-20 新增 `afterSave('Activity', ...)`**：前端 `removeFile()`（`src/stores/db.ts`）只把項目從 `photoFiles`/`audioFiles`/`videoFiles`/`docFiles` 陣列拿掉再存回去，從沒刪過底層的 Parse.File，會一直堆孤兒檔案。這個 hook 在每次 `Activity` 存檔後比對 `request.original` 跟 `request.object` 這四個欄位，把消失的項目對應的檔案用 Master Key 刪掉。`Parse.File.destroy()` 需要 Master Key，前端不會也不該持有，所以只能放在 Cloud Code。**已由使用者貼到 Back4App Cloud Code Dashboard 並部署**（System Logs 確認 2026-08-20T00:34 之後的重啟不再出現「main.js not found」警告），但尚未實際觸發過一次刪檔測試——見下方「部署後驗證」或找一個測試活動實際刪張照片確認 GCS 檔案真的消失。

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
