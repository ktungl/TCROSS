"""AI 成果報告的圖表（PNG），同時放進 .docx 與 .pdf。

配色依 dataviz 規範的參考色盤（白底文件、只有淺色模式）：
- 類別：藍 #2a78d6、橘 #eb6834（已用 validate_palette.js 驗證，白底 CVD／一般視覺皆通過）
- 強調：本場活動用藍色，其他場次用灰色淡化；灰色不當類別色，旁邊一律直接標數字
- 文字一律用墨色，不用系列色；格線、座標軸用淡灰。"""

import io
import os
import re

import matplotlib

matplotlib.use("Agg")
from matplotlib import font_manager  # noqa: E402
from matplotlib import pyplot as plt  # noqa: E402

from document import FONT_REGULAR, IMAGE_DPI  # noqa: E402

BLUE = "#2a78d6"
ORANGE = "#eb6834"
CONTEXT_GRAY = "#b3b1aa"
INK = "#0b0b0b"
INK_SOFT = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
BASELINE = "#c3c2b7"

_WIDTH_IN = 6.3  # 約 16cm，Word 版插成 15cm、PDF 版撐滿版心
_font_ready = False


def _setup_font() -> None:
    global _font_ready
    if _font_ready:
        return
    if os.path.exists(FONT_REGULAR):
        font_manager.fontManager.addfont(FONT_REGULAR)
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=FONT_REGULAR).get_name()
    plt.rcParams.update({
        "font.size": 10,
        "text.color": INK,
        "axes.labelcolor": INK_SOFT,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "axes.edgecolor": BASELINE,
        "axes.unicode_minus": False,
    })
    _font_ready = True


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=IMAGE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _fmt(n: float) -> str:
    return f"{n:,.0f}" if float(n).is_integer() else f"{n:,.1f}"


def _hbar(labels: list[str], values: list[float], colors: list[str], unit: str) -> bytes:
    """水平長條圖：數值標在長條尾端，只留 x 軸淡格線。"""
    _setup_font()
    fig, ax = plt.subplots(figsize=(_WIDTH_IN, 0.42 * len(labels) + 0.5))
    y = range(len(labels))
    ax.barh(y, values, height=0.6, color=colors, edgecolor="white", linewidth=1.5)
    ax.set_yticks(list(y), labels)
    ax.invert_yaxis()  # 第一筆在最上面
    top = max(values) or 1
    ax.set_xlim(0, top * 1.15)
    for i, v in enumerate(values):
        ax.text(v + top * 0.01, i, f"{_fmt(v)} {unit}".strip(), va="center", color=INK, fontsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.tick_params(axis="y", length=0)
    return _png(fig)


def headcount_of(activity: dict) -> float | None:
    """合計人數；沒填合計就用男＋女，再沒有就用舊版 headcount 欄位。"""
    total = activity.get("totalCount")
    if isinstance(total, (int, float)) and total > 0:
        return float(total)
    male, female = activity.get("maleCount"), activity.get("femaleCount")
    if isinstance(male, (int, float)) or isinstance(female, (int, float)):
        s = float(male or 0) + float(female or 0)
        if s > 0:
            return s
    legacy = activity.get("headcount")
    if isinstance(legacy, (int, float)) and legacy > 0:
        return float(legacy)
    return None


def gender_chart(activity: dict) -> tuple[bytes, str] | None:
    """男女組成：一條 100% 堆疊長條（部分對整體），合計多於男＋女的部分列為「未填性別」。"""
    male = float(activity.get("maleCount") or 0)
    female = float(activity.get("femaleCount") or 0)
    if male + female <= 0:
        return None
    total = activity.get("totalCount")
    unknown = float(total) - male - female if isinstance(total, (int, float)) and total > male + female else 0.0
    whole = male + female + unknown
    parts = [("男", male, BLUE), ("女", female, ORANGE), ("未填性別", unknown, CONTEXT_GRAY)]
    parts = [p for p in parts if p[1] > 0]

    _setup_font()
    fig, ax = plt.subplots(figsize=(_WIDTH_IN, 0.9))
    left = 0.0
    for name, value, color in parts:
        ax.barh(0, value, left=left, height=0.35, color=color, edgecolor="white", linewidth=2,
                label=f"{name} {_fmt(value)} 人（{value / whole:.0%}）")
        left += value
    ax.set_xlim(0, whole)
    ax.set_ylim(-0.4, 0.4)
    ax.axis("off")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, 0.12), ncol=len(parts), frameon=False, fontsize=10)
    caption = f"參與人數性別組成（合計 {_fmt(whole)} 人，依活動基本資料）"
    return _png(fig), caption


_NUMBER = re.compile(r"^\s*([\d,]+(?:\.\d+)?)\s*$")


def kpi_charts(kpis: list[dict], max_groups: int = 3, max_bars: int = 12) -> list[tuple[bytes, str]]:
    """AI 讀出的 KPI 依單位分組，同單位且至少 2 項才畫（不同單位不畫在同一軸上）。"""
    groups: dict[str, list[tuple[str, float]]] = {}
    for kpi in kpis:
        m = _NUMBER.match(str(kpi.get("v", "")))
        name = str(kpi.get("k", "")).strip()
        if not m or not name:
            continue
        unit = str(kpi.get("u", "")).strip()
        groups.setdefault(unit, []).append((name, float(m.group(1).replace(",", ""))))
    charts = []
    for unit, items in groups.items():
        if len(items) < 2:
            continue
        items = sorted(items, key=lambda x: x[1], reverse=True)[:max_bars]
        png = _hbar([n for n, _ in items], [v for _, v in items], [BLUE] * len(items), unit)
        label = f"（單位：{unit}）" if unit else ""
        charts.append((png, f"成果指標{label}。數字由 AI 從素材辨識，請與原始資料核對。"))
        if len(charts) >= max_groups:
            break
    return charts


def _short(name: str, limit: int = 14) -> str:
    return name if len(name) <= limit else name[: limit - 1] + "…"


def plan_comparison_chart(plan_name: str, current_id: str, activities: list[dict], max_bars: int = 15) -> tuple[bytes, str] | None:
    """同計畫各場次參與人數，依日期排序；本場用藍色強調，其他場次灰色。"""
    rows = []
    for a in activities:
        count = headcount_of(a)
        if count is not None:
            rows.append((str(a.get("date") or ""), str(a.get("name") or ""), count, a.get("objectId") == current_id))
    if len(rows) < 2 or not any(r[3] for r in rows):
        return None
    rows.sort(key=lambda r: (r[0] or "9999", r[1]))
    if len(rows) > max_bars:
        # 場次太多時取本場前後相鄰的場次
        idx = next(i for i, r in enumerate(rows) if r[3])
        start = min(max(0, idx - max_bars // 2), len(rows) - max_bars)
        rows = rows[start : start + max_bars]
    labels = [f"{d[5:].replace('-', '/') + ' ' if len(d) == 10 else ''}{_short(n)}" for d, n, _, _ in rows]
    png = _hbar(labels, [r[2] for r in rows], [BLUE if r[3] else CONTEXT_GRAY for r in rows], "人")
    return png, f"同計畫「{plan_name}」各場次參與人數（藍色為本場活動，依活動基本資料）"
