#!/usr/bin/env bash
# 一次性設定：活動附件改存 GCS（ROADMAP「附件搬到 GCS」）所需的 bucket 設定。
# 需要專案 Owner 權限的 gcloud 帳號執行；重複執行不會出錯（已存在的 transfer job 會報錯略過）。
#
# 1. 主桶 CORS：正式網域可以 PUT（上傳）、GET（匯出時 fetch 照片），並允許上傳時帶
#    x-goog-content-length-range（Cloud Run 簽在網址裡的 50MB 上限）。
#    09-29 搬到 Firebase Hosting 時漏改，之前只有 localhost:5173，正式網址上傳 AI 素材也會被擋。
# 2. 備份桶 90 天刪除規則改成只套用 parse/（每日資料備份），附件備份不受影響。
# 3. Storage Transfer Service 每天把主桶 attachments/ 增量複製到備份桶 attachments/：
#    只新增／更新，不同步刪除——主桶被誤刪的檔案在備份桶還找得到。
set -u

P=project-80ac5e1a-2ea4-4000-9ff
MAIN=gs://tcross-2026-$P
BACKUP=gs://$P-backup
DIR=$(cd "$(dirname "$0")" && pwd)

gcloud storage buckets update "$MAIN" --cors-file "$DIR/../server/cors.json"

LIFECYCLE=$(mktemp)
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90,"matchesPrefix":["parse/"]}}]}' > "$LIFECYCLE"
gcloud storage buckets update "$BACKUP" --lifecycle-file "$LIFECYCLE"
rm -f "$LIFECYCLE"

gcloud services enable storagetransfer.googleapis.com --project "$P"
# 讓 Storage Transfer 的服務代理能讀主桶、寫備份桶
gcloud transfer authorize --add-missing --project "$P"

gcloud transfer jobs create "$MAIN/attachments/" "$BACKUP/attachments/" --project "$P" \
  --name "attachments-daily-backup" \
  --description "每日把活動附件增量複製到備份桶（不同步刪除）" \
  --schedule-repeats-every 1d \
  --overwrite-when different

echo "GCS 附件設定完成"
