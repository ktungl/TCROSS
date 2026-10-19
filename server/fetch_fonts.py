"""Docker 建置時下載 AI 報告用的中文字型（Noto Sans TC，SIL OFL）到 REPORT_FONT_DIR。

不放進 git（兩個檔共 11 MB）；從官方 release tag 下載並核對 SHA-256，檔案被換掉就建置失敗。
本機要產 PDF 時，可以把 REPORT_FONT_DIR 指到任一資料夾再跑這支。"""

import hashlib
import os
import urllib.request

BASE = "https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/TC/"
FONTS = {
    "NotoSansTC-Regular.otf": "5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537",
    "NotoSansTC-Bold.otf": "55420b259eb119bf5f2a0aadba10cf9d736c12d64ab93e78546d69ef5f43558b",
}

target = os.environ.get("REPORT_FONT_DIR", "/usr/share/fonts/noto-tc")
os.makedirs(target, exist_ok=True)
for name, sha in FONTS.items():
    data = urllib.request.urlopen(BASE + name, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != sha:
        raise SystemExit(f"{name} 的 SHA-256 不符，停止建置")
    with open(os.path.join(target, name), "wb") as f:
        f.write(data)
    print(f"{name} OK")
