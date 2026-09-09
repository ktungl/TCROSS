import logging
import os
import time
import uuid
from collections import defaultdict

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parse_auth import activity_exists, find_generation_job_for_object_path, verify_session_token
from storage import delete_object, generate_signed_download_url, generate_signed_upload_url
from utils import is_extension_blocked, is_valid_object_path, sanitize_filename

# 應用層稽核紀錄（ISO 27001 A.8.15／A.8.16）：誰、對什麼物件、做了什麼敏感操作。
# 用 logging 印到 stdout，Cloud Run 會自動收進 Cloud Logging，不用額外接資料庫。
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
audit_log = logging.getLogger("tcross.audit")

app = FastAPI(title="TCROSS GCP 中介層")

# 安全預設值：沒設 ALLOWED_ORIGIN 就直接啟動失敗，而不是預設放行所有來源（"*"）。
# 部署時忘記帶這個環境變數，應該是服務起不來，不該是靜默放行任何網站呼叫這個 API。
_allowed_origin_env = os.environ.get("ALLOWED_ORIGIN", "").strip()
if not _allowed_origin_env:
    raise RuntimeError("ALLOWED_ORIGIN 未設定 — 為避免 CORS 預設放行所有來源，啟動時必須明確指定")
ALLOWED_ORIGINS = [origin.strip() for origin in _allowed_origin_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

ALLOWED_FOLDERS = {"photo", "audio", "video", "doc"}


class SignedUrlRequest(BaseModel):
    activityId: str
    folder: str
    filename: str
    contentType: str


class DownloadUrlRequest(BaseModel):
    objectPath: str


class DeleteObjectsRequest(BaseModel):
    objectPaths: list[str]


def require_user(authorization: str = Header(...)) -> dict:
    """Shared auth dependency — every route that touches GCS or Parse must depend
    on this so a new endpoint can't accidentally ship without the session check."""
    session_token = authorization.removeprefix("Bearer ").strip()
    user = verify_session_token(session_token)
    if not user:
        audit_log.warning("rejected: invalid session token")
        raise HTTPException(401, "無效的登入憑證")
    user["sessionToken"] = session_token
    return user


# 輕量級 rate limit（ISO 27001 A.8.16）：每個使用者每分鐘限制對 GCS 敏感端點的呼叫次數，
# 讓外洩的 session token 不能被拿去無限次簽發下載連結／刪檔。狀態存在記憶體裡，只在單一
# Cloud Run instance 內有效、重啟會歸零——這不是精確的硬上限，只是拉高濫用門檻，之後有需要
# 應該換成 Memorystore/Redis 之類的共用儲存。
_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_REQUESTS = 30
_rate_limit_hits: dict[str, list[float]] = defaultdict(list)


def enforce_rate_limit(user: dict = Depends(require_user)) -> dict:
    key = user.get("objectId") or user.get("username") or "unknown"
    now = time.monotonic()
    hits = _rate_limit_hits[key]
    hits[:] = [t for t in hits if now - t < _RATE_LIMIT_WINDOW_SECONDS]
    if len(hits) >= _RATE_LIMIT_MAX_REQUESTS:
        audit_log.warning("rejected: rate limit exceeded user=%s", key)
        raise HTTPException(429, "請求過於頻繁，請稍後再試")
    hits.append(now)
    return user


# 這裡已經把原本會被 GCP 攔截的 /healthz 替換成了 /status
@app.get("/status")
def status():
    return {"ok": True}


@app.post("/signed-url")
def signed_url(body: SignedUrlRequest, user: dict = Depends(enforce_rate_limit)):
    if body.folder not in ALLOWED_FOLDERS:
        raise HTTPException(400, f"folder 必須是 {sorted(ALLOWED_FOLDERS)} 其中之一")
    if is_extension_blocked(body.filename):
        raise HTTPException(400, "此檔案類型不允許上傳")
    if not activity_exists(user["sessionToken"], body.activityId):
        audit_log.warning("rejected: unauthorized activityId user=%s activityId=%s", user.get("username"), body.activityId)
        raise HTTPException(403, "activityId 不存在或無權存取")

    unique_name = f"{uuid.uuid4().hex[:8]}_{sanitize_filename(body.filename)}"
    object_path = f"activities/{body.activityId}/{body.folder}/{unique_name}"

    upload_url = generate_signed_upload_url(object_path, body.contentType)
    audit_log.info("signed-url issued user=%s activityId=%s objectPath=%s", user.get("username"), body.activityId, object_path)
    return {"uploadUrl": upload_url, "objectPath": object_path}


@app.post("/download-url")
def download_url(body: DownloadUrlRequest, user: dict = Depends(enforce_rate_limit)):
    if not is_valid_object_path(body.objectPath):
        raise HTTPException(400, "objectPath 不合法")
    if not find_generation_job_for_object_path(user["sessionToken"], body.objectPath):
        audit_log.warning("rejected: unauthorized objectPath user=%s objectPath=%s", user.get("username"), body.objectPath)
        raise HTTPException(403, "objectPath 不存在或無權存取")

    audit_log.info("download-url issued user=%s objectPath=%s", user.get("username"), body.objectPath)
    return {"downloadUrl": generate_signed_download_url(body.objectPath)}


@app.post("/delete-objects")
def delete_objects(body: DeleteObjectsRequest, user: dict = Depends(enforce_rate_limit)):
    """Best-effort cleanup for GenerationJob source/result files once a job is
    deleted from Parse — called by the frontend before it destroys the job record."""
    invalid = [p for p in body.objectPaths if not is_valid_object_path(p)]
    if invalid:
        raise HTTPException(400, "objectPath 不合法")
    unauthorized = [
        p for p in body.objectPaths if not find_generation_job_for_object_path(user["sessionToken"], p)
    ]
    if unauthorized:
        audit_log.warning("rejected: unauthorized objectPaths user=%s objectPaths=%s", user.get("username"), unauthorized)
        raise HTTPException(403, "部分 objectPath 不存在或無權存取")

    for path in body.objectPaths:
        delete_object(path)
    audit_log.info("objects deleted user=%s count=%d objectPaths=%s", user.get("username"), len(body.objectPaths), body.objectPaths)
    return {"deleted": len(body.objectPaths)}