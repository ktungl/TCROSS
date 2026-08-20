import os
import re

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def sanitize_filename(filename: str) -> str:
    base = os.path.basename(filename)
    cleaned = _UNSAFE_CHARS.sub("_", base).strip("._") or "file"
    return cleaned


def is_valid_object_path(object_path: str) -> bool:
    """Reject anything outside the activities/ prefix this service itself writes
    under, so an authenticated user can't mint a signed URL for arbitrary bucket
    contents (e.g. another Cloud Run source archive)."""
    return (
        isinstance(object_path, str)
        and object_path.startswith("activities/")
        and ".." not in object_path
    )
