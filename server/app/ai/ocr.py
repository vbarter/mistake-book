"""OCR 模型（PaddleOCR-VL，OpenAI Chat Completions 兼容接口）：先把试卷照片逐行识别成文字，再交给大模型做版面与作答分析。

配置（环境变量）：
- OCR_BASE_URL   服务地址，如 https://xxx.ngrok-free.dev（不带 /v1）
- OCR_AUTH       Basic 认证 "user:password"
- OCR_MODEL      模型名，默认 PaddlePaddle/PaddleOCR-VL-1.6
三者缺一则视为未启用，大模型直接看图。OCR 失败时也退回直接看图，不让任务失败。
只用标准库，不引入新的 HTTP 依赖。
"""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

DEFAULT_MODEL = "PaddlePaddle/PaddleOCR-VL-1.6"


class OCRError(Exception):
    pass


def _cfg() -> tuple[str, str, str]:
    base = (os.getenv("OCR_BASE_URL") or "").rstrip("/")
    auth = os.getenv("OCR_AUTH") or ""
    model = os.getenv("OCR_MODEL") or DEFAULT_MODEL
    return base, auth, model


def enabled() -> bool:
    base, auth, _ = _cfg()
    return bool(base and auth)


def _request(url: str, auth: str, body: dict | None, timeout: float) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Basic " + base64.b64encode(auth.encode()).decode(), "Content-Type": "application/json", "Accept": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


_health_cache: dict = {"at": 0.0, "value": "disabled"}
_health_lock = threading.Lock()


def health(max_age: float = 60.0) -> str:
    """online / offline / disabled，结果缓存 60 秒，给 /api/health 用。"""
    if not enabled():
        return "disabled"
    with _health_lock:
        if time.time() - _health_cache["at"] < max_age:
            return _health_cache["value"]
        base, auth, _ = _cfg()
        try:
            value = "online" if _request(f"{base}/health", auth, None, 8).get("status") == "healthy" else "offline"
        except Exception:  # noqa: BLE001
            value = "offline"
        _health_cache.update(at=time.time(), value=value)
        return value


def ocr_image(data: bytes, media_type: str = "image/jpeg", prompt: str = "OCR:", timeout: float = 120.0) -> str:
    """识别一张图片，返回逐行文字（公式为 LaTeX）。失败重试一次。"""
    base, auth, model = _cfg()
    if not (base and auth):
        raise OCRError("OCR 未配置")
    body = {
        "model": model,
        "max_tokens": 4096,
        "temperature": 0,
        "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:{media_type};base64," + base64.b64encode(data).decode()}}, {"type": "text", "text": prompt}]}],
    }
    last: Exception | None = None
    for attempt in range(2):
        try:
            r = _request(f"{base}/v1/chat/completions", auth, body, timeout)
            text = (r.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            return text.strip()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, OSError) as e:
            last = e
            log.warning("ocr attempt %s failed: %s", attempt + 1, e)
            time.sleep(1)
    raise OCRError(str(last))
