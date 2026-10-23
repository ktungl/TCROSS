# Cloud Run 中介層

前端向這個服務要 GCS Signed URL，不直接握有 GCP 憑證（GCS 簽名用的服務帳戶身分只在這個服務）。`PARSE_MASTER_KEY`（Secret Manager `parse-server-master-key`）只在後端：這個服務、`tcross-parse` 本身與 GitHub 每日備份，絕不進前端 bundle。

- `/signed-url`：驗證呼叫者的 Parse session token 有效後，發一個限時、限路徑的 GCS v4 signed URL（PUT）給前端直傳檔案。
- `/download-url`：同樣驗證 session token 後，對 `objectPath` 發一個限時的 GCS v4 signed URL（GET）給前端下載/預覽檔案；`objectPath` 必須以 `activities/` 開頭且不含 `..`（`utils.is_valid_object_path()`），避免任何登入使用者拿去簽發桶內任意路徑的下載網址。前端 `AiGenerationModal.vue` 在 `GenerationJob.status === 'done'` 時會呼叫這個端點。
- `/delete-objects`：驗證 session token 後，批次刪除傳入的 `objectPaths`（同樣用 `is_valid_object_path()` 檢查每個路徑），供前端在刪除 `GenerationJob` 記錄前先清掉對應的 GCS 來源/產出檔案（`src/stores/db.ts` 的 `deleteGenerationJob()`）。
- `/generate/{job_id}`：AI 生成，依 `kind` 產成果報告或會議紀錄。驗證呼叫者能讀到這筆 `GenerationJob` 且狀態是 `pending` 後，先用 Master Key 把 `status` 改成 `processing`，接著**在同一個請求裡**把生成做完（呼叫 Gemini → `report.py` 組出報告內容（成果報告含圖表，`charts.py`）→ `document.py` 輸出 `.docx` 與同名 `.pdf` 寫回 GCS → 用 Master Key 把 `status`/`resultFile` 或 `errorMessage` 寫回 Parse）才回應 `{"status": "done"|"error"}`。前端 `AiGenerationModal.vue` 建立好 `GenerationJob` 後用 `keepalive` 送出觸發請求但**不等回應**，結果透過既有的 5 秒輪詢取得。停在 `processing` 超過 20 分鐘的工作允許重新觸發（前端有「重新觸發」按鈕）。每筆工作最多 `MAX_SOURCE_FILES`（預設 20）個素材檔。

`parse_auth.write_with_master_key()` 現在由 `/generate` 使用，把 `GenerationJob` 推進 `processing`/`done`/`error`。

