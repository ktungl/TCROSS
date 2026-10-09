import logging
import os
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parse_auth import (
    activities_referencing,
    activity_exists,
    find_generation_jobs_for_object_paths,
    get_activity,
    get_generation_job,
    verify_session_token,
    write_with_master_key,
)
from report import analyze_sources, build_report_docx
from storage import delete_object, generate_signed_download_url, generate_signed_upload_url, upload_bytes
from utils import (
    ATTACHMENT_FOLDERS,
    is_extension_blocked,
    is_valid_object_path,
    parse_attachment_path,
    sanitize_filename,
)

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

# 每個 GenerationJob 最多幾個素材檔：素材越多，Gemini 的 token 費用越高，這裡設上限
# 避免一次丟進大量照片／影片。前端 AiGenerationModal.vue 的 MAX_SOURCE_FILES 要一起改。
MAX_SOURCE_FILES = int(os.environ.get("MAX_SOURCE_FILES", "20"))

# 停在 processing 超過這麼久，視為 instance 中途被砍掉的殘留工作，允許重新觸發。
# 要比 Cloud Run 的 --timeout（900 秒）長，避免把還在跑的工作重複觸發（重複計費）。
STALE_PROCESSING_AFTER = timedelta(minutes=20)


class SignedUrlFile(BaseModel):
    folder: str
    filename: str
    contentType: str


class SignedUrlRequest(BaseModel):
    """一個 activityId 對多個檔案：驗證 session／activity 只做一次，
    再對每個檔案各簽一支 URL——取代先前「一個檔案一次請求」的作法。"""

    activityId: str
    files: list[SignedUrlFile]


class DownloadUrlRequest(BaseModel):
    objectPath: str


class DeleteObjectsRequest(BaseModel):
    objectPaths: list[str]
    # 選填：孤兒檔案清理用（例如上傳到一半失敗、或使用者中途放棄，還沒建立
    # GenerationJob 就要把已上傳到 GCS 的檔案清掉）。有帶這個欄位時，授權條件
    # 改成跟 /signed-url 一樣「能讀到這個 activity」，不要求 objectPath 已經
    # 掛在某個 GenerationJob 上——反正這批路徑本來就是同一個 activityId 剛簽出來的。
    activityId: str | None = None


# 活動附件（/attachments/*）：前端 FileMeta.url 存成 "gcs:" + GCS 路徑，跟舊的 Back4App
# 網址區分。上限與 src/types.ts MAX_FILE_SIZE_BYTES、cloud/main.js 一致。
ATTACHMENT_URL_PREFIX = "gcs:"
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
MAX_ATTACHMENT_UPLOADS_PER_REQUEST = 50
MAX_ATTACHMENT_VIEWS_PER_REQUEST = 300


class AttachmentUploadFile(BaseModel):
    filename: str
    contentType: str
    size: int


class AttachmentUploadRequest(BaseModel):
    activityId: str
    folder: str
    files: list[AttachmentUploadFile]


class AttachmentViewItem(BaseModel):
    path: str
    # 原始檔名（可含中文），讓瀏覽器開啟／另存時顯示原名，而不是 GCS 上清過的物件名稱
    name: str | None = None


class AttachmentViewRequest(BaseModel):
    items: list[AttachmentViewItem]


class AttachmentDeleteRequest(BaseModel):
    paths: list[str]


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
    if not body.files:
        raise HTTPException(400, "files 不能為空")
    if len(body.files) > MAX_SOURCE_FILES:
        raise HTTPException(400, f"一次最多只能上傳 {MAX_SOURCE_FILES} 個檔案")
    for f in body.files:
        if f.folder not in ALLOWED_FOLDERS:
            raise HTTPException(400, f"folder 必須是 {sorted(ALLOWED_FOLDERS)} 其中之一")
        if is_extension_blocked(f.filename):
            raise HTTPException(400, "此檔案類型不允許上傳")
    if not activity_exists(user["sessionToken"], body.activityId):
        audit_log.warning("rejected: unauthorized activityId user=%s activityId=%s", user.get("username"), body.activityId)
        raise HTTPException(403, "activityId 不存在或無權存取")

    results = []
    object_paths = []
    for f in body.files:
        unique_name = f"{uuid.uuid4().hex[:8]}_{sanitize_filename(f.filename)}"
        object_path = f"activities/{body.activityId}/{f.folder}/{unique_name}"
        upload_url = generate_signed_upload_url(object_path, f.contentType)
        results.append({"uploadUrl": upload_url, "objectPath": object_path})
        object_paths.append(object_path)

    audit_log.info(
        "signed-url issued user=%s activityId=%s count=%d objectPaths=%s",
        user.get("username"), body.activityId, len(object_paths), object_paths,
    )
    return {"files": results}


