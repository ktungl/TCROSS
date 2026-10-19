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
    # 瀏覽器會當成網頁執行的格式：放進 GCS 後用簽名網址開啟，就成了掛在
    # storage.googleapis.com 底下的釣魚頁
    "html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "mht", "mhtml",
}

# 上傳時允許簽進網址的 Content-Type，要跟 src/lib/attachments.ts 的 ALLOWED_CONTENT_TYPES
# 一致（前端遇到白名單外的類型會改送 application/octet-stream，所以正常操作不會被擋）。
# 不收 text/html、image/svg+xml、XML 之類瀏覽器會執行腳本的類型。
ALLOWED_CONTENT_TYPES = {
    "application/octet-stream", "application/pdf", "text/csv", "text/plain",
    "application/zip", "application/x-zip-compressed", "application/rtf", "text/rtf",
    "application/msword",
}
ALLOWED_CONTENT_TYPE_PREFIXES = (
    "image/", "video/", "audio/",
    "application/vnd.openxmlformats-officedocument.", "application/vnd.ms-",
    "application/vnd.oasis.opendocument.",
)


def is_content_type_allowed(content_type: str) -> bool:
    t = content_type.split(";", 1)[0].strip().lower()
    if t == "image/svg+xml":
        return False
    return t in ALLOWED_CONTENT_TYPES or t.startswith(ALLOWED_CONTENT_TYPE_PREFIXES)


# 下載網址只有這些副檔名用 inline 開啟（並強制回應的 Content-Type），其他一律 attachment
# 下載：就算物件當初存成 text/html，瀏覽器也不會把它當網頁執行。<img>／<video> 不受
# Content-Disposition 影響，畫面上的縮圖與播放照常。
INLINE_CONTENT_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "bmp": "image/bmp", "heic": "image/heic", "heif": "image/heif",
    "avif": "image/avif",
    "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime", "webm": "video/webm",
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "aac": "audio/aac", "ogg": "audio/ogg",
    "pdf": "application/pdf",
}


def inline_content_type(object_path: str) -> str | None:
    """可以 inline 開啟的話回傳要強制的 Content-Type，否則 None（改用 attachment）。"""
    name = object_path.rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return INLINE_CONTENT_TYPES.get(ext)


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
    # Check the name that will actually be stored: sanitize_filename() strips
    # trailing dots, so "evil.exe." would otherwise slip past as an empty extension
    # and land in GCS as "evil.exe". Also check the raw name with trailing
    # dots/spaces removed (Windows drops them on save).
    for name in (sanitize_filename(filename), filename.rstrip(". \t")):
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in BLOCKED_EXTENSIONS:
            return True
    return False


# 活動附件（照片、簽到表等 8 類）的 GCS 路徑：attachments/{activityId}/{分類}/{亂數}_{檔名}。
# 跟 AI 生成素材的 activities/ 分開，因為 activities/ 底下的照片／影音有 30 天自動刪除規則。
# 分類對應 src/types.ts 的 AttachmentKey。
ATTACHMENT_FOLDERS = {"registration", "content", "photo", "signIn", "record", "agenda", "document", "receipt", "social", "media"}
# 檔名段不能含「/」，所以檔名裡的「..」（例如 sanitize_filename 留下的「v1..2.pdf」）不會造成路徑穿越，
# 只擋整段都是點的名稱。
_ATTACHMENT_PATH = re.compile(r"^attachments/([A-Za-z0-9]{1,32})/([A-Za-z]+)/(?!\.+$)[A-Za-z0-9._-]+$")


def parse_attachment_path(object_path: str) -> tuple[str, str] | None:
    """Return (activityId, folder) for a well-formed attachment path, else None."""
    if not isinstance(object_path, str):
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
