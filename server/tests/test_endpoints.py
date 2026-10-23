"""TC-30～TC-34：FastAPI 端點（TestClient；Parse／GCS／Gemini 全部 mock）。"""

from datetime import datetime, timedelta, timezone

import pytest

import main

_IMG = {"data": "aGVsbG8=", "mimeType": "image/jpeg"}

# 每個需要登入的端點，配一份格式正確的 body，確保回應反映的是驗證結果而不是 body 驗證失敗。
ENDPOINTS = [
    ("/signed-url", {"activityId": "act1", "files": [{"folder": "photo", "filename": "a.jpg", "contentType": "image/jpeg", "size": 1024}]}),
    ("/download-url", {"objectPath": "activities/act1/photo/a.jpg"}),
    ("/delete-objects", {"objectPaths": ["activities/act1/photo/a.jpg"]}),
    ("/attachments/upload-urls", {"activityId": "act1", "folder": "photo", "files": [{"filename": "a.jpg", "contentType": "image/jpeg", "size": 10}]}),
    ("/attachments/view-urls", {"items": [{"path": "attachments/act1/photo/a.jpg"}]}),
    ("/attachments/delete", {"paths": ["attachments/act1/photo/a.jpg"]}),
    ("/rewrite/act1", {"format": "x"}),
    ("/assist/sign-in", {"activityId": "act1", "images": [_IMG]}),
    ("/assist/poster", {"image": _IMG, "today": "2026-10-19"}),
    ("/assist/classify", {"text": "親子活動"}),
    ("/assist/document", {"activityId": "act1", "document": _IMG}),
    ("/generate/job1", None),
]
_IDS = [e[0] for e in ENDPOINTS]


@pytest.fixture
def spy_downstream(monkeypatch):
    """把所有下游呼叫換成會記錄的替身：401/403 時要確認它們完全沒被呼叫。"""
    calls = []

    def recorder(name, ret=None):
        def fn(*args, **kwargs):
            calls.append(name)
            return ret
        return fn

    for name, ret in [
        ("activity_exists", True), ("find_generation_jobs_for_object_paths", {}),
        ("readable_activity_ids", set()), ("existing_activity_ids", set()),
        ("activities_referencing", {}), ("get_activity", None), ("get_generation_job", None),
        ("list_names", {}), ("get_plan_names", []), ("write_with_master_key", {}),
        ("generate_signed_upload_url", "https://signed.invalid/up"),
        ("generate_signed_download_url", "https://signed.invalid/down"),
        ("delete_object", None), ("object_exists", True), ("upload_bytes", None),
        ("recognize_sign_in", {}), ("read_poster", {}), ("suggest_classification", {}),
        ("digest_document", {}), ("rewrite_activity", {}),
    ]:
        monkeypatch.setattr(main, name, recorder(name, ret))
    return calls


# ── TC-30 ──────────────────────────────────────────────
@pytest.mark.parametrize("path, body", ENDPOINTS, ids=_IDS)
def test_tc30_no_token_returns_401(client, spy_downstream, path, body):
    """已知產品問題：main.py require_user 用 Header(...) 必填，完全不帶 Authorization 時
    FastAPI 在進入驗證前就回 422（Field required），不是 doc/TESTING.md 預期的 401。
    請求仍被擋下、下游沒被呼叫，但狀態碼不符規格，修正前這組測試會失敗。"""
    resp = client.post(path, json=body)
    assert resp.status_code == 401, resp.text
    assert spy_downstream == []


@pytest.mark.parametrize("path, body", ENDPOINTS, ids=_IDS)
def test_tc30_invalid_token_returns_401(client, spy_downstream, path, body):
    resp = client.post(path, json=body, headers={"Authorization": "Bearer r:forged-token"})
    assert resp.status_code == 401, resp.text
    assert spy_downstream == []


@pytest.mark.parametrize("header", ["", "Bearer ", "Bearer"])
def test_tc30_empty_token_returns_401(client, spy_downstream, header):
    resp = client.post("/download-url", json={"objectPath": "activities/act1/photo/a.jpg"}, headers={"Authorization": header})
    assert resp.status_code == 401, resp.text
    assert spy_downstream == []


def test_tc30_status_is_public(client):
    assert client.get("/status").json() == {"ok": True}


