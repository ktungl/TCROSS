# Cloud Run 中介層（ROADMAP.md Phase 1）

前端向這個服務要 GCS Signed URL，不直接握有 GCP 憑證。這個服務是唯一持有 GCP 服務帳戶身分的地方；`PARSE_MASTER_KEY` 也只存在這裡，絕不進前端 bundle。

- `/signed-url`：驗證呼叫者的 Parse session token 有效後，發一個限時、限路徑的 GCS v4 signed URL（PUT）給前端直傳檔案。
- `/download-url`：同樣驗證 session token 後，對 `objectPath` 發一個限時的 GCS v4 signed URL（GET）給前端下載/預覽檔案；`objectPath` 必須以 `activities/` 開頭且不含 `..`（`utils.is_valid_object_path()`），避免任何登入使用者拿去簽發桶內任意路徑的下載網址。前端 `AiGenerationModal.vue` 在 `GenerationJob.status === 'done'` 時會呼叫這個端點。
- `/delete-objects`：驗證 session token 後，批次刪除傳入的 `objectPaths`（同樣用 `is_valid_object_path()` 檢查每個路徑），供前端在刪除 `GenerationJob` 記錄前先清掉對應的 GCS 來源/產出檔案（`src/stores/db.ts` 的 `deleteGenerationJob()`）。
- `/generate/{job_id}`：Phase 3b。驗證呼叫者能讀到這筆 `GenerationJob` 且狀態是 `pending` 後，先用 Master Key 把 `status` 改成 `processing`，回應 202；實際生成（呼叫 Gemini → 組裝 `.docx` → 寫回 GCS → 用 Master Key 把 `status`/`resultFile` 或 `errorMessage` 寫回 Parse）在 FastAPI `BackgroundTasks` 裡背景執行（`report.py` 的 `analyze_sources()`／`build_report_docx()`）。前端 `AiGenerationModal.vue` 在建立好 `GenerationJob` 後立刻呼叫這個端點觸發，結果透過既有的 5 秒輪詢取得，不等這個請求的回應。

`parse_auth.write_with_master_key()` 現在由 `/generate` 使用，把 `GenerationJob` 推進 `processing`/`done`/`error`。