@app.post("/download-url")
def download_url(body: DownloadUrlRequest, user: dict = Depends(enforce_rate_limit)):
    if not is_valid_object_path(body.objectPath):
        raise HTTPException(400, "objectPath 不合法")
    matched = find_generation_jobs_for_object_paths(user["sessionToken"], [body.objectPath])
    if body.objectPath not in matched:
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

    if body.activityId is not None:
        if not activity_exists(user["sessionToken"], body.activityId):
            audit_log.warning("rejected: unauthorized activityId user=%s activityId=%s", user.get("username"), body.activityId)
            raise HTTPException(403, "activityId 不存在或無權存取")
        prefix = f"activities/{body.activityId}/"
        mismatched = [p for p in body.objectPaths if not p.startswith(prefix)]
        if mismatched:
            raise HTTPException(400, "objectPath 與 activityId 不符")
    else:
        matched = find_generation_jobs_for_object_paths(user["sessionToken"], body.objectPaths)
        unauthorized = [p for p in body.objectPaths if p not in matched]
        if unauthorized:
            audit_log.warning("rejected: unauthorized objectPaths user=%s objectPaths=%s", user.get("username"), unauthorized)
            raise HTTPException(403, "部分 objectPath 不存在或無權存取")

    for path in body.objectPaths:
        delete_object(path)
    audit_log.info("objects deleted user=%s count=%d objectPaths=%s", user.get("username"), len(body.objectPaths), body.objectPaths)
    return {"deleted": len(body.objectPaths)}


@app.post("/attachments/upload-urls")
def attachment_upload_urls(body: AttachmentUploadRequest, user: dict = Depends(enforce_rate_limit)):
    """Signed PUT URLs for activity attachments. Same checks as /signed-url (session,
    activity readable, blocked extensions), plus a GCS-enforced 50MB cap."""
    if body.folder not in ATTACHMENT_FOLDERS:
        raise HTTPException(400, f"folder 必須是 {sorted(ATTACHMENT_FOLDERS)} 其中之一")
    if not body.files:
        raise HTTPException(400, "files 不能為空")
    if len(body.files) > MAX_ATTACHMENT_UPLOADS_PER_REQUEST:
        raise HTTPException(400, f"一次最多只能上傳 {MAX_ATTACHMENT_UPLOADS_PER_REQUEST} 個檔案")
    for f in body.files:
        if is_extension_blocked(f.filename):
            raise HTTPException(400, f"「{f.filename}」的檔案類型不允許上傳")
        if f.size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(400, f"「{f.filename}」超過上傳大小上限（50MB）")
    if not activity_exists(user["sessionToken"], body.activityId):
        audit_log.warning("rejected: unauthorized activityId user=%s activityId=%s", user.get("username"), body.activityId)
        raise HTTPException(403, "activityId 不存在或無權存取")

    results = []
    for f in body.files:
        object_path = f"attachments/{body.activityId}/{body.folder}/{uuid.uuid4().hex[:8]}_{sanitize_filename(f.filename)}"
        results.append({
            "uploadUrl": generate_signed_upload_url(object_path, f.contentType, MAX_ATTACHMENT_BYTES),
            "url": ATTACHMENT_URL_PREFIX + object_path,
        })
    audit_log.info(
        "attachment upload-urls issued user=%s activityId=%s folder=%s urls=%s",
        user.get("username"), body.activityId, body.folder, [r["url"] for r in results],
    )
    return {"files": results}


@app.post("/attachments/view-urls")
def attachment_view_urls(body: AttachmentViewRequest, user: dict = Depends(enforce_rate_limit)):
    """Batch of 15-minute signed GET URLs for displaying/downloading attachments.

    Authorization: the caller must be able to read the activity the object was
    uploaded under, or — for a file reused via「歷史檔案」whose original activity is
    gone — some activity that still references it."""
    if len(body.items) > MAX_ATTACHMENT_VIEWS_PER_REQUEST:
        raise HTTPException(400, f"一次最多 {MAX_ATTACHMENT_VIEWS_PER_REQUEST} 個檔案")
    parsed = {}
    for item in body.items:
        info = parse_attachment_path(item.path)
        if not info:
            raise HTTPException(400, "path 不合法")
        parsed[item.path] = info

    readable: dict[str, bool] = {}

    def can_read(activity_id: str) -> bool:
        if activity_id not in readable:
            readable[activity_id] = activity_exists(user["sessionToken"], activity_id)
        return readable[activity_id]

    denied = [p for p, (activity_id, _) in parsed.items() if not can_read(activity_id)]
    if denied:
        refs = activities_referencing({ATTACHMENT_URL_PREFIX + p for p in denied})
        still_denied = [
            p for p in denied
            if not any(can_read(a) for a in refs.get(ATTACHMENT_URL_PREFIX + p, ()))
        ]
        if still_denied:
            audit_log.warning("rejected: unauthorized attachment paths user=%s paths=%s", user.get("username"), still_denied)
            raise HTTPException(403, "部分附件不存在或無權存取")

    urls = {item.path: generate_signed_download_url(item.path, item.name) for item in body.items}
    audit_log.info("attachment view-urls issued user=%s count=%d", user.get("username"), len(urls))
    return {"urls": urls}


