import os
import uuid

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parse_auth import verify_session_token
from storage import generate_signed_upload_url
from utils import sanitize_filename

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


# 這裡已經把原本會被 GCP 攔截的 /healthz 替換成了 /status
@app.get("/status")
def status():
    return {"ok": True}


@app.post("/signed-url")
def signed_url(body: SignedUrlRequest, authorization: str = Header(...)):
    if body.folder not in ALLOWED_FOLDERS:
        raise HTTPException(400, f"folder 必須是 {sorted(ALLOWED_FOLDERS)} 其中之一")

    session_token = authorization.removeprefix("Bearer ").strip()
    user = verify_session_token(session_token)
    if not user:
        raise HTTPException(401, "無效的登入憑證")

    unique_name = f"{uuid.uuid4().hex[:8]}_{sanitize_filename(body.filename)}"
    object_path = f"activities/{body.activityId}/{body.folder}/{unique_name}"

    upload_url = generate_signed_upload_url(object_path, body.contentType)
    return {"uploadUrl": upload_url, "objectPath": object_path}