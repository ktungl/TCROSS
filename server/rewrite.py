"""AI_UPGRADE_PLAN.md 1-1：把一場活動已建檔的資料改寫成不同通路的文案（新聞稿／社群文案／
主管一頁摘要）。只送文字欄位、不送照片影片，費用很低，所以在請求內同步做完、直接回傳，
不經過 GenerationJob。

各格式的寫法集中在 FORMATS；團隊提供正式範本後，改這裡的 instruction 即可。"""

from google.genai import types

from report import generate_json

FORMATS: dict[str, str] = {
    "新聞稿": (
        "撰寫一篇對外發布的新聞稿。title 是新聞標題（25 字以內，點出活動與亮點）；"
        "paragraphs 第一段是導言，交代何時、何地、誰、做了什麼、為什麼；後面 2-3 段補充活動內容與成果；"
        "語氣正式客觀，用第三人稱稱呼主辦單位。bullets、hashtags 回傳空陣列。"
    ),
    "社群文案": (
        "撰寫一則 Facebook／Instagram 貼文。title 是一句吸睛的開頭；paragraphs 為 2-3 段短文，"
        "合計 150-250 字，口語親切、可用少量 emoji（全文不超過 4 個）；結尾一段感謝參與者或邀請下次參加。"
        "hashtags 給 3-6 個（不含 # 符號）。bullets 回傳空陣列。"
    ),
    "主管摘要": (
        "撰寫給主管看的一頁摘要，讓主管 1 分鐘內掌握重點。title 是「活動名稱＋成果摘要」；"
        "paragraphs 只放一段 2-3 句的總結；bullets 依序列出：活動基本資訊（日期、地點、對象、人數）、"
        "量化成果、2-3 個亮點；素材有提到問題或後續建議時才加上，沒有就不要寫。hashtags 回傳空陣列。"
    ),
}

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "paragraphs": {"type": "ARRAY", "items": {"type": "STRING"}},
        "bullets": {"type": "ARRAY", "items": {"type": "STRING"}},
        "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["title", "paragraphs", "bullets", "hashtags"],
}

_RULES = (
    "你是社福機構（合作社照顧聯盟）的文案助手，用繁體中文（台灣用語）撰寫。"
    "只能使用下方「活動資料」裡的事實；資料沒有的人名、引言、數字、單位名稱一律不要杜撰，"
    "缺少的資訊就略過不寫，不要用「○○」之類的佔位符。"
)

# 單一欄位送進模型的長度上限：避免異常長的備註墊高 token 費用
_MAX_FIELD_CHARS = 2000


def _clip(value) -> str:
    return str(value or "").strip()[:_MAX_FIELD_CHARS]


def activity_context(activity: dict, plan_names: list[str]) -> str:
    """把 Parse REST 回傳的 Activity 整理成給模型讀的條列文字（空白欄位不列）。"""
    male = activity.get("maleCount") or 0
    female = activity.get("femaleCount") or 0
    total = activity.get("totalCount")
    if not isinstance(total, (int, float)):
        total = male + female
    time_range = "～".join(t for t in [_clip(activity.get("time")), _clip(activity.get("timeEnd"))] if t)
    kpis = "；".join(
        f"{_clip(k.get('k'))} {_clip(k.get('v'))}{_clip(k.get('u'))}"
        for k in (activity.get("kpis") or [])
        if isinstance(k, dict) and k.get("k")
    )
    captions = "；".join(
        _clip(f.get("caption"))
        for f in (activity.get("photoFiles") or [])
        if isinstance(f, dict) and f.get("caption") and not f.get("deletedAt")
    )
    fields = [
        ("活動名稱", _clip(activity.get("name"))),
        ("日期", _clip(activity.get("date"))),
        ("時間", time_range),
        ("地點", _clip(activity.get("place"))),
        ("所屬計畫", "、".join(plan_names)),
        ("活動分類", "、".join(_clip(c) for c in (activity.get("categories") or []))),
        ("與會單位或成員", _clip(activity.get("attendees"))),
        ("參加對象", _clip(activity.get("participantDesc"))),
        ("參與人數", f"共 {total} 人（男 {male}、女 {female}）" if total else ""),
        ("成果摘要", _clip(activity.get("summary"))),
        ("成果指標", kpis),
        ("照片圖說", captions[:_MAX_FIELD_CHARS]),
        ("備註", _clip(activity.get("remark"))),
    ]
    return "\n".join(f"- {label}：{value}" for label, value in fields if value)


def rewrite_activity(fmt: str, activity: dict, plan_names: list[str]) -> dict:
    instruction = FORMATS[fmt]
    prompt = f"{_RULES}\n\n任務：{instruction}\n\n活動資料：\n{activity_context(activity, plan_names)}"
    data = generate_json([types.Part.from_text(text=prompt)], _RESPONSE_SCHEMA)
    return {
        "format": fmt,
        "title": str(data.get("title") or ""),
        "paragraphs": [str(p) for p in (data.get("paragraphs") or []) if str(p).strip()],
        "bullets": [str(b) for b in (data.get("bullets") or []) if str(b).strip()],
        "hashtags": [str(h).lstrip("#") for h in (data.get("hashtags") or []) if str(h).strip()],
    }
