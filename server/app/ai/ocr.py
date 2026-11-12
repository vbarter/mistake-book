"""OCR：两套方案并存，环境变量 OCR_PROVIDER 开关切换；识别结果（逐行文字）交给大模型做版面与作答分析。

- paddle：私有化部署的 PaddleOCR-VL（OpenAI Chat Completions 兼容接口）
    OCR_BASE_URL   服务地址，如 https://xxx.ngrok-free.dev（不带 /v1）
    OCR_AUTH       Basic 认证 "user:password"
    OCR_MODEL      模型名，默认 PaddlePaddle/PaddleOCR-VL-1.6
- baidu ：百度智能云「试卷分析与识别」doc_analysis，能区分印刷 / 手写，公式输出 LaTeX
    BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY（控制台应用的 API Key / Secret Key）
- off   ：关闭，大模型直接看图
OCR_PROVIDER 取 paddle | baidu | off；留空 = 自动，哪套配置齐了用哪套（paddle 优先）。
OCR 失败时退回让大模型直接看图，不让任务失败。只用标准库，不引入新的 HTTP 依赖。
"""
from __future__ import annotations

import base64
import re
import io
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

PROVIDERS = ("paddle", "baidu", "off")
DEFAULT_MODEL = "PaddlePaddle/PaddleOCR-VL-1.6"
BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
BAIDU_DOC_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/doc_analysis"
HANDWRITING_TAG = "[手写] "  # 百度能区分手写行，加这个前缀告诉大模型


class OCRError(Exception):
    pass


# ---------- 配置与开关 ----------


def _paddle_cfg() -> tuple[str, str, str]:
    base = (os.getenv("OCR_BASE_URL") or "").rstrip("/")
    auth = os.getenv("OCR_AUTH") or ""
    model = os.getenv("OCR_MODEL") or DEFAULT_MODEL
    return base, auth, model


def _baidu_cfg() -> tuple[str, str]:
    return (os.getenv("BAIDU_OCR_API_KEY") or "").strip(), (os.getenv("BAIDU_OCR_SECRET_KEY") or "").strip()


def configured(name: str) -> bool:
    if name == "paddle":
        base, auth, _ = _paddle_cfg()
        return bool(base and auth)
    if name == "baidu":
        key, secret = _baidu_cfg()
        return bool(key and secret)
    return False


def provider() -> str:
    """当前选用的方案：OCR_PROVIDER 指定的；留空则自动挑一套配置齐全的；都没有就是 off。"""
    want = (os.getenv("OCR_PROVIDER") or "").strip().lower()
    if want in PROVIDERS:
        return want
    for name in ("paddle", "baidu"):
        if configured(name):
            return name
    return "off"


def enabled() -> bool:
    name = provider()
    return name != "off" and configured(name)


# ---------- HTTP ----------