**部署前提，2026-09-17 已執行並驗證**：
1. ✅ GCP 專案已啟用 Vertex AI API（`aiplatform.googleapis.com`）——這是會計費的服務。
2. ✅ `tcross-middleware-sa` 已授權 `roles/aiplatform.user`。
3. ✅ Cloud Run 環境變數已補上 `GCP_PROJECT=project-80ac5e1a-2ea4-4000-9ff`／`GCP_LOCATION=us-central1`／`GEMINI_MODEL=gemini-2.5-flash`。**若之後想換模型或 region，記得先到 [Vertex AI 主控台](https://console.cloud.google.com/vertex-ai)確認新的 `GEMINI_MODEL` 在該 `GCP_LOCATION` 是否可用**（Gemini 模型的可用 region 會隨時間變動，這裡沒有寫死驗證）。
4. ✅ 已用 `--no-cpu-throttling` 重部署（revision `tcross-middleware-00011-hdv`，`gcloud run services describe` 確認 `run.googleapis.com/cpu-throttling: 'false'`）——這是必須的：FastAPI 的 `BackgroundTasks` 要在 HTTP 回應送出**之後**繼續跑 Gemini／組裝／寫回這幾步，沒有這個旗標 Cloud Run 預設會在沒有進來的請求時限制 CPU，背景工作可能因此被凍結／跑很慢甚至跑不完。**這個旗標會提高 Cloud Run 的閒置計費**（instance 常駐拿得到 CPU），是用可靠性換取的成本，之後如果覺得不划算可以評估改用 Cloud Tasks 佇列。
5. **✅ 端到端測試已完成**（2026-09-17）：用瀏覽器對一筆測試活動實際跑過「上傳照片→開始生成→下載 `.docx`」全流程，確認 Gemini 呼叫、GCS 寫入、Parse 寫回都正常。過程中第一次觸發遇到 `400 FAILED_PRECONDITION`（Google：「Service agents are being provisioned...please try again in a few minutes」），這是剛啟用 Vertex AI API 後的正常過渡狀態；等了幾分鐘重新觸發後成功，下載的 `.docx` 內容確認 Gemini 正確讀出測試照片裡的文字並填入摘要／重點／KPI 表格。測試資料已清除，不留在正式資料庫。
6. **已知限制（暫時接受，之後有需要再處理）**：用 `BackgroundTasks` 而不是 Cloud Tasks 佇列，如果 Cloud Run instance 在背景工作跑到一半被砍掉（例如流量掉到 0 被縮容），這筆 `GenerationJob` 會卡在 `processing` 沒有自動重試，需要手動把 Parse 上的 `status` 改回 `pending` 再重新呼叫 `/generate`，或直接刪除重建。若這種情況常發生，之後應該換成 Cloud Tasks（在 Cloud Run 裡呼叫佇列，而不是讓 Back4App Cloud Code 持有 GCP 憑證——理由跟 [../README.md](../README.md#資料流向) 說明的信任邊界一致）。

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

# 5.（Phase 3b）啟用 Vertex AI API——會計費，執行前請確認
gcloud services enable aiplatform.googleapis.com

# 6.（Phase 3b）讓服務帳戶能呼叫 Gemini
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/aiplatform.user"

# 7. 部署（用 Cloud Build 直接從原始碼建置）
# --no-cpu-throttling 是 Phase 3b 必需的：/generate 用 FastAPI BackgroundTasks
# 在 HTTP 回應送出後才做 Gemini 呼叫與文件組裝，沒有這個旗標 Cloud Run 預設會在
# 沒有進來的請求時限制 CPU，背景工作可能被凍結或跑不完。
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --service-account $SA_EMAIL \
  --no-cpu-throttling \
  --set-env-vars PARSE_SERVER_URL=https://parseapi.back4app.com,PARSE_APP_ID=...,PARSE_JS_KEY=...,GCS_BUCKET=your-gcs-bucket-name,GCS_SIGNING_SERVICE_ACCOUNT=$SA_EMAIL,ALLOWED_ORIGIN=https://your-production-domain.example,GCP_PROJECT=$PROJECT_ID,GCP_LOCATION=us-central1,GEMINI_MODEL=gemini-2.5-flash \
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
  -d '{"activityId":"test","files":[{"folder":"photo","filename":"test.jpg","contentType":"image/jpeg"}]}'
# 應回傳 {"files": [{"uploadUrl": "...", "objectPath": "activities/test/photo/xxxxxxxx_test.jpg"}]}
# 一次請求可以帶多個 files（同一個 activityId），只驗證一次 session/activity 就能拿到一批簽好的網址。

curl -X POST https://<cloud-run-url>/download-url \
  -H "Authorization: Bearer <某個已登入使用者的 Parse session token>" \
  -H "Content-Type: application/json" \
  -d '{"objectPath":"activities/test/photo/xxxxxxxx_test.jpg"}'
# 應回傳 {"downloadUrl": "..."}

curl -X POST https://<cloud-run-url>/delete-objects \
  -H "Authorization: Bearer <某個已登入使用者的 Parse session token>" \
  -H "Content-Type: application/json" \
  -d '{"objectPaths":["activities/test/photo/xxxxxxxx_test.jpg"]}'
# 應回傳 {"deleted": 1}
# objectPaths 不掛在任何 GenerationJob 上時（例如清理上傳到一半失敗的孤兒檔案）要多帶 activityId，
# 授權條件改成跟 /signed-url 一樣「能讀到這個 activity」：
# -d '{"objectPaths":["activities/test/photo/xxxxxxxx_test.jpg"],"activityId":"test"}'
```

curl -X POST https://<cloud-run-url>/generate/<某筆 pending 狀態的 GenerationJob objectId> \
  -H "Authorization: Bearer <該 GenerationJob 所屬活動、呼叫者能讀到的 Parse session token>"
# 應立即回傳 {"status": "processing"}（202）；實際生成在背景跑，之後用
# GET /classes/GenerationJob/<id>（帶同一個 session token）或前端頁面觀察
# status 是否變成 done（連同 resultFile）或 error（連同 errorMessage）
```

若拿 session token 卡住，可以在瀏覽器 devtools 對已登入頁面執行 `Parse.User.current().getSessionToken()` 拿到。

## 尚未做的事（不在這次範圍）

- **Phase 3b 程式碼已完成、部署上線並通過端到端測試**（`/generate` 端點、`report.py` 的 Gemini 呼叫與 `.docx` 組裝、前端 `AiGenerationModal.vue` 已串接觸發；revision `tcross-middleware-00011-hdv`，2026-09-17）。詳見上方「部署前提」第 5 點。
- 目前只組裝 `.docx`（Word），沒有實作 PDF／Excel 輸出（README.md 的目標架構寫「輸出：PDF、Word、Excel」，這裡先做一種格式當 MVP；`GenerationJob.kind` 目前 `成果報告`／`其他` 兩種都走同一套 `.docx` 組裝邏輯，還沒有依 `kind` 分流成不同格式）。
- 沒有自動化測試。
- `/status`、`/signed-url`、`/download-url`、`/delete-objects`、`/generate` 都已部署到 Cloud Run 並用上面的 curl 指令在線上實測過（見 [../ROADMAP.md](../ROADMAP.md) 部署紀錄）。
