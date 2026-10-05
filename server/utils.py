import os
import re

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")

# Mirrors src/types.ts BLOCKED_EXTENSIONS / cloud/main.js BLOCKED_EXTENSIONS — keep
# the three lists in sync if this changes. There's no size cap enforced here: the
# client PUTs straight to GCS with a signed URL, and a plain v4 signed PUT URL has
# no way to cap the body size (that needs a signed POST policy with a
# content-length-range condition instead, which isn't implemented yet).
BLOCKED_EXTENSIONS = {
    "exe", "bat", "cmd", "com", "scr", "msi", "msp", "dll", "ps1", "psm1",
    "vbs", "vbe", "js", "jse", "jar", "apk", "sh", "app", "cpl", "gadget",
    "pif", "wsf", "wsh", "hta", "lnk", "reg",
}


def sanitize_filename(filename: str) -> str:
    """ASCII-only object name that keeps the extension: 中文檔名「測試照片.png」以前會被清成
    「png」（點跟著底線一起被 strip 掉），GCS 生命週期規則靠副檔名比對就失效了。"""
    base = os.path.basename(filename)
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    stem = _UNSAFE_CHARS.sub("_", stem).strip("._") or "file"
    ext = _UNSAFE_CHARS.sub("", ext)
    return f"{stem}.{ext}" if ext else stem


def is_extension_blocked(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in BLOCKED_EXTENSIONS


# 活動附件（照片、簽到表等 8 類）的 GCS 路徑：attachments/{activityId}/{分類}/{亂數}_{檔名}。
# 跟 AI 生成素材的 activities/ 分開，因為 activities/ 底下的照片／影音有 30 天自動刪除規則。
# 分類對應 src/types.ts 的 AttachmentKey。
ATTACHMENT_FOLDERS = {"photo", "signIn", "record", "agenda", "document", "receipt", "social", "media"}
_ATTACHMENT_PATH = re.compile(r"^attachments/([A-Za-z0-9]{1,32})/([A-Za-z]+)/[A-Za-z0-9._-]+$")


def parse_attachment_path(object_path: str) -> tuple[str, str] | None:
    """Return (activityId, folder) for a well-formed attachment path, else None."""
    if not isinstance(object_path, str) or ".." in object_path:
        return None
    m = _ATTACHMENT_PATH.match(object_path)
    if not m or m.group(2) not in ATTACHMENT_FOLDERS:
        return None
    return m.group(1), m.group(2)


def is_valid_object_path(object_path: str) -> bool:
    """Reject anything outside the activities/ prefix this service itself writes
    under, so an authenticated user can't mint a signed URL for arbitrary bucket
    contents (e.g. another Cloud Run source archive)."""
    return (
        isinstance(object_path, str)
        and object_path.startswith("activities/")
        and ".." not in object_path
    )
