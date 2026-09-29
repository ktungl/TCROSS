#!/usr/bin/env bash
# 一次性設定：讓 GitHub Actions（.github/workflows/deploy-hosting.yml）能部署到 Firebase Hosting。
# 用 Workload Identity Federation，只有 ktungl/TCROSS 的 main 分支換得到憑證，不產生 JSON 金鑰。
# 需要專案 Owner 權限的 gcloud 帳號執行；重複執行時已存在的資源會報錯略過，不影響結果。
set -u

P=project-80ac5e1a-2ea4-4000-9ff
PN=502746951565
REPO=ktungl/TCROSS
SA=github-deployer@$P.iam.gserviceaccount.com

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project "$P"

gcloud iam service-accounts create github-deployer --project "$P" \
  --display-name "GitHub Actions 前端部署（Firebase Hosting）"

for ROLE in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$SA" \
    --role "$ROLE" --condition=None --format=none
done

gcloud iam workload-identity-pools create github --project "$P" --location global \
  --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc tcross-main --project "$P" \
  --location global --workload-identity-pool github \
  --display-name "ktungl/TCROSS main" \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$P" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --format=none

echo "GCP 端設定完成"