# ── TC-31 ──────────────────────────────────────────────
def test_tc31_31st_call_within_a_minute_returns_429(client, auth, monkeypatch):
    monkeypatch.setattr(main, "find_generation_jobs_for_object_paths", lambda token, paths: {p: {} for p in paths})
    monkeypatch.setattr(main, "generate_signed_download_url", lambda path, name=None: "https://signed.invalid/down")
    body = {"objectPath": "activities/act1/photo/a.jpg"}
    for i in range(30):
        resp = client.post("/download-url", json=body, headers=auth)
        assert resp.status_code == 200, f"第 {i + 1} 次就失敗：{resp.text}"
    resp = client.post("/download-url", json=body, headers=auth)
    assert resp.status_code == 429


def test_tc31_limit_is_per_user_and_window_expires(client, auth, monkeypatch):
    monkeypatch.setattr(main, "find_generation_jobs_for_object_paths", lambda token, paths: {p: {} for p in paths})
    monkeypatch.setattr(main, "generate_signed_download_url", lambda path, name=None: "u")
    clock = [1000.0]
    monkeypatch.setattr(main.time, "monotonic", lambda: clock[0])
    body = {"objectPath": "activities/act1/photo/a.jpg"}
    for _ in range(30):
        assert client.post("/download-url", json=body, headers=auth).status_code == 200
    assert client.post("/download-url", json=body, headers=auth).status_code == 429
    # 另一個使用者不受影響
    monkeypatch.setattr(main, "verify_session_token", lambda t: {"objectId": "user2", "username": "other"})
    assert client.post("/download-url", json=body, headers=auth).status_code == 200
    # 第一位使用者過了 60 秒後恢復
    monkeypatch.setattr(main, "verify_session_token", lambda t: {"objectId": "user1", "username": "tester"})
    clock[0] += 61
    assert client.post("/download-url", json=body, headers=auth).status_code == 200


# ── TC-32 ──────────────────────────────────────────────
def test_tc32_signed_url_for_unreadable_activity_returns_403(client, auth, spy_downstream, monkeypatch):
    monkeypatch.setattr(main, "activity_exists", lambda token, aid: False)
    resp = client.post("/signed-url", json=ENDPOINTS[0][1], headers=auth)
    assert resp.status_code == 403
    assert "generate_signed_upload_url" not in spy_downstream


def test_signed_url_rejects_oversized_file(client, auth, spy_downstream):
    body = {"activityId": "act1", "files": [{"folder": "video", "filename": "big.mp4", "contentType": "video/mp4", "size": main.MAX_UPLOAD_BYTES + 1}]}
    resp = client.post("/signed-url", json=body, headers=auth)
    assert resp.status_code == 400
    assert "generate_signed_upload_url" not in spy_downstream


def test_signed_url_signs_size_cap(client, auth, monkeypatch):
    monkeypatch.setattr(main, "activity_exists", lambda token, aid: True)
    caps = []
    monkeypatch.setattr(main, "generate_signed_upload_url", lambda path, ct, max_bytes=None: caps.append(max_bytes) or "https://signed.invalid/up")
    resp = client.post("/signed-url", json=ENDPOINTS[0][1], headers=auth)
    assert resp.status_code == 200
    assert caps == [main.MAX_UPLOAD_BYTES]


def test_tc32_attachment_upload_urls_for_unreadable_activity_returns_403(client, auth, spy_downstream, monkeypatch):
    monkeypatch.setattr(main, "activity_exists", lambda token, aid: False)
    resp = client.post("/attachments/upload-urls", json=ENDPOINTS[3][1], headers=auth)
    assert resp.status_code == 403
    assert "generate_signed_upload_url" not in spy_downstream


def test_tc32_download_url_for_unreadable_object_returns_403(client, auth, spy_downstream):
    # find_generation_jobs_for_object_paths 預設回 {}：呼叫者讀得到的工作都沒引用這個路徑
    resp = client.post("/download-url", json={"objectPath": "activities/other/generated/job.docx"}, headers=auth)
    assert resp.status_code == 403
    assert "generate_signed_download_url" not in spy_downstream


