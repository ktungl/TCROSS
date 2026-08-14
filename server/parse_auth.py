import os

import httpx

PARSE_SERVER_URL = os.environ["PARSE_SERVER_URL"].rstrip("/")
PARSE_APP_ID = os.environ["PARSE_APP_ID"]
PARSE_JS_KEY = os.environ["PARSE_JS_KEY"]
PARSE_MASTER_KEY = os.environ.get("PARSE_MASTER_KEY")


def verify_session_token(session_token: str) -> dict | None:
    """Confirm a Parse session token is valid using the JS Key only (no Master Key)."""
    if not session_token:
        return None
    resp = httpx.get(
        f"{PARSE_SERVER_URL}/users/me",
        headers={
            "X-Parse-Application-Id": PARSE_APP_ID,
            "X-Parse-JavaScript-Key": PARSE_JS_KEY,
            "X-Parse-Session-Token": session_token,
        },
        timeout=10,
    )
    if resp.status_code != 200:
        return None
    return resp.json()


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
