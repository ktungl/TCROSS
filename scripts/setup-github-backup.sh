#!/usr/bin/env bash
# 一次性設定：讓 GitHub Actions（.github/workflows/backup-parse.yml）每天把 Back4App 備份上傳到 GCS。
# 沿用前端部署的 Workload Identity pool／provider（setup-github-deploy.sh 建的，只有 main 分支換得到憑證），
# 另開 github-backup 服務帳號，只在備份桶有 objectCreator：能上傳新備份，不能讀、覆蓋或刪除舊備份。
# 需要專案 Owner 權限的 gcloud 帳號執行；重複執行時已存在的資源會報錯略過，不影響結果。
#
# 執行完還要到 GitHub 加 secret PARSE_MASTER_KEY（VITE_PARSE_APP_ID／VITE_PARSE_SERVER_URL 前端部署已有）。
set -u

P=project-80ac5e1a-2ea4-4000-9ff
PN=502746951565
REPO=ktungl/TCROSS
SA=github-backup@$P.iam.gserviceaccount.com
BUCKET=gs://$P-backup

# Nearline：一個月取用不到一次的資料最便宜（最短保存 30 天，我們保留 90 天）；還原時才有少量讀取費
gcloud storage buckets create "$BUCKET" --project "$P" --location asia-east1 \
  --default-storage-class NEARLINE --uniform-bucket-level-access --public-access-prevention

LIFECYCLE=$(mktemp)
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > "$LIFECYCLE"
gcloud storage buckets update "$BUCKET" --lifecycle-file "$LIFECYCLE"
rm -f "$LIFECYCLE"

gcloud iam service-accounts create github-backup --project "$P" \
  --display-name "GitHub Actions Back4App 備份"

gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectCreator --format=none

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$P" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --format=none

echo "GCP 端設定完成"
