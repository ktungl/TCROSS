"""TC-35～TC-37：document.render_docx、report.build_report、charts.headcount_of。"""

import io
import struct
import zlib

import pytest
from docx import Document

import charts
import report
from charts import headcount_of
from document import Bullet, Heading, Image, Paragraph, Table, render_docx


def _tiny_png(width: int = 400, height: int = 10) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


# ── TC-35 ──────────────────────────────────────────────
def test_tc35_render_docx_paragraph_order_and_text():
    blocks = [
        Heading("親子共讀成果報告", 1),
        Heading("摘要"),
        Paragraph("本次活動共 30 人參加。"),
        Bullet("重點一"),
        Bullet("重點二"),
        Table(["項目", "數值", "單位"], [["參加人數", "30", "人"], ["場次", "2", "場"]], (3, 1, 1)),
        Image(_tiny_png(), "圖一 參與人數"),
        Paragraph("※ 本報告由 AI 整理", small=True),
    ]
    doc = Document(io.BytesIO(render_docx(blocks)))

    texts = [p.text for p in doc.paragraphs if p.text]
    assert texts == [
        "親子共讀成果報告", "摘要", "本次活動共 30 人參加。", "重點一", "重點二",
        "圖一 參與人數", "※ 本報告由 AI 整理",
    ]
    styles = {p.text: p.style.name for p in doc.paragraphs if p.text}
    assert styles["親子共讀成果報告"] == "Heading 1"
    assert styles["摘要"] == "Heading 2"
    assert styles["重點一"] == "List Bullet"

    assert len(doc.tables) == 1
    assert [[c.text for c in r.cells] for r in doc.tables[0].rows] == [
        ["項目", "數值", "單位"], ["參加人數", "30", "人"], ["場次", "2", "場"],
    ]
    assert len(doc.inline_shapes) == 1

    # 表格在 body 中的位置：位於「重點二」之後、圖片之前
    from docx.table import Table as DocxTable

    order = [
        "<table>" if isinstance(item, DocxTable) else item.text
        for item in doc.iter_inner_content()
    ]
    order = [t for t in order if t]
    assert order.index("<table>") == order.index("重點二") + 1
    assert order.index("<table>") < order.index("圖一 參與人數")


# ── TC-36 ──────────────────────────────────────────────
_ANALYSIS = {
    "summary": "活動順利完成，親子互動良好。",
    "highlights": ["共讀繪本三本", "家長回饋正面"],
    "kpis": [
        {"k": "參加人數", "v": "30", "u": "人"},
        {"k": "志工人數", "v": "5", "u": "人"},
        {"k": "場次", "v": "2", "u": "場"},
    ],
}


def _headings(blocks):
    return [b.text for b in blocks if isinstance(b, Heading)]


def test_tc36_build_report_contains_required_sections(monkeypatch):
    # 「mock Gemini」：Gemini 只在 analyze_sources 被呼叫，這裡 mock generate_json 走一遍 analyze_sources
    monkeypatch.setattr(report, "generate_json", lambda parts, schema, **cfg: dict(_ANALYSIS))
    monkeypatch.setattr(report, "_source_part", lambda path: report.types.Part.from_text(text=path))
    analysis = report.analyze_sources(["activities/act1/photo/a.jpg"])
    assert analysis == _ANALYSIS

    activity = {"objectId": "act1", "name": "親子共讀", "maleCount": 12, "femaleCount": 18, "totalCount": 32}
    others = [{"objectId": "act1", "name": "親子共讀", "totalCount": 32}, {"objectId": "act0", "name": "上一場", "totalCount": 20}]
    blocks = report.build_report(activity, analysis, [("家庭支持計畫", others)])

    assert isinstance(blocks[0], Heading) and blocks[0].level == 1 and blocks[0].text == "親子共讀"
    assert _headings(blocks)[1:] == ["摘要", "重點", "成果指標", "參與情形"]
    assert any(isinstance(b, Paragraph) and b.text == _ANALYSIS["summary"] for b in blocks)
    assert [b.text for b in blocks if isinstance(b, Bullet)] == _ANALYSIS["highlights"]
    table = next(b for b in blocks if isinstance(b, Table))
    assert table.rows == [["參加人數", "30", "人"], ["志工人數", "5", "人"], ["場次", "2", "場"]]
    images = [b for b in blocks if isinstance(b, Image)]
    assert images and all(img.png.startswith(b"\x89PNG") for img in images)

    # 產出的 blocks 要能實際渲染成 docx
    doc = Document(io.BytesIO(render_docx(blocks)))
    assert [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")] == ["親子共讀", "摘要", "重點", "成果指標", "參與情形"]


def test_tc36_build_report_minimal_analysis_still_has_title_and_summary():
    blocks = report.build_report({}, {"summary": "", "highlights": [], "kpis": []}, [])
    assert _headings(blocks) == ["活動成果報告", "摘要"]
    assert any(isinstance(b, Paragraph) and b.text == "（無摘要）" for b in blocks)


def test_tc36_build_report_survives_chart_failure(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("font missing")

    monkeypatch.setattr(charts, "kpi_charts", boom)
    monkeypatch.setattr(charts, "gender_chart", boom)
    blocks = report.build_report({"name": "x"}, _ANALYSIS, [])
    assert _headings(blocks) == ["x", "摘要", "重點", "成果指標"]


# ── TC-37 ──────────────────────────────────────────────
@pytest.mark.parametrize("activity, expected", [
    ({"totalCount": 30, "maleCount": 10, "femaleCount": 20}, 30.0),
    ({"maleCount": 10, "femaleCount": 20}, 30.0),          # 缺總數 → 男＋女
    ({"maleCount": 10}, 10.0),                              # 缺女
    ({"femaleCount": 7}, 7.0),                              # 缺男
    ({"maleCount": None, "femaleCount": 7}, 7.0),           # 男為 null
    ({"totalCount": None, "maleCount": 3, "femaleCount": None}, 3.0),
    ({"totalCount": 0, "maleCount": 4, "femaleCount": 5}, 9.0),  # 總數填 0 視同未填
    ({"totalCount": 25}, 25.0),                             # 只有總數
    ({"headcount": 15}, 15.0),                              # 舊版欄位
    ({"maleCount": 0, "femaleCount": 0, "headcount": 8}, 8.0),
    ({}, None),                                             # 全缺
    ({"totalCount": None, "maleCount": None, "femaleCount": None}, None),
    ({"maleCount": 0, "femaleCount": 0}, None),
])
def test_tc37_headcount_of_missing_values(activity, expected):
    assert headcount_of(activity) == expected


def test_tc37_gender_chart_with_missing_values_does_not_crash():
    assert charts.gender_chart({}) is None
    assert charts.gender_chart({"maleCount": None, "femaleCount": None}) is None
    png, caption = charts.gender_chart({"maleCount": 5, "femaleCount": None, "totalCount": None})
    assert png.startswith(b"\x89PNG") and "5" in caption
