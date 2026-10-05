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
    base = os.path.basename(filename)
    cleaned = _UNSAFE_CHARS.sub("_", base).strip("._") or "file"
    return cleaned


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


def is_valid_object_path(object_path: str) -> bool:
    """Reject anything outside the activities/ prefix this service itself writes
    under, so an authenticated user can't mint a signed URL for arbitrary bucket
    contents (e.g. another Cloud Run source archive)."""
    return (
        isinstance(object_path, str)
        and object_path.startswith("activities/")
        and ".." not in object_path
    )