@app.post("/attachments/delete")
def attachment_delete(body: AttachmentDeleteRequest, user: dict = Depends(enforce_rate_limit)):
    """Delete attachment objects that no activity references any more. Called by the
    frontend after it has removed the item from the activity (「永久刪除」, or deleting
    the whole activity). Anything still referenced — e.g. the same file attached to
    another activity via「歷史檔案」, or still in some activity's trash — is kept."""
    parsed = {}
    for path in body.paths:
        info = parse_attachment_path(path)
        if not info:
            raise HTTPException(400, "path 不合法")
        parsed[path] = info
    refs = activities_referencing({ATTACHMENT_URL_PREFIX + p for p in parsed})
    deleted, kept = [], []
    for path in parsed:
        if refs.get(ATTACHMENT_URL_PREFIX + path):
            kept.append(path)
        else:
            delete_object(path)
            deleted.append(path)
    audit_log.info("attachments deleted user=%s deleted=%s kept=%s", user.get("username"), deleted, kept)
    return {"deleted": deleted, "kept": kept}


def _is_stale_processing(job: dict) -> bool:
    updated_at = job.get("updatedAt")
    if job["status"] != "processing" or not updated_at:
        return False
    updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - updated > STALE_PROCESSING_AFTER


@app.post("/generate/{job_id}")
def trigger_generation(job_id: str, user: dict = Depends(enforce_rate_limit)):
    """Phase 3b trigger: frontend calls this right after creating a pending
    GenerationJob. The whole generation (Gemini + docx assembly + GCS write +
    Parse write-back) runs inside this request, so Cloud Run can stay on
    request-based billing (CPU throttled between requests) instead of the
    always-allocated CPU a post-response BackgroundTask would need. The frontend
    doesn't wait on this response — it learns the outcome by polling
    GenerationJob.status every 5s, same as before."""
    job = get_generation_job(user["sessionToken"], job_id)
    if not job or not job["activityId"]:
        audit_log.warning("rejected: unauthorized generationJob user=%s jobId=%s", user.get("username"), job_id)
        raise HTTPException(403, "generationJob 不存在或無權存取")
    if job["status"] != "pending" and not _is_stale_processing(job):
        raise HTTPException(409, f"這筆工作目前狀態是「{job['status']}」，無法重複觸發")
    if len(job["sourceFiles"]) > MAX_SOURCE_FILES:
        raise HTTPException(400, f"素材檔案最多 {MAX_SOURCE_FILES} 個")
    # sourceFiles 是使用者自己寫進 GenerationJob 的字串，Cloud Code 只檢查型別；這裡要確認
    # 每個路徑都在這筆工作所屬活動底下，否則 Gemini 會用服務帳號讀到桶裡任意物件並寫進報告。
    source_prefix = f"activities/{job['activityId']}/"
    if any(
        not isinstance(p, str) or not is_valid_object_path(p) or not p.startswith(source_prefix)
        for p in job["sourceFiles"]
    ):
        audit_log.warning("rejected: invalid sourceFiles user=%s jobId=%s", user.get("username"), job_id)
        raise HTTPException(400, "素材檔案路徑不合法")

    activity = get_activity(user["sessionToken"], job["activityId"])
    activity_name = (activity or {}).get("name", "")

    write_with_master_key("GenerationJob", job_id, {"status": "processing"})
    audit_log.info(
        "generation triggered user=%s jobId=%s activityId=%s sourceCount=%d",
        user.get("username"), job_id, job["activityId"], len(job["sourceFiles"]),
    )
    status = _run_generation(job_id, job["activityId"], activity_name, job["sourceFiles"])
    return {"status": status}


def _run_generation(job_id: str, activity_id: str, activity_name: str, source_paths: list[str]) -> str:
    try:
        analysis = analyze_sources(source_paths)
        docx_bytes = build_report_docx(activity_name, analysis)
        result_path = f"activities/{activity_id}/generated/{job_id}.docx"
        upload_bytes(
            result_path,
            docx_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        write_with_master_key("GenerationJob", job_id, {"status": "done", "resultFile": result_path})
        audit_log.info("generation done jobId=%s resultFile=%s", job_id, result_path)
        return "done"
    except Exception as exc:  # noqa: BLE001 — any failure here must still flip status away from "processing"
        audit_log.exception("generation failed jobId=%s", job_id)
        write_with_master_key("GenerationJob", job_id, {"status": "error", "errorMessage": str(exc)[:500]})
        return "error"