**部署前提，2026-09-17 已執行並驗證**：
1. ✅ GCP 專案已啟用 Vertex AI API（`aiplatform.googleapis.com`）——這是會計費的服務。
2. ✅ `tcross-middleware-sa` 已授權 `roles/aiplatform.user`。
3. ✅ Cloud Run 環境變數已補上 `GCP_PROJECT=project-80ac5e1a-2ea4-4000-9ff`／`GCP_LOCATION`／`GEMINI_MODEL=gemini-2.5-flash`。2026-09-28 `GCP_LOCATION` 從 `us-central1` 改成 `asia-northeast1`（東京）——`gemini-2.5-flash` 在 `asia-east1`（台灣）實測回 404 不可用，東京是離 GCS 桶最近、實測可用的 region。另可用 `GEMINI_MEDIA_RESOLUTION`（預設 `LOW`）調整照片／影片送進 Gemini 的解析度，小字辨識不出來再改 `MEDIUM`。**若之後想換模型或 region，記得先到 [Vertex AI 主控台](https://console.cloud.google.com/vertex-ai)確認新的 `GEMINI_MODEL` 在該 `GCP_LOCATION` 是否可用**（Gemini 模型的可用 region 會隨時間變動，這裡沒有寫死驗證）。
4. ✅ 用 `--cpu-throttling`（按請求計費）、`--max-instances 2`、`--timeout 900` 部署：2026-09-28 起 `/generate` 在請求內同步做完，不需要常駐 CPU（09-17 曾改用 `--no-cpu-throttling` 配合 BackgroundTasks，已撤銷），見 [../doc/OPERATIONS.md](../doc/OPERATIONS.md)「費用控制」。
5. **✅ 端到端測試已完成**（2026-09-17）：用瀏覽器對一筆測試活動實際跑過「上傳照片→開始生成→下載 `.docx`」全流程，確認 Gemini 呼叫、GCS 寫入、Parse 寫回都正常。過程中第一次觸發遇到 `400 FAILED_PRECONDITION`（Google：「Service agents are being provisioned...please try again in a few minutes」），這是剛啟用 Vertex AI API 後的正常過渡狀態；等了幾分鐘重新觸發後成功，下載的 `.docx` 內容確認 Gemini 正確讀出測試照片裡的文字並填入摘要／重點／KPI 表格。測試資料已清除，不留在正式資料庫。
6. **已知限制（暫時接受，之後有需要再處理）**：沒有用 Cloud Tasks 佇列。生成超過 `--timeout`（900 秒）或 instance 中途被砍掉時，這筆 `GenerationJob` 會停在 `processing`；20 分鐘後可以從前端「重新觸發」再跑一次（2026-09-28 起），不用再手動改 Parse。若這種情況常發生，之後應該換成 Cloud Tasks（在 Cloud Run 裡呼叫佇列，而不是讓 Parse Cloud Code 持有 GCP 憑證——理由跟 [../README.md](../README.md#資料流向) 說明的信任邊界一致）。

- `/attachments/upload-urls`、`/attachments/view-urls`、`/attachments/delete`：活動附件（存在 GCS 主桶 `attachments/`，前端 `src/lib/attachments.ts`）。上傳和 `/signed-url` 一樣檢查 session、活動可讀、副檔名黑名單，另由 GCS 強制單檔 50 MB；檢視一次簽一批 15 分鐘的 GET 網址，單一路徑無權讀取時只略過那一個；刪除只刪已經沒有任何活動引用的檔案（前端先刪紀錄再呼叫）。

- `/rewrite/{activity_id}`：AI 改寫文案（`doc/AI_UPGRADE_PLAN.md` 1-1）。body `{"format": "新聞稿"|"社群文案"|"主管摘要"}`；用呼叫者的 session 讀活動與計畫名稱（讀不到回 403），只把文字欄位送 Gemini（`rewrite.py`），同步回傳 `{format, title, paragraphs, bullets, hashtags}`，不建 `GenerationJob`、不寫任何資料。各格式的寫法在 `rewrite.py` 的 `FORMATS`。

- `/assist/sign-in`、`/assist/poster`、`/assist/classify`：表單智慧輔助（`doc/AI_UPGRADE_PLAN.md` 第二批，`assist.py`）。都只回傳建議、不寫任何資料。`/assist/document`（`doc/AI_UPGRADE_PLAN.md` 1-5）把公文／企劃書整理成重點摘要＋需人工核對清單，同樣只回傳結果、不存檔。圖片以 base64 隨請求送來（JPEG／PNG／WebP、單張 5 MB、簽到表最多 6 張、`activityId` 須可讀），不存 GCS；分類推薦的清單由這裡用呼叫者 session 讀 Category／Plan，清單外的結果一律丟棄。

另有 `/status` 做健康檢查（回傳 `{"ok": true}`）。**不要叫它 `/healthz`**——實測發現 Cloud Run 預設網域（`*.run.app`）對完全小寫的 `/healthz` 這個路徑字串會在 Google Frontend 層攔截、直接回一個跟這個服務無關的通用 404 頁面，請求根本不會進到容器（用 Cloud Run 的請求記錄可以驗證：`/healthz` 完全沒有記錄，`/health`、`/Healthz` 這種相近但不完全相同的路徑則正常）。

## 本機開發

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # 填入 Parse / GCP 值
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

# 2. 建立 GCS bucket（若尚未建立），並設定 CORS 讓瀏覽器能直傳檔案
gcloud storage buckets create gs://your-gcs-bucket-name --location $REGION --uniform-bucket-level-access
gcloud storage buckets update gs://your-gcs-bucket-name --cors-file cors.json

# 3. 允許服務帳戶讀寫這個 bucket
gcloud storage buckets add-iam-policy-binding gs://your-gcs-bucket-name \
  --member="serviceAccount:$SA_EMAIL" --role="roles/storage.objectAdmin"

# 4. 關鍵一步：允許它「自我模擬」以呼叫 IAM signBlob API 簽發 signed URL
#    （這是在 Cloud Run 上不用下載 JSON 金鑰檔就能簽 URL 的作法）
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator"

# 5.（AI 生成）啟用 Vertex AI API——會計費，執行前請確認
gcloud services enable aiplatform.googleapis.com

# 6.（AI 生成）讓服務帳戶能呼叫 Gemini
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/aiplatform.user"

# 7. 部署（用 Cloud Build 直接從原始碼建置）
# --cpu-throttling（按請求計費）：/generate 在請求內同步做完，不需要常駐 CPU。
# --timeout 900 讓多素材的生成有足夠時間；--max-instances 2 對這個流量已足夠，
# 也讓記憶體內的 rate limit 不會被分散到太多 instance。
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --service-account $SA_EMAIL \
  --cpu-throttling --max-instances 2 --timeout 900 \
  --set-env-vars PARSE_SERVER_URL=https://tcross-parse-502746951565.asia-east1.run.app/parse,PARSE_APP_ID=...,PARSE_JS_KEY=...,GCS_BUCKET=your-gcs-bucket-name,GCS_SIGNING_SERVICE_ACCOUNT=$SA_EMAIL,ALLOWED_ORIGIN=https://your-production-domain.example,GCP_PROJECT=$PROJECT_ID,GCP_LOCATION=asia-northeast1,GEMINI_MODEL=gemini-2.5-flash \
  --set-secrets PARSE_MASTER_KEY=parse-server-master-key:latest \
  --allow-unauthenticated
# --allow-unauthenticated：瀏覽器直接呼叫這個服務，身分由每個端點驗 Parse session token 把關
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

curl -X POST https://<cloud-run-url>/generate/<某筆 pending 狀態的 GenerationJob objectId> \
  -H "Authorization: Bearer <該 GenerationJob 所屬活動、呼叫者能讀到的 Parse session token>"
# 生成做完才回應 {"status": "done"} 或 {"status": "error"}（可能要一兩分鐘）。
# 注意：curl 對沒有 body 的 POST 要加 -d ''，否則 Google Frontend 會回 411。也可以用
# GET /classes/GenerationJob/<id>（帶同一個 session token）或前端頁面觀察
# status 是否變成 done（連同 resultFile）或 error（連同 errorMessage）
```

若拿 session token 卡住，可以在瀏覽器 devtools 對已登入頁面執行 `Parse.User.current().getSessionToken()` 拿到。

## 尚未做的事（不在這次範圍）

- **AI 生成（`/generate`）程式碼已完成、部署上線並通過端到端測試**（`/generate` 端點、`report.py` 的 Gemini 呼叫與 `.docx` 組裝、前端 `AiGenerationModal.vue` 已串接觸發；2026-09-17 首次上線為 revision `tcross-middleware-00011-hdv`，2026-10-20 正式運行的是 `tcross-middleware-00032-lf9`）。詳見上方「部署前提」第 5 點。
- 輸出 `.docx` 與 `.pdf`（2026-10-19 起）：兩份由同一份內容結構（`document.py` 的 blocks）產生；`resultFile` 仍記 `.docx`，PDF 是同路徑換副檔名，`/download-url` 帶 `pdf: true` 下載、`/delete-objects` 刪 `.docx` 時一併刪 PDF。PDF 用 fpdf2 排版，中文字型 Noto Sans TC 由 Dockerfile 執行 `fetch_fonts.py` 下載（核對 SHA-256）；字型缺檔時 PDF 略過、Word 照常交付。成果報告的圖表：KPI（同單位 ≥2 項才畫）、參與人數性別組成、同計畫各場次人數比較（最多 3 個計畫）；畫圖失敗只略過該圖。Excel 輸出尚未實作。
- 自動化測試：`tests/` 有 pytest（工具函式、端點、報告，2026-10-20 共 106 項），在這個資料夾執行 `.venv/Scripts/python.exe -m pytest`（新環境先 `pip install -r requirements-dev.txt`）；還沒有接 CI，見 [../doc/TESTING.md](../doc/TESTING.md)。
- `/status`、`/signed-url`、`/download-url`、`/delete-objects`、`/generate` 都已部署到 Cloud Run 並用上面的 curl 指令在線上實測過。
