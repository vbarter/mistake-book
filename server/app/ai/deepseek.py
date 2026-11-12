"""DeepSeek 官方接口（OpenAI Chat Completions 兼容）：大模型调用的第二条通道。

只负责「发一次请求、拿回文本」；提示词、JSON 解析、失败回退都在 ClaudeProvider 里。
配置全部来自环境变量，密钥不进仓库：
- DEEPSEEK_API_KEY：不配就没有这条通道
- DEEPSEEK_BASE_URL：默认 https://api.deepseek.com
- DEEPSEEK_MODEL：默认 deepseek-v4-pro
- DEEPSEEK_VISION：1 = 带图片的调用也发给 DeepSeek（模型支持图片输入时才开）；默认 0
- DEEPSEEK_MAX_TOKENS：输出上限的下限，默认 32000（思考过程也算在输出里，给小了容易被截断）
"""
from __future__ import annotations

import json
import logging
import os

import httpx

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-v4-pro"


class DeepSeekError(Exception):
    """status_code 为 0 表示没连上 / 超时 / 流中途断开。"""

    def __init__(self, status_code: int, message: str):
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message

    @property
    def transient(self) -> bool:
        return self.status_code == 0 or self.status_code == 408 or self.status_code >= 500


def to_openai_content(content: list[dict]) -> str | list[dict]:
    """Anthropic 的 content 块换成 OpenAI 的：没有图片时拼成一段文字，有图片时用 image_url（data URL）。"""
    if not any(b.get("type") == "image" for b in content):
        return "\n\n".join(b.get("text", "") for b in content if b.get("type") == "text")
    parts: list[dict] = []
    for b in content:
        if b.get("type") == "text":
            parts.append({"type": "text", "text": b.get("text", "")})
        elif b.get("type") == "image":
            src = b.get("source") or {}
            parts.append({"type": "image_url", "image_url": {"url": f"data:{src.get('media_type', 'image/jpeg')};base64,{src.get('data', '')}"}})
    return parts


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, model: str = DEFAULT_MODEL, vision: bool = False, min_max_tokens: int = 32000):
        self.model = model
        self.vision = vision
        self.min_max_tokens = min_max_tokens
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.http = httpx.Client(
            headers={"Authorization": f"Bearer {api_key}"},
            # 流式：只限制连接和两段数据之间的间隔，不限制整次请求多久
            timeout=httpx.Timeout(connect=15, read=180, write=60, pool=30),
        )

    @classmethod
    def from_env(cls) -> "DeepSeekClient | None":
        key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
        if not key:
            return None
        try:
            floor = int(os.getenv("DEEPSEEK_MAX_TOKENS") or 32000)
        except ValueError:
            floor = 32000
        return cls(
            api_key=key,
            base_url=(os.getenv("DEEPSEEK_BASE_URL") or DEFAULT_BASE_URL).strip(),
            model=(os.getenv("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip(),
            vision=os.getenv("DEEPSEEK_VISION") == "1",
            min_max_tokens=floor,
        )

    def complete(self, system: str, content: list[dict], max_tokens: int, on_text=None) -> tuple[str, str]:
        """返回 (正文, finish_reason)。on_text(chars) 按正文累计字数回调。出错抛 DeepSeekError。"""
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": to_openai_content(content)}],
            "max_tokens": max(max_tokens, self.min_max_tokens),
            "response_format": {"type": "json_object"},
            "stream": True,
        }
        text: list[str] = []
        finish = ""
        n = 0
        try:
            with self.http.stream("POST", self.url, json=body) as resp:
                if resp.status_code != 200:
                    raise DeepSeekError(resp.status_code, _error_message(resp.read()))
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue  # 空行和 ": keep-alive" 注释
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        raise DeepSeekError(0, _error_message(data.encode()))
                    for choice in chunk.get("choices") or []:
                        # 思考过程在 delta.reasoning_content 里，不要
                        piece = (choice.get("delta") or {}).get("content")
                        if piece:
                            text.append(piece)
                            n += len(piece)
                            if on_text is not None:
                                on_text(n)
                        finish = choice.get("finish_reason") or finish
        except httpx.HTTPError as e:
            raise DeepSeekError(0, f"{type(e).__name__}: {e}") from e
        if not finish:
            raise DeepSeekError(0, "stream ended without finish_reason")
        return "".join(text), finish


def _error_message(raw: bytes) -> str:
    try:
        err = json.loads(raw).get("error") or {}
        return str(err.get("message") or err)[:300]
    except (ValueError, AttributeError):
        return raw.decode("utf-8", "replace")[:300]
