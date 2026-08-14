import os
import re

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def sanitize_filename(filename: str) -> str:
    base = os.path.basename(filename)
    cleaned = _UNSAFE_CHARS.sub("_", base).strip("._") or "file"
    return cleaned
