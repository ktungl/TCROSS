"""AI_UPGRADE_PLAN.md 第二批：表單智慧輔助。都是同步呼叫、直接回傳建議值，不寫任何資料——
寫入一律由前端在使用者確認後才做（AI 結果先給人確認，不直接覆寫）。

- sign_in：手寫簽到表照片 → 名單（人數由前端依名單計算，不讓模型自己算）
- poster：活動海報／邀請函 → 活動名稱、日期、時間、地點等欄位建議
- classify：活動名稱與說明 → 從「現有」分類與計畫清單中挑選，不能自創
"""

import base64
import binascii
import json

from google.genai import types

from report import GEMINI_MODEL, _get_client

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
# 前端會先縮圖（長邊 2400px、JPEG），正常一張只有幾百 KB；這裡是防濫用的上限
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_SIGN_IN_IMAGES = 6
_MAX_TEXT_CHARS = 1500


def decode_image(data: str, mime_type: str) -> bytes:
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("圖片格式只接受 JPEG／PNG／WebP")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("圖片資料格式不正確")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"單張圖片不能超過 {MAX_IMAGE_BYTES // 1024 // 1024} MB")
    return raw


def _generate(parts: list, schema: dict, media_resolution: str | None = None) -> dict:
    extra = {"media_resolution": f"MEDIA_RESOLUTION_{media_resolution}"} if media_resolution else {}
    config = types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema, **extra)
    response = _get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(role="user", parts=parts),
        config=config,
    )
    return json.loads(response.text)


# ── 簽到表辨識 ──

_SIGN_IN_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "rows": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "page": {"type": "INTEGER"},
                    "unit": {"type": "STRING"},
                    "title": {"type": "STRING"},
                    "name": {"type": "STRING"},
                    "gender": {"type": "STRING", "enum": ["男", "女", ""]},
                    "uncertain": {"type": "BOOLEAN"},
                },
                "required": ["page", "unit", "title", "name", "gender", "uncertain"],
            },
        },
        "notes": {"type": "STRING"},
    },
    "required": ["rows", "notes"],
}

_SIGN_IN_PROMPT = (
    "以上是一場活動的簽到表照片（依序為第 1、2…張）。請逐列辨識「有簽名或寫了姓名」的列，忽略空白列與表頭。\n"
    "- page：在第幾張照片\n"
    "- unit／title／name：單位、職稱、姓名，看不到的欄位留空字串；照抄字跡，不要自行修正或補字\n"
    "- gender：表上有性別欄或勾選才填「男」／「女」，否則留空字串，不要從姓名猜\n"
    "- uncertain：字跡潦草、反光、被遮住而不確定時設 true\n"
    "notes：整體辨識狀況的簡短說明（例如哪張照片模糊），沒有就留空字串。用繁體中文。"
)


def recognize_sign_in(images: list[tuple[bytes, str]]) -> dict:
    parts = [types.Part.from_bytes(data=raw, mime_type=mime) for raw, mime in images]
    parts.append(types.Part.from_text(text=_SIGN_IN_PROMPT))
    # 手寫小字：解析度固定用 HIGH，不跟 GEMINI_MEDIA_RESOLUTION（預設 LOW）
    data = _generate(parts, _SIGN_IN_SCHEMA, media_resolution="HIGH")
    rows = []
    for r in data.get("rows") or []:
        name = str(r.get("name") or "").strip()
        unit = str(r.get("unit") or "").strip()
        if not name and not unit:
            continue
        gender = r.get("gender") if r.get("gender") in ("男", "女") else ""
        rows.append({
            "page": int(r.get("page") or 1),
            "unit": unit,
            "title": str(r.get("title") or "").strip(),
            "name": name,
            "gender": gender,
            "uncertain": bool(r.get("uncertain")),
        })
    return {"rows": rows, "notes": str(data.get("notes") or "")}


# ── 海報帶入 ──

_POSTER_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "name": {"type": "STRING"},
        "date": {"type": "STRING"},
        "time": {"type": "STRING"},
        "timeEnd": {"type": "STRING"},
        "online": {"type": "BOOLEAN"},
        "place": {"type": "STRING"},
        "venue": {"type": "STRING"},
        "participantDesc": {"type": "STRING"},
        "attendees": {"type": "STRING"},
        "description": {"type": "STRING"},
    },
    "required": ["name", "date", "time", "timeEnd", "online", "place", "venue", "participantDesc", "attendees", "description"],
}


def read_poster(raw: bytes, mime: str, today: str) -> dict:
    prompt = (
        f"這是一張活動海報或邀請函。今天是 {today}。請擷取活動資訊，用繁體中文回覆，海報上沒有的欄位一律留空字串：\n"
        "- name：活動名稱\n"
        "- date：活動日期，格式 YYYY-MM-DD；海報用民國年就換算成西元；只寫月日時，取今天之後最近的那一天；多天活動填第一天\n"
        "- time／timeEnd：開始／結束時間，24 小時制 HH:MM\n"
        "- online：線上活動（Google Meet、Zoom、視訊）為 true\n"
        "- place：實體活動的地址（盡量完整）；venue：場地名稱（例如某某活動中心）\n"
        "- participantDesc：參加對象；attendees：主辦、協辦或合作單位\n"
        "- description：活動內容簡述 1-2 句\n"
        "只能用海報上寫的內容，不要杜撰。"
    )
    data = _generate([types.Part.from_bytes(data=raw, mime_type=mime), types.Part.from_text(text=prompt)], _POSTER_SCHEMA)
    return {key: (bool(data.get(key)) if key == "online" else str(data.get(key) or "").strip()) for key in _POSTER_SCHEMA["properties"]}


# ── 分類與計畫推薦 ──

_CLASSIFY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "categories": {"type": "ARRAY", "items": {"type": "STRING"}},
        "plans": {"type": "ARRAY", "items": {"type": "STRING"}},
        "reason": {"type": "STRING"},
    },
    "required": ["categories", "plans", "reason"],
}


def suggest_classification(text: str, categories: list[str], plans: dict[str, str]) -> dict:
    """plans 是 {id: 名稱}；模型只看得到名稱，回來後再對回 id，清單外的一律丟掉。"""
    prompt = (
        "你協助社福機構把活動歸類。請依活動說明，從下列清單中挑出最適合的項目；"
        "只能從清單中原樣挑選，不確定就少選，沒有適合的就回傳空陣列。\n"
        f"活動分類清單（可選 1-2 個）：{json.dumps(categories, ensure_ascii=False)}\n"
        f"計畫清單（可選 0-2 個）：{json.dumps(list(plans.values()), ensure_ascii=False)}\n"
        "reason：一句話說明理由，用繁體中文。\n\n"
        f"活動說明：\n{text[:_MAX_TEXT_CHARS]}"
    )
    data = _generate([types.Part.from_text(text=prompt)], _CLASSIFY_SCHEMA)
    category_set = set(categories)
    id_by_name = {name: pid for pid, name in plans.items()}
    picked_categories = [c for c in dict.fromkeys(data.get("categories") or []) if c in category_set]
    picked_plans = [id_by_name[n] for n in dict.fromkeys(data.get("plans") or []) if n in id_by_name]
    return {"categories": picked_categories, "planIds": picked_plans, "reason": str(data.get("reason") or "")}
