import os
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parse_auth import verify_session_token
from storage import delete_object, generate_signed_download_url, generate_signed_upload_url
from utils import is_valid_object_path, sanitize_filename

app = FastAPI(title="TCROSS GCP 中介層")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.environ.get("ALLOWED_ORIGIN", "*").split(",")],
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
        raise HTTPException(401, "無效的登入憑證")
    return user


# 這裡已經把原本會被 GCP 攔截的 /healthz 替換成了 /status
@app.get("/status")
def status():
    return {"ok": True}


@app.post("/signed-url")
def signed_url(body: SignedUrlRequest, user: dict = Depends(require_user)):
    if body.folder not in ALLOWED_FOLDERS:
        raise HTTPException(400, f"folder 必須是 {sorted(ALLOWED_FOLDERS)} 其中之一")

    unique_name = f"{uuid.uuid4().hex[:8]}_{sanitize_filename(body.filename)}"
    object_path = f"activities/{body.activityId}/{body.folder}/{unique_name}"

    upload_url = generate_signed_upload_url(object_path, body.contentType)
    return {"uploadUrl": upload_url, "objectPath": object_path}


@app.post("/download-url")
def download_url(body: DownloadUrlRequest, user: dict = Depends(require_user)):
    if not is_valid_object_path(body.objectPath):
        raise HTTPException(400, "objectPath 不合法")

    return {"downloadUrl": generate_signed_download_url(body.objectPath)}


@app.post("/delete-objects")
def delete_objects(body: DeleteObjectsRequest, user: dict = Depends(require_user)):
    """Best-effort cleanup for GenerationJob source/result files once a job is
    deleted from Parse — called by the frontend before it destroys the job record."""
    invalid = [p for p in body.objectPaths if not is_valid_object_path(p)]
    if invalid:
        raise HTTPException(400, "objectPath 不合法")

    for path in body.objectPaths:
        delete_object(path)
    return {"deleted": len(body.objectPaths)}