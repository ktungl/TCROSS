# Back4App Cloud Code：伺服器端資料驗證

`main.js` 幫 `Plan`／`Activity`／`GenerationJob` 補上 `beforeSave` 驗證，擋掉繞過前端、直接打 REST API 寫入的畸形資料（必填欄位、數字範圍、日期格式、陣列欄位形狀）。這跟 GCP 完全無關，是 Back4App 自己的 Cloud Code 功能。

驗證邏輯已經用 mock 過的 Parse Cloud 環境跑過 22 組正常/異常案例（必填、trim、負數人數、錯誤日期格式、kpis/檔案陣列格式等），全部符合預期。真正部署後的行為（例如 `request.object` 在真實 Parse Server 裡的細節）還是要照下面步驟部署後，用 REST API 打一次畸形資料確認會被擋。

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
