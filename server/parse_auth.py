import json
import os

import httpx

PARSE_SERVER_URL = os.environ["PARSE_SERVER_URL"].rstrip("/")
PARSE_APP_ID = os.environ["PARSE_APP_ID"]
PARSE_JS_KEY = os.environ["PARSE_JS_KEY"]
PARSE_MASTER_KEY = os.environ.get("PARSE_MASTER_KEY")

# 共用連線池（keep-alive），避免每次呼叫 Back4App 都重新建一次 TCP/TLS 連線——
# 這在 /signed-url 這種一個請求裡要連打好幾次 Parse REST API 的情境下，能省下
# 重複交握的延遲與 Cloud Run 計費時長。
_client = httpx.Client(timeout=10)


def _user_headers(session_token: str) -> dict:
    return {
        "X-Parse-Application-Id": PARSE_APP_ID,
        "X-Parse-JavaScript-Key": PARSE_JS_KEY,
        "X-Parse-Session-Token": session_token,
    }


def verify_session_token(session_token: str) -> dict | None:
    """Confirm a Parse session token is valid using the JS Key only (no Master Key)."""
    if not session_token:
        return None
    resp = _client.get(f"{PARSE_SERVER_URL}/users/me", headers=_user_headers(session_token))
    if resp.status_code != 200:
        return None
    return resp.json()


def activity_exists(session_token: str, activity_id: str) -> bool:
    """Confirm activity_id is a real Activity the caller can currently read (under
    their own session token — this automatically respects whatever Parse CLP/ACL is
    in effect, including any per-user restriction added later). Used by /signed-url
    so a valid login can't be used to mint uploads under a made-up activity id."""
    if not activity_id:
        return False
    resp = _client.get(
        f"{PARSE_SERVER_URL}/classes/Activity/{activity_id}",
        headers=_user_headers(session_token),
    )
    return resp.status_code == 200


def find_generation_jobs_for_object_paths(session_token: str, object_paths: list[str]) -> dict[str, dict]:
    """Return a {object_path: GenerationJob} map for every path (among object_paths)
    that's referenced as a sourceFiles entry or as resultFile on a job the caller can
    currently read — one Parse query for the whole batch instead of one per path.
    Used by /download-url and /delete-objects so those endpoints only ever act on a
    path that's actually attached to a job this user can currently read — not just
    any string shaped like an object path."""
    if not object_paths:
        return {}
    where = json.dumps(
        {"$or": [{"sourceFiles": {"$in": object_paths}}, {"resultFile": {"$in": object_paths}}]}
    )
    resp = _client.get(
        f"{PARSE_SERVER_URL}/classes/GenerationJob",
        headers=_user_headers(session_token),
        params={"where": where, "limit": len(object_paths)},
    )
    if resp.status_code != 200:
        return {}
    matched: dict[str, dict] = {}
    for job in resp.json().get("results", []):
        for path in (*job.get("sourceFiles", []), job.get("resultFile")):
            if path in object_paths:
                matched[path] = job
    return matched


def get_activity(session_token: str, activity_id: str) -> dict | None:
    """Fetch the full Activity record the caller can currently read — used by
    /generate to get the activity name for the generated report's title."""
    resp = _client.get(
        f"{PARSE_SERVER_URL}/classes/Activity/{activity_id}",
        headers=_user_headers(session_token),
    )
    if resp.status_code != 200:
        return None
    return resp.json()


def get_generation_job(session_token: str, job_id: str) -> dict | None:
    """Fetch a GenerationJob the caller can currently read (Parse REST + the
    caller's own session token, so it respects CLP/ACL like the other helpers
    here) — used by /generate to confirm the caller may trigger this specific
    job before doing any work."""
    resp = _client.get(
        f"{PARSE_SERVER_URL}/classes/GenerationJob/{job_id}",
        headers=_user_headers(session_token),
    )
    if resp.status_code != 200:
        return None
    body = resp.json()
    activity_ptr = body.get("activity") or {}
    return {
        "status": body.get("status", "pending"),
        "kind": body.get("kind", "成果報告"),
        "sourceFiles": body.get("sourceFiles") or [],
        "activityId": activity_ptr.get("objectId", ""),
    }


def write_with_master_key(class_name: str, object_id: str, fields: dict) -> dict:
    """
    Update a Parse object using the Master Key. The Master Key only ever lives in
    this service's environment — it must never be shipped to the frontend bundle.

    Used by /generate (Phase 3b) to move a GenerationJob through
    processing/done/error and attach resultFile once Gemini + document assembly
    finish, since that happens after the caller's own request/response cycle.
    """
    if not PARSE_MASTER_KEY:
        raise RuntimeError("PARSE_MASTER_KEY 未設定")
    resp = _client.put(
        f"{PARSE_SERVER_URL}/classes/{class_name}/{object_id}",
        headers={
            "X-Parse-Application-Id": PARSE_APP_ID,
            "X-Parse-Master-Key": PARSE_MASTER_KEY,
            "Content-Type": "application/json",
        },
        json=fields,
    )
    resp.raise_for_status()
    return resp.json()
