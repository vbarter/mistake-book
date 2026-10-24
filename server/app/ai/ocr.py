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


def _figure_lines(r: dict) -> dict[int, str]:
    """版面分析里落在插图 / 表格里的行 → 该行的前缀"""
    out: dict[int, str] = {}
    for lay in r.get("layouts") or []:
        if lay.get("layout") in FIGURE_LAYOUTS:
            for i in lay.get("layout_idx") or []:
                if isinstance(i, int):
                    out[i] = FIGURE_TAG
    return out


def baidu_regions(r: dict, size: tuple[int, int] | None) -> list[dict]:
    """插图 / 表格区域，坐标换成相对整张图的 0–1（百度给的是原图像素坐标，未按方向转正）"""
    if not size:
        return []
    w, h = size
    out = []
    for lay in r.get("layouts") or []:
        kind = lay.get("layout")
        pts = lay.get("layout_location") or []
        if kind not in FIGURE_LAYOUTS or len(pts) < 2:
            continue
        xs = [float(p.get("x", 0)) for p in pts]
        ys = [float(p.get("y", 0)) for p in pts]
        box = [max(0.0, min(xs) / w), max(0.0, min(ys) / h), min(1.0, max(xs) / w), min(1.0, max(ys) / h)]
        # 太小的（印章、页码框之类）不算插图
        if (box[2] - box[0]) * (box[3] - box[1]) < 0.004:
            continue
        out.append({"kind": kind, "bbox": [round(v, 4) for v in box]})
    return out


def baidu_page(r: dict, size: tuple[int, int] | None = None) -> OcrPage:
    text = baidu_lines(r)
    regions = baidu_regions(r, size)
    if regions:
        listing = "\n".join(f"- {FIGURE_LAYOUTS[g['kind']]}{i + 1}：{g['bbox']}" for i, g in enumerate(regions))
        text += "\n\n【版面分析检测到的插图 / 表格区域，坐标为相对整张照片的 [x0, y0, x1, y1]】\n" + listing
    try:
        direction = int(r.get("img_direction") or 0) % 4
    except (TypeError, ValueError):
        direction = 0
    return OcrPage(text=text, direction=direction, regions=regions)


def baidu_lines(r: dict) -> str:
    """把 doc_analysis 结果拼成逐行文字：按分栏排序，栏与栏之间空一行；手写行加 [手写] 前缀，落在插图 / 表格里的行加 [图中文字] 前缀；没有 results 时退回 words_result。"""
    results = r.get("results") or []
    in_figure = _figure_lines(r)
    chunks: list[str] = []
    for group in _baidu_order(r):
        lines: list[str] = []
        for i in group:
            item = results[i]
            words = item.get("words") or {}
            word = str(words.get("word") or "").strip()
            if word:
                lines.append(in_figure.get(i, "") + (HANDWRITING_TAG if item.get("words_type") == "handwriting" else "") + word)
        if lines:
            chunks.append("\n".join(lines))
    if not chunks:
        lines = [str(item.get("words") or "").strip() for item in r.get("words_result") or []]
        chunks = ["\n".join(w for w in lines if w)] if any(lines) else []
    return "\n\n".join(chunks)


def _baidu_ocr(data: bytes, timeout: float) -> OcrPage:
    return baidu_page(_baidu_doc_analysis(data, timeout), image_size(data))


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
