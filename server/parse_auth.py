import json
import os

import httpx

PARSE_SERVER_URL = os.environ["PARSE_SERVER_URL"].rstrip("/")
PARSE_APP_ID = os.environ["PARSE_APP_ID"]
PARSE_JS_KEY = os.environ["PARSE_JS_KEY"]
PARSE_MASTER_KEY = os.environ.get("PARSE_MASTER_KEY")


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
    resp = httpx.get(f"{PARSE_SERVER_URL}/users/me", headers=_user_headers(session_token), timeout=10)
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
    resp = httpx.get(
        f"{PARSE_SERVER_URL}/classes/Activity/{activity_id}",
        headers=_user_headers(session_token),
        timeout=10,
    )
    return resp.status_code == 200


def find_generation_job_for_object_path(session_token: str, object_path: str) -> dict | None:
    """Return the GenerationJob that references object_path (as a sourceFiles entry
    or as resultFile), queried under the caller's own session token. Used by
    /download-url and /delete-objects so those endpoints only ever act on a path
    that's actually attached to a job this user can currently read — not just any
    string shaped like an object path."""
    where = json.dumps({"$or": [{"sourceFiles": object_path}, {"resultFile": object_path}]})
    resp = httpx.get(
        f"{PARSE_SERVER_URL}/classes/GenerationJob",
        headers=_user_headers(session_token),
        params={"where": where, "limit": 1},
        timeout=10,
    )
    if resp.status_code != 200:
        return None
    results = resp.json().get("results", [])
    return results[0] if results else None


def write_with_master_key(class_name: str, object_id: str, fields: dict) -> dict:
    """
    Update a Parse object using the Master Key. The Master Key only ever lives in
    this service's environment — it must never be shipped to the frontend bundle.

    Not called by any endpoint yet: this is the write-back primitive Phase 2/3
    (GenerationJob + Gemini result write-back) will use once that data model exists.
    """
    if not PARSE_MASTER_KEY:
        raise RuntimeError("PARSE_MASTER_KEY 未設定")
    resp = httpx.put(
        f"{PARSE_SERVER_URL}/classes/{class_name}/{object_id}",
        headers={
            "X-Parse-Application-Id": PARSE_APP_ID,
            "X-Parse-Master-Key": PARSE_MASTER_KEY,
            "Content-Type": "application/json",
        },
        json=fields,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()
