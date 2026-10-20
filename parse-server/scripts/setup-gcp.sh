#!/usr/bin/env bash
# 一次性設定：自架 Parse Server（Cloud Run 服務 tcross-parse）需要的服務帳號、Firestore 帳密與 Secret Manager 密鑰。
# 需要專案 Owner 權限的 gcloud 帳號執行；重複執行時已存在的資源會報錯略過，不影響結果。
#
# 資料庫是 Firestore MongoDB 相容模式的 tcross 資料庫（2026-10-20 已建）。這裡建一組正式用的帳密 parse-server
# （和演練用的 parse-rehearsal 分開），密碼不印在畫面上，直接組成連線字串存進 Secret Manager。
# 新伺服器的 Master Key 也在這裡隨機產生，和 Back4App 的不同。
set -u

P=project-80ac5e1a-2ea4-4000-9ff
PN=502746951565
DB=tcross
DB_UID=a7378603-b031-466d-bf5e-7c6aa48b9df9
DB_USER=parse-server
SA=tcross-parse-sa@$P.iam.gserviceaccount.com

gcloud iam service-accounts create tcross-parse-sa --project "$P" \
  --display-name "自架 Parse Server（tcross-parse）"

DB_PASSWORD=$(gcloud firestore user-creds create "$DB_USER" --database "$DB" --project "$P" --format "value(securePassword)")
if [ -n "$DB_PASSWORD" ]; then
  printf 'mongodb://%s:%s@%s.asia-east1.firestore.goog:443/%s?loadBalanced=true&authMechanism=SCRAM-SHA-256&tls=true&retryWrites=false' \
    "$DB_USER" "$DB_PASSWORD" "$DB_UID" "$DB" |
    gcloud secrets create parse-db-uri --project "$P" --replication-policy automatic --data-file=-
fi
unset DB_PASSWORD

# Parse Server 要讀寫資料，啟動時也會建索引
for ROLE in roles/datastore.user roles/datastore.indexAdmin; do
  gcloud projects add-iam-policy-binding "$P" \
    --member "principal://firestore.googleapis.com/projects/$PN/name/databases/$DB/userCreds/$DB_USER" \
    --role "$ROLE" --condition=None --format=none
done

# Windows Git Bash 的 openssl 輸出 \r\n，兩個都要去掉，不然金鑰尾巴多一個 \r，HTTP 標頭送出時會被去掉而對不上
openssl rand -hex 32 | tr -d '\r\n' | gcloud secrets create parse-server-master-key --project "$P" \
  --replication-policy automatic --data-file=-

for S in parse-db-uri parse-server-master-key; do
  gcloud secrets add-iam-policy-binding "$S" --project "$P" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor --format=none
done

echo "GCP 端設定完成，IAM 生效約需 1 分鐘，之後執行 parse-server/scripts/deploy.sh"
