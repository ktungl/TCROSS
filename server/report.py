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
# 照片／影片送進 Gemini 的解析度：LOW 每張圖／每格影格的 token 數只有預設的約 1/4，
# 大幅壓低費用；如果發現簽到表之類小字辨識不出來，再把環境變數改成 MEDIUM／HIGH。
GEMINI_MEDIA_RESOLUTION = os.environ.get("GEMINI_MEDIA_RESOLUTION", "LOW").upper()

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


def generate_json(parts: list, schema: dict, **config) -> dict:
    """Call Gemini with structured-JSON output; shared by report / assist / rewrite."""
    response = _get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(role="user", parts=parts),
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=schema, **config
        ),
    )
    # 被安全過濾擋下或輸出被截斷時 response.text 是 None，直接 json.loads 只會留下看不懂的 TypeError
    if not response.text:
        raise ValueError("AI 沒有回傳內容（可能被內容過濾擋下），請換一份素材再試")
    return json.loads(response.text)


def _generate_json(object_paths: list[str], prompt: str, schema: dict, **config) -> dict:
    """Feed the job's uploaded files to Gemini directly as GCS URIs (no need to
    download them into this service first) and ask for structured JSON back."""
    parts = [
        types.Part.from_uri(file_uri=f"gs://{GCS_BUCKET}/{path}", mime_type=_guess_mime_type(path))
        for path in object_paths
    ]
    parts.append(types.Part.from_text(text=prompt))
    return generate_json(parts, schema, **config)


def analyze_sources(object_paths: list[str]) -> dict:
    if not object_paths:
        raise ValueError("沒有任何素材檔案")
    data = _generate_json(
        object_paths, _PROMPT, _RESPONSE_SCHEMA,
        media_resolution=f"MEDIA_RESOLUTION_{GEMINI_MEDIA_RESOLUTION}",
    )
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


# ── 會議紀錄（AI_UPGRADE_PLAN.md 1-3）──────────────────────────

_MEETING_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "participants": {"type": "ARRAY", "items": {"type": "STRING"}},
        "summary": {"type": "STRING"},
        "discussions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "topic": {"type": "STRING"},
                    "points": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["topic", "points"],
            },
        },
        "decisions": {"type": "ARRAY", "items": {"type": "STRING"}},
        "todos": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "task": {"type": "STRING"},
                    "owner": {"type": "STRING"},
                    "due": {"type": "STRING"},
                },
                "required": ["task", "owner", "due"],
            },
        },
        "notes": {"type": "STRING"},
    },
    "required": ["title", "participants", "summary", "discussions", "decisions", "todos", "notes"],
}

_MEETING_PROMPT = (
    "以上是一場會議的錄音（多個檔案時依序接續）。請整理成會議紀錄，用繁體中文回覆，"
    "只能根據錄音內容，聽不清楚或沒提到的不要杜撰：\n"
    "- title：會議名稱或主題（錄音中沒提到就依內容寫一句話主題）\n"
    "- participants：錄音中有自我介紹或被點名的與會者（姓名或職稱），聽不出來就回傳空陣列，不要猜\n"
    "- summary：3-5 句說明這場會議談了什麼、得到什麼結論\n"
    "- discussions：依議題整理討論重點，每個議題 2-5 點\n"
    "- decisions：明確做成的決議，沒有就回傳空陣列\n"
    "- todos：會後待辦；task 寫要做什麼，owner 寫負責人（錄音中有指定才填，否則空字串），"
    "due 寫期限（照錄音中的說法，例如「下週三前」「10 月底」，沒提到就空字串）\n"
    "- notes：錄音品質不佳、中斷或有聽不清楚的段落時簡短說明，沒有就空字串"
)


def analyze_meeting(object_paths: list[str]) -> dict:
    """錄音直接以 GCS URI 給 Gemini（同 analyze_sources），只回結構化紀錄、不做逐字稿，輸出 token 少。"""
    if not object_paths:
        raise ValueError("沒有任何錄音檔")
    data = _generate_json(object_paths, _MEETING_PROMPT, _MEETING_SCHEMA)

    def strings(values) -> list[str]:
        return [s for s in (str(v).strip() for v in values or []) if s]

    return {
        "title": str(data.get("title") or "").strip(),
        "participants": strings(data.get("participants")),
        "summary": str(data.get("summary") or "").strip(),
        "discussions": [
            {"topic": str(d.get("topic") or "").strip(), "points": strings(d.get("points"))}
            for d in data.get("discussions") or []
            if str(d.get("topic") or "").strip() or d.get("points")
        ],
        "decisions": strings(data.get("decisions")),
        "todos": [
            {
                "task": str(t.get("task") or "").strip(),
                "owner": str(t.get("owner") or "").strip(),
                "due": str(t.get("due") or "").strip(),
            }
            for t in data.get("todos") or []
            if str(t.get("task") or "").strip()
        ],
        "notes": str(data.get("notes") or "").strip(),
    }


def build_meeting_docx(activity_name: str, activity_date: str, minutes: dict) -> bytes:
    doc = Document()
    doc.add_heading(minutes["title"] or activity_name or "會議紀錄", level=1)
    meta = "　".join(s for s in [f"活動：{activity_name}" if activity_name else "", f"日期：{activity_date}" if activity_date else ""] if s)
    if meta:
        doc.add_paragraph(meta)
    if minutes["participants"]:
        doc.add_paragraph(f"與會者（錄音中提到）：{'、'.join(minutes['participants'])}")

    doc.add_heading("會議摘要", level=2)
    doc.add_paragraph(minutes["summary"] or "（無摘要）")

    if minutes["discussions"]:
        doc.add_heading("討論重點", level=2)
        for d in minutes["discussions"]:
            if d["topic"]:
                doc.add_heading(d["topic"], level=3)
            for point in d["points"]:
                doc.add_paragraph(point, style="List Bullet")

    doc.add_heading("決議事項", level=2)
    if minutes["decisions"]:
        for i, item in enumerate(minutes["decisions"], 1):
            doc.add_paragraph(f"{i}. {item}")
    else:
        doc.add_paragraph("（錄音中沒有明確決議）")

    doc.add_heading("待辦事項", level=2)
    if minutes["todos"]:
        table = doc.add_table(rows=1, cols=3)
        table.style = "Light Grid Accent 1"
        header = table.rows[0].cells
        header[0].text, header[1].text, header[2].text = "事項", "負責人", "期限"
        for t in minutes["todos"]:
            row = table.add_row().cells
            row[0].text, row[1].text, row[2].text = t["task"], t["owner"] or "（未指定）", t["due"] or "—"
    else:
        doc.add_paragraph("（錄音中沒有明確待辦）")

    if minutes["notes"]:
        doc.add_paragraph(f"錄音狀況：{minutes['notes']}")
    doc.add_paragraph("※ 本紀錄由 AI 依錄音整理，決議、負責人與期限請與會議主持人確認後再發出。")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