def test_tc32_attachment_view_urls_skips_unreadable_activity(client, auth, monkeypatch):
    """view-urls 的設計是逐個略過（不整批 403），確認讀不到的那一個拿不到網址。"""
    signed = []
    monkeypatch.setattr(main, "readable_activity_ids", lambda token, ids: {"mine"} & set(ids))
    monkeypatch.setattr(main, "activities_referencing", lambda urls: {})
    monkeypatch.setattr(main, "generate_signed_download_url", lambda path, name=None: signed.append(path) or f"https://s/{path}")
    resp = client.post("/attachments/view-urls", json={"items": [
        {"path": "attachments/mine/photo/a.jpg"},
        {"path": "attachments/other/photo/b.jpg"},
    ]}, headers=auth)
    assert resp.status_code == 200
    assert list(resp.json()["urls"]) == ["attachments/mine/photo/a.jpg"]
    assert signed == ["attachments/mine/photo/a.jpg"]


def test_tc32_attachment_delete_for_unreadable_existing_activity_returns_403(client, auth, spy_downstream, monkeypatch):
    monkeypatch.setattr(main, "readable_activity_ids", lambda token, ids: set())
    monkeypatch.setattr(main, "existing_activity_ids", lambda ids: set(ids))  # 活動還在，只是讀不到
    resp = client.post("/attachments/delete", json={"paths": ["attachments/other/photo/b.jpg"]}, headers=auth)
    assert resp.status_code == 403
    assert "delete_object" not in spy_downstream


# ── TC-33 ──────────────────────────────────────────────
def test_tc33_attachment_delete_keeps_object_referenced_by_other_activity(client, auth, monkeypatch):
    deleted = []
    shared = "attachments/act1/photo/shared.jpg"
    orphan = "attachments/act1/photo/orphan.jpg"
    monkeypatch.setattr(main, "readable_activity_ids", lambda token, ids: set(ids))
    monkeypatch.setattr(main, "existing_activity_ids", lambda ids: set(ids))
    monkeypatch.setattr(main, "activities_referencing", lambda urls: {"gcs:" + shared: {"act2"}} if "gcs:" + shared in urls else {})
    monkeypatch.setattr(main, "delete_object", lambda path: deleted.append(path))
    resp = client.post("/attachments/delete", json={"paths": [shared, orphan]}, headers=auth)
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [orphan], "kept": [shared]}
    assert deleted == [orphan]


def test_tc33_attachment_delete_of_deleted_activity_still_checks_references(client, auth, monkeypatch):
    """原活動已刪除（readable／existing 都沒有），但檔案被「歷史檔案」掛到別的活動：仍不可刪。"""
    deleted = []
    path = "attachments/gone/photo/shared.jpg"
    monkeypatch.setattr(main, "readable_activity_ids", lambda token, ids: set())
    monkeypatch.setattr(main, "existing_activity_ids", lambda ids: set())
    monkeypatch.setattr(main, "activities_referencing", lambda urls: {"gcs:" + path: {"act2"}})
    monkeypatch.setattr(main, "delete_object", lambda p: deleted.append(p))
    resp = client.post("/attachments/delete", json={"paths": [path]}, headers=auth)
    assert resp.status_code == 200
    assert resp.json()["kept"] == [path]
    assert deleted == []


def test_tc33_reference_lookup_failure_does_not_delete(client, auth, monkeypatch):
    """查參照失敗（例如 Parse 錯誤）時不能當成「沒人引用」而刪除。"""
    deleted = []
    monkeypatch.setattr(main, "readable_activity_ids", lambda token, ids: set(ids))

    def boom(urls):
        raise RuntimeError("parse down")

    monkeypatch.setattr(main, "activities_referencing", boom)
    monkeypatch.setattr(main, "delete_object", lambda p: deleted.append(p))
    from fastapi.testclient import TestClient
    resp = TestClient(main.app, raise_server_exceptions=False).post(
        "/attachments/delete", json={"paths": ["attachments/act1/photo/a.jpg"]}, headers=auth)
    assert resp.status_code >= 500
    assert deleted == []


# ── TC-34 ──────────────────────────────────────────────
def _job(status: str, minutes_ago: float) -> dict:
    updated = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")
    return {
        "status": status,
        "kind": "成果報告",
        "sourceFiles": ["activities/act1/photo/a.jpg"],
        "activityId": "act1",
        "updatedAt": updated,
    }


