"""TC-25～TC-29：utils.py 的純函式。"""

import pytest

from utils import (
    ATTACHMENT_FOLDERS,
    is_content_type_allowed,
    is_extension_blocked,
    is_valid_object_path,
    parse_attachment_path,
    sanitize_filename,
)


# ── TC-25 ──────────────────────────────────────────────
def test_tc25_sanitize_filename_keeps_png_extension_for_chinese_name():
    result = sanitize_filename("測試照片.png")
    assert result.endswith(".png")
    assert result != "png"
    assert result.isascii()


@pytest.mark.parametrize("name, ext", [
    ("報告 v2.PDF", ".PDF"),
    ("../../etc/活動.jpg", ".jpg"),
    ("簽到表.final.xlsx", ".xlsx"),
])
def test_tc25_sanitize_filename_keeps_extension_variants(name, ext):
    result = sanitize_filename(name)
    assert result.endswith(ext)
    assert "/" not in result and "\\" not in result


# ── TC-26 ──────────────────────────────────────────────
def test_tc26_extension_blocked_with_trailing_dot():
    assert is_extension_blocked("evil.exe.") is True


@pytest.mark.parametrize("name", ["evil.exe", "evil.EXE", "evil.exe. ", "evil.exe...", "page.html", "x.svg"])
def test_tc26_extension_blocked_variants(name):
    assert is_extension_blocked(name) is True


@pytest.mark.parametrize("name", ["photo.jpg", "測試照片.png", "report.docx", "noext"])
def test_tc26_extension_not_blocked_for_normal_files(name):
    assert is_extension_blocked(name) is False


# ── TC-27 ──────────────────────────────────────────────
@pytest.mark.parametrize("path", [
    "activities/abc/../../secret",
    "activities/abc/photo/..",
    "attachments/abc/photo/x.jpg",
    "other/activities/abc/photo/x.jpg",
    "/activities/abc/photo/x.jpg",
    "",
    None,
])
def test_tc27_is_valid_object_path_rejects(path):
    assert is_valid_object_path(path) is False


def test_tc27_is_valid_object_path_accepts_normal_path():
    assert is_valid_object_path("activities/abc123/photo/1a2b3c4d_x.jpg") is True


# ── TC-28 ──────────────────────────────────────────────
@pytest.mark.parametrize("ct", ["image/svg+xml", "IMAGE/SVG+XML", "image/svg+xml; charset=utf-8"])
def test_tc28_svg_content_type_not_allowed(ct):
    assert is_content_type_allowed(ct) is False


@pytest.mark.parametrize("ct", ["text/html", "application/xhtml+xml", "application/xml"])
def test_tc28_script_capable_types_not_allowed(ct):
    assert is_content_type_allowed(ct) is False


@pytest.mark.parametrize("ct", ["image/png", "video/mp4", "application/pdf", "application/octet-stream"])
def test_tc28_normal_types_allowed(ct):
    assert is_content_type_allowed(ct) is True


# ── TC-29 ──────────────────────────────────────────────
@pytest.mark.parametrize("folder", ["evil", "audio", "video", "doc", "generated", "Photo"])
def test_tc29_parse_attachment_path_rejects_unknown_folder(folder):
    assert folder not in ATTACHMENT_FOLDERS
    assert parse_attachment_path(f"attachments/abc123/{folder}/1a2b_x.jpg") is None


@pytest.mark.parametrize("path", [
    "attachments/abc123/photo/..",
    "attachments/abc123/photo/a/b.jpg",
    "activities/abc123/photo/x.jpg",
    "attachments/abc-123/photo/x.jpg",
    None,
])
def test_tc29_parse_attachment_path_rejects_malformed(path):
    assert parse_attachment_path(path) is None


def test_tc29_parse_attachment_path_accepts_allowed_folder():
    assert parse_attachment_path("attachments/abc123/signIn/1a2b_x.jpg") == ("abc123", "signIn")
