# Parse Cloud Code：伺服器端資料驗證、稽核紀錄、檔案清理

`main.js` 是 Parse 的 Cloud Code。2026-10-20 起由自架 Parse Server `tcross-parse` 執行（`parse-server/index.js` 掛載同一份檔案），改完跑 `bash parse-server/scripts/deploy.sh` 部署。

## 做什麼

| Class | Hook | 內容 |
| --- | --- | --- |
| `Plan`／`Category` | `beforeSave` | 名稱必填、長度上限；寫入建立者／修改者（`stampActor()`，前端送來的值會被覆蓋） |
| `Activity` | `beforeSave` | 必填、數字範圍、日期格式（`YYYY-MM-DD`，非字串也擋）、人數、文字長度、`kpis` 與附件陣列形狀；**封存的活動不能修改**（只能解除封存）；新加入的附件只能是 `gcs:` 路徑，不能塞外部連結；比對前後的附件陣列，寫入上傳者／移到垃圾桶的人 |
| `Activity` | `beforeDelete` | 封存中的活動不能刪除 |
| `Activity` | `afterSave` | 寫操作紀錄（GCS 附件的實體檔由中介層 `/attachments/delete` 清） |
| `GenerationJob` | `beforeSave` | `activity` 必填、`kind`／`status`／`sourceFiles`／`resultFile`／`errorMessage` 格式；非 Master Key 時，新工作只能是待處理狀態、素材必須是該活動上傳的檔案、建立後關鍵欄位不能改（狀態與結果由 Cloud Run 中介層用 Master Key 寫入，防止偽造） |
| 以上全部 | `afterSave`／`afterDelete` | 寫一筆 `AuditLog`（逐欄差異＋中文摘要） |
| `AuditLog` | `beforeSave`／`beforeDelete` | 非 Master Key 一律拒絕，紀錄不可新增、修改、刪除 |
| `_User` | `beforeSave`／`afterLogin`／`afterLogout` | `username`／`displayName` 只能由 Master Key（`scripts/setup-users.mjs`）改；登入登出寫入 `AuditLog` |

附件欄位清單是 `FOLDER_FIELDS`（13 個）：目前的 10 個分類（`registrationFiles`／`contentFiles`／`photoFiles`／`signInFiles`／`recordFiles`／`agendaFiles`／`documentFiles`／`receiptFiles`／`socialFiles`／`mediaFiles`），加上舊版殘留的 `audioFiles`／`videoFiles`／`docFiles`（舊資料可能還在，繼續驗證）。活動分類已改成使用者在「分類管理」自訂（`Category` class），這裡只檢查格式（非空字串、上限 50 字），不再限定固定清單。

## 測試

`cloud/tests/main.test.cjs` 用假的 `Parse.Cloud` 載入 `main.js`，直接呼叫各個 hook：

```bash
npm run test:cloud   # 2026-10-20：30 項全過
```

## 部署（自架 Parse Server）

```bash
bash parse-server/scripts/deploy.sh   # 會把 cloud/main.js 一起打包部署到 tcross-parse
```

改 `main.js` 時，先跑 `npm run test:cloud`，部署後依 [doc/TESTING.md](../doc/TESTING.md)「部署後手動回歸檢查」用 `Test123` 跑 `npm run test:e2e`，並手動試一次「編輯已封存活動應該被拒」。

### 部署後驗證

拿一個已登入帳號的 session token（瀏覽器 devtools 執行 `Parse.User.current().getSessionToken()`），故意送一筆畸形資料，應該要被拒絕：

```bash
curl -X POST \
  -H "X-Parse-Application-Id: 你的APPID" \
  -H "X-Parse-JavaScript-Key: 你的JSKEY" \
  -H "X-Parse-Session-Token: 你的SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"","headcount":-1}' \
  "https://tcross-parse-502746951565.asia-east1.run.app/parse/classes/Activity"
```

預期會收到類似：

```json
{"code":142,"error":"活動名稱不能為空"}
```
