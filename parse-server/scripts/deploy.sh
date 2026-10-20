#!/usr/bin/env bash
# 部署自架 Parse Server 到 Cloud Run（服務 tcross-parse）。改完 cloud/main.js 也是跑這支，
# 不用再手動貼到 Back4App Dashboard。第一次部署前先跑 setup-gcp.sh。
# App ID／JavaScript Key 沿用 Back4App 的（從專案根目錄 .env 讀），前端切換時只要換伺服器網址。
set -eu

P=project-80ac5e1a-2ea4-4000-9ff
PN=502746951565
REGION=asia-east1
SERVICE=tcross-parse

cd "$(dirname "$0")/.."
APP_ID=$(grep -E '^VITE_PARSE_APP_ID=' ../.env | cut -d= -f2- | tr -d '\r')
JS_KEY=$(grep -E '^VITE_PARSE_JS_KEY=' ../.env | cut -d= -f2- | tr -d '\r')
if [ -z "$APP_ID" ] || [ -z "$JS_KEY" ]; then
  echo ".env 缺少 VITE_PARSE_APP_ID 或 VITE_PARSE_JS_KEY" >&2
  exit 1
fi

mkdir -p cloud
cp ../cloud/main.js cloud/main.js

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$P" \
  --region "$REGION" \
  --service-account "tcross-parse-sa@$P.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-env-vars "PARSE_APP_ID=$APP_ID,PARSE_JS_KEY=$JS_KEY,PUBLIC_SERVER_URL=https://$SERVICE-$PN.$REGION.run.app/parse" \
  --set-secrets "DATABASE_URI=parse-db-uri:latest,PARSE_MASTER_KEY=parse-server-master-key:latest"

curl -fsS "https://$SERVICE-$PN.$REGION.run.app/health" && echo " ← 健康檢查通過"