def _json_request(url: str, headers: dict, body: bytes | None, timeout: float) -> dict:
    req = urllib.request.Request(url, data=body, headers={"Accept": "application/json", **headers}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- paddle ----------


def _paddle_request(url: str, auth: str, body: dict | None, timeout: float) -> dict:
    headers = {"Authorization": "Basic " + base64.b64encode(auth.encode()).decode(), "Content-Type": "application/json"}
    return _json_request(url, headers, json.dumps(body).encode() if body is not None else None, timeout)


def _paddle_health() -> str:
    base, auth, _ = _paddle_cfg()
    try:
        return "online" if _paddle_request(f"{base}/health", auth, None, 8).get("status") == "healthy" else "offline"
    except Exception:  # noqa: BLE001
        return "offline"


def _paddle_ocr(data: bytes, media_type: str, prompt: str, timeout: float) -> str:
    base, auth, model = _paddle_cfg()
    body = {
        "model": model,
        "max_tokens": 4096,
        "temperature": 0,
        "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:{media_type};base64," + base64.b64encode(data).decode()}}, {"type": "text", "text": prompt}]}],
    }
    r = _paddle_request(f"{base}/v1/chat/completions", auth, body, timeout)
    return ((r.get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()


# ---------- baidu ----------

_baidu_token_cache: dict = {"value": "", "expires": 0.0}
_baidu_lock = threading.Lock()


def _baidu_token(force: bool = False, timeout: float = 15.0) -> str:
    """access_token 有效期 30 天，进程内缓存；force 用于 token 失效（110/111）时刷新。"""
    key, secret = _baidu_cfg()
    if not (key and secret):
        raise OCRError("百度 OCR 未配置 API Key / Secret Key")
    with _baidu_lock:
        if not force and _baidu_token_cache["value"] and time.time() < _baidu_token_cache["expires"] - 60:
            return _baidu_token_cache["value"]
        body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": key, "client_secret": secret}).encode()
        r = _json_request(BAIDU_TOKEN_URL, {"Content-Type": "application/x-www-form-urlencoded"}, body, timeout)
        token = r.get("access_token")
        if not token:
            raise OCRError("百度 OCR 取 token 失败：" + str(r.get("error_description") or r.get("error") or r))
        _baidu_token_cache.update(value=token, expires=time.time() + float(r.get("expires_in") or 2592000))
        return token


def _baidu_health() -> str:
    try:
        _baidu_token()
        return "online"
    except Exception:  # noqa: BLE001
        return "offline"


BAIDU_PARAMS = {
    "words_type": "handprint_mix",  # 印刷 + 手写混排，返回每行是印刷还是手写
    "recg_formula": "true",  # 公式识别为 LaTeX
    "detect_direction": "true",
    "layout_analysis": "true",  # 返回分栏（sections），用来把两栏 / 对页的行按阅读顺序排
    "line_probability": "true",  # 每行置信度 words.line_probability = {min, average}（单字的拿不到）
}


def _baidu_doc_analysis(data: bytes, timeout: float) -> dict:
    """调一次 doc_analysis；token 失效刷新后重试，触发 QPS 限制等一秒重试，其余错误抛 OCRError。"""
    form = {"image": base64.b64encode(data).decode(), **BAIDU_PARAMS}
    body = urllib.parse.urlencode(form).encode()
    force = False
    for attempt in range(3):
        token = _baidu_token(force=force)
        r = _json_request(f"{BAIDU_DOC_URL}?access_token={token}", {"Content-Type": "application/x-www-form-urlencoded"}, body, timeout)
        code = r.get("error_code")
        if code is None:
            return r
        msg = f"百度 OCR 错误 {code}: {r.get('error_msg')}"
        if code in (110, 111) and attempt < 2:  # token 无效 / 过期
            force = True
            continue
        if code in (18, 282000) and attempt < 2:  # QPS 超限 / 服务内部错误
            time.sleep(1)
            continue
        raise OCRError(msg)
    raise OCRError("百度 OCR 重试仍失败")


FIGURE_TAG = "[图中文字]"
FIGURE_LAYOUTS = {"figure": "插图", "table": "表格"}
RED_TAG = "[红笔] "
DOUBT_TAG = "[存疑] "  # 印刷行里最没把握的字置信度低于 DOUBT_BELOW：多半有生僻字、形近字或声调认错了
DOUBT_BELOW = 0.65  # 手写行里红笔占多数：多半是老师的批改、分数，不是学生作答

# 竖排：行框高是宽的这么多倍以上（还要比横排行高很多）。百度 doc_analysis 只按横排识别，竖格抄写的古诗会被认成一两个怪字
VERTICAL_RATIO = 2.5
VERTICAL_NOTE = "【竖排文字】照片上这些位置有竖排书写（多为竖格抄写古诗、竖排诗文，从右往左按列读），OCR 识别不了已略去，请直接看照片逐列转写："
# 照片短边小于这个像素就先放大再送 OCR：App 上传最长边 1568，竖拍的一页卷子短边只有七百来像素，小字和手写认不出
UPSCALE_BELOW = 1200
UPSCALE_MAX = 2.0


def _box(item: dict) -> tuple[float, float, float, float] | None:
    loc = (item.get("words") or {}).get("words_location") or {}
    try:
        return float(loc["left"]), float(loc["top"]), float(loc["width"]), float(loc["height"])
    except (KeyError, TypeError, ValueError):
        return None


def _line_min_prob(words: dict) -> float:
    try:
        return float((words.get("line_probability") or {}).get("min", 1.0))
    except (TypeError, ValueError, AttributeError):
        return 1.0


def _direction(r: dict) -> int:
    """百度判断的照片方向：逆时针转了几个 90°（0 正、1 逆时针 90°、2 倒置、3 顺时针 90°）"""
    try:
        return int(r.get("img_direction") or 0) % 4
    except (TypeError, ValueError, AttributeError):
        return 0


def _upright(b: tuple[float, float, float, float], direction: int, size: tuple[int, int] | None) -> tuple[float, float, float, float]:
    """照片坐标里的行框 → 把卷子转正后的 (left, top, width, height)。百度给的坐标是照片原样的，横拍的照片里每一行都又高又窄。
    没有照片尺寸时只把宽高换过来（位置不准，只能用来比宽高）。"""
    x, y, w, h = b
    d = direction % 4
    if d == 0:
        return b
    if not size:
        return (y, x, h, w) if d % 2 else b
    pw, ph = size
    if d == 1:  # 卷子上边在照片左边、左边在照片下边
        return ph - (y + h), x, h, w
    if d == 2:
        return pw - (x + w), ph - (y + h), w, h
    return y, pw - (x + w), h, w  # d == 3：卷子上边在照片右边


def _vertical_lines(results: list, direction: int = 0) -> set[int]:
    """行框又高又窄、明显比横排行高得多的行：竖排文字。没有坐标就不判断。
    先按照片方向把宽高转正：横拍的照片里正常的横排行在照片上也是又高又窄的，不能当竖排丢掉。"""
    boxes = {i: (_upright(b, direction, None) if (b := _box(item)) else None) for i, item in enumerate(results)}
    flat = sorted(b[3] for b in boxes.values() if b and b[2] >= b[3])
    if not flat:
        return set()
    line_h = flat[len(flat) // 2]
    return {i for i, b in boxes.items() if b and b[3] >= VERTICAL_RATIO * max(b[2], 1.0) and b[3] >= 3 * line_h}


def _red_lines(results: list, rgb) -> set[int]:
    """手写行里墨迹以红色为主的行（老师的分数、勾叉、批注）。rgb 是 numpy HxWx3 数组，没有就不判断。"""
    if rgb is None:
        return set()
    import numpy as np

    h, w = rgb.shape[:2]
    out: set[int] = set()
    for i, item in enumerate(results):
        if item.get("words_type") != "handwriting":
            continue
        b = _box(item)
        if not b:
            continue
        x0, y0 = max(0, int(b[0])), max(0, int(b[1]))
        x1, y1 = min(w, int(b[0] + b[2])), min(h, int(b[1] + b[3]))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        px = rgb[y0:y1, x0:x1].astype(np.int16)
        gray = px.mean(axis=2)
        ink = gray < np.percentile(gray, 90) - 40  # 比框里的纸面暗得多的像素算笔迹
        red = ink & (px[..., 0] - np.maximum(px[..., 1], px[..., 2]) > 12)  # 黑笔、铅笔这项几乎是 0，照片里的红笔一般 15–35
        n_ink, n_red = int(ink.sum()), int(red.sum())
        if n_red >= 20 and n_red >= 0.4 * n_ink:  # 红笔勾穿过学生字迹时占比远低于这个
            out.add(i)
    return out


def _rgb(data: bytes | None):
    if not data:
        return None
    try:
        import numpy as np
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            return np.asarray(im.convert("RGB"))
    except Exception:  # noqa: BLE001
        return None


def upscale_for_ocr(data: bytes) -> bytes:
    """短边不到 UPSCALE_BELOW 像素的照片放大（最多 2 倍、长边不超过 4000）再送百度；放大失败原样返回。
    实测这样百度能多认出手写词（如「悲痛」「同心」）、少把印刷生僻字认错。坐标随之放大，换算 0–1 时用放大后的尺寸。"""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            f = min(UPSCALE_MAX, UPSCALE_BELOW / max(1, min(w, h)), 4000 / max(1, max(w, h)))
            if f <= 1.05:
                return data
            buf = io.BytesIO()
            im.convert("RGB").resize((round(w * f), round(h * f)), Image.LANCZOS).save(buf, "JPEG", quality=92)
            return buf.getvalue()
    except Exception:  # noqa: BLE001
        return data


@dataclass
class OcrPage:
    """一张图片的 OCR 结果：逐行文字、方向（逆时针转了几个 90°）、插图 / 表格区域（相对整张图的 0–1 坐标）"""

    text: str
    direction: int = 0
    regions: list = field(default_factory=list)  # [{"kind": "figure" | "table", "bbox": [x0, y0, x1, y1]}]


def image_size(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image  # reportlab 依赖 Pillow，服务器上一定有

        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return None


def _baidu_order(r: dict) -> list[list[int]]:
    """按分栏把 results 的下标分组：每个 section（按行、列排序）里的行按接口给出的顺序，不属于任何分栏的行放最后。"""
    results = r.get("results") or []
    sections = []
    for s in r.get("sections") or []:
        idx = (s.get("sec_idx") or {}).get("idx") or []
        if not idx:
            continue
        key = (0 if s.get("attribute") == "section" else 1, min(s["sec_idx"].get("row_idx") or [0]), min(s["sec_idx"].get("col_idx") or [0]))
        sections.append((key, idx))
    groups: list[list[int]] = []
    seen: set[int] = set()
    for _, idx in sorted(sections, key=lambda t: t[0]):
        group = [i for i in idx if isinstance(i, int) and 0 <= i < len(results) and i not in seen]
        if group:
            groups.append(group)
            seen.update(group)
    rest = [i for i in range(len(results)) if i not in seen]
    if rest:
        groups.append(rest)
    return groups


def _fake_figure(lay: dict, results: list, vertical: set[int]) -> bool:
    """版面分析标成插图、其实是文字的区域：含竖排行（竖格抄写区），或者是三行以上成句的印刷文字（方框里的古诗、短文）。
    这种区域的行不加 [图中文字]，也不当插图区域列出，不然大模型会把整首诗塞进 figure。表格不算。"""
    if lay.get("layout") != "figure":
        return False
    idx = [i for i in lay.get("layout_idx") or [] if isinstance(i, int) and 0 <= i < len(results)]
    if any(i in vertical for i in idx):
        return True
    sentences = [i for i in idx if results[i].get("words_type") != "handwriting" and len(str((results[i].get("words") or {}).get("word") or "").strip()) >= 5]
    return len(sentences) >= 3 and len(sentences) * 2 >= len(idx)


def _figure_lines(r: dict, vertical: set[int] | None = None) -> dict[int, str]:
    """版面分析里落在插图 / 表格里的行 → 该行的前缀"""
    results = r.get("results") or []
    vertical = _vertical_lines(results, _direction(r)) if vertical is None else vertical
    out: dict[int, str] = {}
    for lay in r.get("layouts") or []:
        if lay.get("layout") in FIGURE_LAYOUTS and not _fake_figure(lay, results, vertical):
            for i in lay.get("layout_idx") or []:
                if isinstance(i, int):
                    out[i] = FIGURE_TAG
    return out


def baidu_regions(r: dict, size: tuple[int, int] | None) -> list[dict]:
    """插图 / 表格区域，坐标换成相对整张图的 0–1（百度给的是原图像素坐标，未按方向转正）"""
    if not size:
        return []
    w, h = size
    results = r.get("results") or []
    direction = _direction(r)
    vertical = _vertical_lines(results, direction)
    strip_sides = _strip_sides(r, size, vertical)
    out = []
    for lay in r.get("layouts") or []:
        kind = lay.get("layout")
        pts = lay.get("layout_location") or []
        if kind not in FIGURE_LAYOUTS or len(pts) < 2 or _fake_figure(lay, results, vertical):
            continue
        xs = [float(p.get("x", 0)) for p in pts]
        ys = [float(p.get("y", 0)) for p in pts]
        if any(outside(_upright(_layout_box(lay), direction, size)) for outside in strip_sides):
            continue  # 邻页残片里的图
        box = [max(0.0, min(xs) / w), max(0.0, min(ys) / h), min(1.0, max(xs) / w), min(1.0, max(ys) / h)]
        # 太小的（印章、页码框之类）不算插图
        if (box[2] - box[0]) * (box[3] - box[1]) < 0.002:  # 图片选项可能很小，别滤掉
            continue
        out.append({"kind": kind, "bbox": [round(v, 4) for v in box]})
    return out


def baidu_page(r: dict, size: tuple[int, int] | None = None, image: bytes | None = None) -> OcrPage:
    """image 是送去识别的那张图（用来判断红笔行），size 是它的尺寸"""
    text = baidu_lines(r, _rgb(image), size)
    regions = baidu_regions(r, size)
    if regions:
        listing = "\n".join(f"- {FIGURE_LAYOUTS[g['kind']]}{i + 1}：{g['bbox']}" for i, g in enumerate(regions))
        text += "\n\n【版面分析检测到的插图 / 表格区域，坐标为相对整张照片的 [x0, y0, x1, y1]】\n" + listing
    return OcrPage(text=text, direction=_direction(r), regions=regions)


# ---------- 邻页残片 ----------

BODY_CHARS = 6  # 印刷行去掉空白后至少这么多字才算正文行，用来定正文的左右边界（短的多半是图上的标注、页码、题号）
BODY_MIN_LINES = 5  # 正文行不到这么多就不判断邻页残片（只拍了一小块、几乎全是手写）
STRIP_OUTSIDE = 0.015  # 行整个落在正文边界之外这么多（占卷面宽度）以上：题号比题干靠外一个字，但和题干是挨着的，不会被算进来
STRIP_EDGE = 0.03  # 而且贴着照片边缘这么近（占卷面宽度）：邻页是被照片边切掉的；学生写在页边的字、图上的标注一般不贴边
STRIP_MAX = 0.20  # 正文边界离照片边缘最多这么远；再远就是对页拍在一张里，不归这里管


def _word(item: dict) -> str:
    return str((item.get("words") or {}).get("word") or "").strip()


def _text_bounds(results: list, boxes: dict, skip: set[int], page_w: float) -> tuple[float, float] | None:
    """正文的左右边界：正文行（够长的印刷行）里最靠左的左边、最靠右的右边。正文行太少就不判断。"""
    body = [b for i, b in boxes.items() if b and i not in skip and results[i].get("words_type") != "handwriting" and len(re.sub(r"\s", "", _word(results[i]))) >= BODY_CHARS]
    if len(body) < BODY_MIN_LINES:
        return None
    return min(b[0] for b in body), max(b[0] + b[2] for b in body)


def _layout_box(lay: dict) -> tuple[float, float, float, float] | None:
    pts = lay.get("layout_location") or []
    if len(pts) < 2:
        return None
    xs = [float(p.get("x", 0)) for p in pts]
    ys = [float(p.get("y", 0)) for p in pts]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def _strip_sides(r: dict, size: tuple[int, int] | None, vertical: set[int] | None = None) -> list:
    """照片边上拍进来的邻页残片在哪：返回若干判断函数（收转正后的框，说它是不是残片）；没有残片返回空列表。
    残片 = 整个落在正文左 / 右边界之外、又贴着照片边缘的东西。这一侧要有印刷的字或版面分析认出的插图 / 表格才算邻页
    （只有手写的，是学生写到页边的，留着）；正文边界离照片边缘太远（对页照片）时不动。"""
    if not size:
        return []
    results = r.get("results") or []
    direction = _direction(r)
    vertical = _vertical_lines(results, direction) if vertical is None else vertical
    page_w = float(size[1] if direction % 2 else size[0])
    boxes = {i: (_upright(b, direction, size) if (b := _box(item)) else None) for i, item in enumerate(results)}
    bounds = _text_bounds(results, boxes, vertical, page_w)
    if not bounds:
        return []
    left, right = bounds
    figures = [_upright(b, direction, size) for lay in r.get("layouts") or [] if lay.get("layout") in FIGURE_LAYOUTS and (b := _layout_box(lay))]
    sides = (
        (left <= STRIP_MAX * page_w, lambda b: b[0] + b[2] < left - STRIP_OUTSIDE * page_w and b[0] <= STRIP_EDGE * page_w),
        (right >= (1 - STRIP_MAX) * page_w, lambda b: b[0] > right + STRIP_OUTSIDE * page_w and b[0] + b[2] >= (1 - STRIP_EDGE) * page_w),
    )
    out = []
    for narrow, outside in sides:
        if not narrow:
            continue
        printed = any(b and i not in vertical and outside(b) and results[i].get("words_type") != "handwriting" and re.search(r"\w", _word(results[i])) for i, b in boxes.items())
        if printed or any(outside(b) for b in figures):
            out.append(outside)
    return out


def _neighbour_strip(r: dict, size: tuple[int, int] | None, vertical: set[int]) -> set[int]:
    """邻页残片里的行（下标）"""
    sides = _strip_sides(r, size, vertical)
    if not sides:
        return set()
    direction = _direction(r)
    out: set[int] = set()
    for i, item in enumerate(r.get("results") or []):
        b = _box(item)
        if b and i not in vertical and any(outside(_upright(b, direction, size)) for outside in sides):
            out.add(i)
    return out


def baidu_lines(r: dict, rgb=None, size: tuple[int, int] | None = None) -> str:
    """把 doc_analysis 结果拼成逐行文字：按分栏排序，栏与栏之间空一行；手写行加 [手写] 前缀（红笔为主的加 [红笔]），
    印刷行置信度低的加 [存疑]，
    落在插图 / 表格里的行加 [图中文字] 前缀；竖排的行认不出，略去并在末尾列出位置；照片边上的邻页残片去掉；没有 results 时退回 words_result。"""
    results = r.get("results") or []
    direction = _direction(r)
    vertical = _vertical_lines(results, direction)
    in_figure = _figure_lines(r, vertical)
    red = _red_lines(results, rgb)
    strip = _neighbour_strip(r, size, vertical)  # 没有照片尺寸时算不了，不去
    chunks: list[str] = []
    for group in _baidu_order(r):
        lines: list[str] = []
        for i in group:
            if i in vertical or i in strip:
                continue
            item = results[i]
            words = item.get("words") or {}
            word = _word(item)
            if word:
                if item.get("words_type") == "handwriting":
                    tag = RED_TAG if i in red else HANDWRITING_TAG
                else:
                    tag = DOUBT_TAG if _line_min_prob(words) < DOUBT_BELOW else ""
                lines.append(in_figure.get(i, "") + tag + word)
        if lines:
            chunks.append("\n".join(lines))
    if not chunks:
        lines = [str(item.get("words") or "").strip() for item in r.get("words_result") or []]
        chunks = ["\n".join(w for w in lines if w)] if any(lines) else []
    if vertical:
        vboxes = [_box(results[i]) for i in sorted(vertical)]
        x0, y0 = min(b[0] for b in vboxes), min(b[1] for b in vboxes)
        x1, y1 = max(b[0] + b[2] for b in vboxes), max(b[1] + b[3] for b in vboxes)
        where = f"约 [{x0 / size[0]:.2f}, {y0 / size[1]:.2f}, {x1 / size[0]:.2f}, {y1 / size[1]:.2f}]（相对整张照片）" if size else "照片中竖排的格子里"
        chunks.append(f"{VERTICAL_NOTE}{where}，OCR 在这里检测到 {len(vertical)} 处")
    return "\n\n".join(chunks)


def _baidu_ocr(data: bytes, timeout: float) -> OcrPage:
    data = upscale_for_ocr(data)
    return baidu_page(_baidu_doc_analysis(data, timeout), image_size(data), data)


# ---------- 对外 ----------

_health_cache: dict = {"at": 0.0, "key": "", "value": "disabled"}
_health_lock = threading.Lock()


def health(max_age: float = 60.0) -> str:
    """disabled | <方案>:unconfigured | <方案>:online | <方案>:offline，结果缓存 60 秒，给 /api/health 用。"""
    name = provider()
    if name == "off":
        return "disabled"
    if not configured(name):
        return f"{name}:unconfigured"
    with _health_lock:
        if _health_cache["key"] == name and time.time() - _health_cache["at"] < max_age:
            return _health_cache["value"]
        value = f"{name}:" + (_paddle_health() if name == "paddle" else _baidu_health())
        _health_cache.update(at=time.time(), key=name, value=value)
        return value


def ocr_image(data: bytes, media_type: str = "image/jpeg", prompt: str = "OCR:", timeout: float = 120.0) -> str:
    """只要文字的调用方用：见 ocr_page"""
    return ocr_page(data, media_type, prompt, timeout).text


def ocr_page(data: bytes, media_type: str = "image/jpeg", prompt: str = "OCR:", timeout: float = 120.0) -> OcrPage:
    """识别一张图片：逐行文字（公式为 LaTeX；百度方案下按分栏排序、手写行带 [手写] 前缀、图中的字带 [图中文字] 前缀，
    末尾附插图 / 表格区域），以及方向和插图区域。网络类错误重试一次。"""
    name = provider()
    if not enabled():
        raise OCRError("OCR 未配置")
    last: Exception | None = None
    for attempt in range(2):
        try:
            if name == "paddle":
                return OcrPage(text=_paddle_ocr(data, media_type, prompt, timeout))
            return _baidu_ocr(data, timeout)
        except OCRError:
            raise
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, OSError) as e:
            last = e
            log.warning("ocr(%s) attempt %s failed: %s", name, attempt + 1, e)
            time.sleep(1)
    raise OCRError(str(last))


# ---------- 手写擦除用：逐行框 ----------


def baidu_line_boxes(r: dict, size: tuple[int, int] | None) -> dict:
    """doc_analysis 结果里每一行的框，按印刷 / 手写分开，坐标换成相对整张图的 0–1：{"print": [[x0,y0,x1,y1]...], "hand": [...]}"""
    out: dict = {"print": [], "hand": []}
    if not size:
        return out
    w, h = size
    for item in r.get("results") or []:
        loc = (item.get("words") or {}).get("words_location") or {}
        try:
            x, y, ww, hh = float(loc["left"]), float(loc["top"]), float(loc["width"]), float(loc["height"])
        except (KeyError, TypeError, ValueError):
            continue
        box = [round(max(0.0, x / w), 4), round(max(0.0, y / h), 4), round(min(1.0, (x + ww) / w), 4), round(min(1.0, (y + hh) / h), 4)]
        out["hand" if item.get("words_type") == "handwriting" else "print"].append(box)
    return out


def line_boxes(data: bytes, timeout: float = 60.0) -> dict | None:
    """擦除手写时用：百度配置齐了就调一次 doc_analysis 拿逐行框（不管 OCR_PROVIDER 选的哪套，只有百度给手写 / 印刷之分）；
    没配置返回 None，调用失败抛 OCRError。"""
    if not configured("baidu"):
        return None
    data = upscale_for_ocr(data)
    return baidu_line_boxes(_baidu_doc_analysis(data, timeout), image_size(data))
