"""Phase 3b: call Vertex AI Gemini on a GenerationJob's uploaded source files,
then assemble the structured result into a real .docx report. See ROADMAP.md
「GCP 整合進度」Phase 3b for the architecture this implements."""

import io
import json
import mimetypes
import os

from docx import Document
from google import genai
from google.genai import types

GCP_PROJECT = os.environ["GCP_PROJECT"]
GCP_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GCS_BUCKET = os.environ["GCS_BUCKET"]

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """Cached per Cloud Run instance, same pattern as storage._client() — picks
    up the runtime service account's ADC automatically (needs roles/aiplatform.user
    granted on it, see server/README.md)."""
    global _client
    if _client is None:
        _client = genai.Client(vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION)
    return _client


_MIME_FALLBACK_BY_FOLDER = {
    "photo": "image/jpeg",
    "audio": "audio/mpeg",
    "video": "video/mp4",
    "doc": "application/pdf",
}


def _guess_mime_type(object_path: str) -> str:
    guessed, _ = mimetypes.guess_type(object_path)
    if guessed:
        return guessed
    # Fallback by the ALLOWED_FOLDERS segment (activities/{id}/{folder}/{filename})
    # for extensionless or unrecognized filenames.
    parts = object_path.split("/")
    folder = parts[2] if len(parts) > 2 else ""
    return _MIME_FALLBACK_BY_FOLDER.get(folder, "application/octet-stream")


_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING"},
        "highlights": {"type": "ARRAY", "items": {"type": "STRING"}},
        "kpis": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "k": {"type": "STRING"},
                    "v": {"type": "STRING"},
                    "u": {"type": "STRING"},
                },
                "required": ["k", "v"],
            },
        },
    },
    "required": ["summary", "highlights", "kpis"],
}

_PROMPT = (
    "你是社福機構的活動成果報告助手。以下是一場活動上傳的原始素材（照片／錄音／影片／文件），"
    "請閱讀並歸納，用繁體中文回覆：\n"
    "1. summary：活動內容簡述與效益（2-4 句話）\n"
    "2. highlights：3-6 條重點條列\n"
    "3. kpis：能從素材中直接辨識出的量化成果指標（例如參加人數、場次數），"
    "k=項目名稱、v=數值、u=單位；素材中看不出可量化的指標就回傳空陣列，不要杜撰數字。"
)


def analyze_sources(object_paths: list[str]) -> dict:
    """Feed the job's uploaded files to Gemini directly as GCS URIs (no need to
    download them into this service first) and ask for structured JSON back."""
    if not object_paths:
        raise ValueError("沒有任何素材檔案")
    parts = [
        types.Part.from_uri(file_uri=f"gs://{GCS_BUCKET}/{path}", mime_type=_guess_mime_type(path))
        for path in object_paths
    ]
    parts.append(types.Part.from_text(text=_PROMPT))
    response = _get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(role="user", parts=parts),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
        ),
    )
    data = json.loads(response.text)
    return {
        "summary": str(data.get("summary") or ""),
        "highlights": [str(h) for h in (data.get("highlights") or [])],
        "kpis": [
            {"k": str(k.get("k", "")), "v": str(k.get("v", "")), "u": str(k.get("u", ""))}
            for k in (data.get("kpis") or [])
        ],
    }


def build_report_docx(activity_name: str, analysis: dict) -> bytes:
    """Assemble the Gemini analysis into a real .docx — this is a genuine Word
    file (python-docx), not the renamed-HTML trick the old frontend export used
    before OPERATIONS.md 範本修改流程 fixed that for the manual exports."""
    doc = Document()
    doc.add_heading(activity_name or "活動成果報告", level=1)

    doc.add_heading("摘要", level=2)
    doc.add_paragraph(analysis["summary"] or "（無摘要）")

    if analysis["highlights"]:
        doc.add_heading("重點", level=2)
        for item in analysis["highlights"]:
            doc.add_paragraph(item, style="List Bullet")

    if analysis["kpis"]:
        doc.add_heading("成果指標", level=2)
        table = doc.add_table(rows=1, cols=3)
        table.style = "Light Grid Accent 1"
        header = table.rows[0].cells
        header[0].text, header[1].text, header[2].text = "項目", "數值", "單位"
        for kpi in analysis["kpis"]:
            row = table.add_row().cells
            row[0].text, row[1].text, row[2].text = kpi["k"], kpi["v"], kpi["u"]

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