@pytest.fixture
def generation_spy(monkeypatch):
    runs, writes = [], []
    monkeypatch.setattr(main, "get_activity", lambda token, aid: {"objectId": aid, "name": "活動"})
    monkeypatch.setattr(main, "write_with_master_key", lambda cls, oid, fields: writes.append((cls, oid, fields)) or {})
    monkeypatch.setattr(main, "_run_generation", lambda *a, **k: runs.append(a) or "done")
    return runs, writes


def test_tc34_processing_not_stale_is_not_rerun(client, auth, monkeypatch, generation_spy):
    runs, writes = generation_spy
    monkeypatch.setattr(main, "get_generation_job", lambda token, jid: _job("processing", 5))
    resp = client.post("/generate/job1", headers=auth)
    assert resp.status_code == 409
    assert runs == [] and writes == []


def test_tc34_processing_stale_can_rerun(client, auth, monkeypatch, generation_spy):
    runs, writes = generation_spy
    monkeypatch.setattr(main, "get_generation_job", lambda token, jid: _job("processing", 30))
    resp = client.post("/generate/job1", headers=auth)
    assert resp.status_code == 200
    assert resp.json() == {"status": "done"}
    assert len(runs) == 1
    assert writes == [("GenerationJob", "job1", {"status": "processing"})]


@pytest.mark.parametrize("status", ["done", "error"])
def test_tc34_finished_job_is_not_rerun_even_if_old(client, auth, monkeypatch, generation_spy, status):
    runs, _ = generation_spy
    monkeypatch.setattr(main, "get_generation_job", lambda token, jid: _job(status, 600))
    assert client.post("/generate/job1", headers=auth).status_code == 409
    assert runs == []


def test_tc34_stale_rerun_full_pipeline_with_mocks(client, auth, monkeypatch):
    """逾時重跑走完整個 _run_generation（Gemini、GCS 全 mock），最後寫回 done 與 resultFile。"""
    writes, uploads = [], []
    monkeypatch.setattr(main, "get_generation_job", lambda token, jid: _job("processing", 25))
    monkeypatch.setattr(main, "get_activity", lambda token, aid: {"objectId": aid, "name": "親子共讀"})
    monkeypatch.setattr(main, "write_with_master_key", lambda cls, oid, fields: writes.append(fields) or {})
    monkeypatch.setattr(main, "analyze_sources", lambda paths: {"summary": "摘要", "highlights": ["一"], "kpis": []})
    monkeypatch.setattr(main, "upload_bytes", lambda path, data, ct: uploads.append(path))
    monkeypatch.setattr(main, "render_pdf", lambda blocks: b"%PDF-fake")
    resp = client.post("/generate/job1", headers=auth)
    assert resp.json() == {"status": "done"}
    assert uploads == ["activities/act1/generated/job1.docx", "activities/act1/generated/job1.pdf"]
    assert writes[0] == {"status": "processing"}
    assert writes[-1] == {"status": "done", "resultFile": "activities/act1/generated/job1.docx"}


def test_report_download_uses_activity_and_kind_as_filename(client, auth, monkeypatch):
    """AI 報告下載檔名是「活動名_種類」，不是物件名稱裡的工作 ID；檔名不能用的字元換成底線。"""
    path = "activities/act1/generated/job1.docx"
    signed = []
    monkeypatch.setattr(main, "find_generation_jobs_for_object_paths",
                        lambda token, paths: {path: {"activityId": "act1", "kind": "成果報告", "resultFile": path}})
    monkeypatch.setattr(main, "get_activity", lambda token, aid: {"objectId": aid, "name": "會務/2026大事紀"})
    monkeypatch.setattr(main, "object_exists", lambda p: True)
    monkeypatch.setattr(main, "generate_signed_download_url", lambda p, name=None: signed.append((p, name)) or "u")
    assert client.post("/download-url", json={"objectPath": path}, headers=auth).status_code == 200
    assert client.post("/download-url", json={"objectPath": path, "pdf": True}, headers=auth).status_code == 200
    assert signed == [
        (path, "會務_2026大事紀_成果報告.docx"),
        ("activities/act1/generated/job1.pdf", "會務_2026大事紀_成果報告.pdf"),
    ]
