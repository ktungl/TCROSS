# Cloud Run 中介層（ROADMAP.md Phase 1）

前端向這個服務要 GCS Signed URL，不直接握有 GCP 憑證。這個服務是唯一持有 GCP 服務帳戶身分的地方；`PARSE_MASTER_KEY` 也只存在這裡，絕不進前端 bundle。

目前只有 `/signed-url`：驗證呼叫者的 Parse session token 有效後，發一個限時、限路徑的 GCS v4 signed URL 給前端直傳檔案。`parse_auth.write_with_master_key()` 是預留給 Phase 2/3（`GenerationJob` 完成後把結果寫回 Parse）用的，目前沒有任何端點呼叫它。

另有 `/status` 做健康檢查（回傳 `{"ok": true}`）。**不要叫它 `/healthz`**——實測發現 Cloud Run 預設網域（`*.run.app`）對完全小寫的 `/healthz` 這個路徑字串會在 Google Frontend 層攔截、直接回一個跟這個服務無關的通用 404 頁面，請求根本不會進到容器（用 Cloud Run 的請求記錄可以驗證：`/healthz` 完全沒有記錄，`/health`、`/Healthz` 這種相近但不完全相同的路徑則正常）。

## 本機開發

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # 填入你的 Back4App / GCP 值
export $(grep -v '^#' .env | xargs)   # 或用 direnv/dotenv 工具載入
uvicorn main:app --reload --port 8080
```

`GCS_SIGNING_SERVICE_ACCOUNT` 本機測試時，需要你先 `gcloud auth application-default login`，且你的帳號要對該服務帳戶有 `roles/iam.serviceAccountTokenCreator`（見下方部署章節）。

## 部署到 Cloud Run（你有 GCP 專案後再做）

以下指令需要 `gcloud` CLI 已登入並選好專案：

```bash
export PROJECT_ID=your-project-id
export REGION=asia-east1
export SERVICE_NAME=tcross-middleware
export SA_NAME=tcross-middleware-sa

# 1. 建立專用服務帳戶
gcloud iam service-accounts create $SA_NAME --display-name="TCROSS Cloud Run 中介層"

SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# 2. 允許它讀寫指定的 GCS bucket
gsutil iam ch serviceAccount:$SA_EMAIL:roles/storage.objectAdmin gs://your-gcs-bucket-name

# 3. 關鍵一步：允許它「自我模擬」以呼叫 IAM signBlob API 簽發 signed URL
#    （這是在 Cloud Run 上不用下載 JSON 金鑰檔就能簽 URL 的作法）
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator"

# 4. 建立 GCS bucket（若尚未建立），並設定 CORS 讓瀏覽器能直傳檔案
gsutil mb -l $REGION gs://your-gcs-bucket-name
gsutil cors set cors.json gs://your-gcs-bucket-name

# 5. 部署（用 Cloud Build 直接從原始碼建置）
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --service-account $SA_EMAIL \
  --set-env-vars PARSE_SERVER_URL=https://parseapi.back4app.com,PARSE_APP_ID=...,PARSE_JS_KEY=...,GCS_BUCKET=your-gcs-bucket-name,GCS_SIGNING_SERVICE_ACCOUNT=$SA_EMAIL,ALLOWED_ORIGIN=https://your-production-domain.example \
  --set-secrets PARSE_MASTER_KEY=parse-master-key:latest \
  --no-allow-unauthenticated=false
```

`PARSE_MASTER_KEY` 建議用 [Secret Manager](https://cloud.google.com/secret-manager) 存放（上面指令的 `--set-secrets` 就是這樣接），不要直接用 `--set-env-vars` 明文傳。

## 驗證部署是否正確

```bash
curl https://<cloud-run-url>/status
# 應回傳 {"ok": true}

curl -X POST https://<cloud-run-url>/signed-url \
  -H "Authorization: Bearer <某個已登入使用者的 Parse session token>" \
  -H "Content-Type: application/json" \
  -d '{"activityId":"test","folder":"photo","filename":"test.jpg","contentType":"image/jpeg"}'
# 應回傳 {"uploadUrl": "...", "objectPath": "activities/test/photo/xxxxxxxx_test.jpg"}
```

若拿 session token 卡住，可以在瀏覽器 devtools 對已登入頁面執行 `Parse.User.current().getSessionToken()` 拿到。

## 尚未做的事（不在這次範圍）

- 前端還沒有任何程式碼呼叫這個服務（那是 ROADMAP Phase 3）。
- `write_with_master_key()` 還沒有端點在用（那是 ROADMAP Phase 2 的 `GenerationJob` 完成後）。
- 沒有自動化測試；本機沒有真的 GCP 專案可以跑，只做了 `python -m py_compile` 等級的靜態檢查，實際簽發 signed URL 的行為需要你部署後用上面的 curl 指令驗證。
