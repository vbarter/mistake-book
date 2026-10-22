"""Claude Provider：用视觉模型一次完成 OCR、学科归类、知识点标注、答案与解析。

两种工作方式：
- 官方 API（默认）：结构化输出（JSON Schema）+ 服务端回退。
- 中转模式（设置 ANTHROPIC_BASE_URL 指向 api.tu-zi.com 等 new-api 中转时自动启用）：
  只用标准 Messages 接口，不带 beta 头 / output_config / fallbacks，由提示词约束 JSON 并稳健解析。
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re

import anthropic

from ..constants import QUESTION_TYPES, SUBJECT_LABELS, SUBJECTS
from .base import AIError, AIProvider, Crop, RecognizedItem, ScannedItem, Variant

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "你是一位小学教师助手，帮助学生整理错题。你会收到试卷上框选出的错题截图。"
    "请逐张截图提取题目原文（保留分数、公式与选项的原始写法），识别学生写的作答，"
    "判断学科，标注 1 到 3 个知识点（用课本常见说法，按年级分层），给出正确答案、"
    "面向小学生的简短解析（不超过 120 字），以及一句「下次注意」提示。"
    "题干中你看不清或不确定的词，原样写入 uncertainSpans。"
    "截图中若有学生姓名、学校、班级等信息，一律忽略，不要写入任何字段。"
)

_SUBJECT_ENUM = SUBJECTS

RECOGNIZE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "enum": _SUBJECT_ENUM},
                    "knowledgePoints": {"type": "array", "items": {"type": "string"}},
                    "stemText": {"type": "string"},
                    "questionType": {"type": "string", "enum": QUESTION_TYPES},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "uncertainSpans": {"type": "array", "items": {"type": "string"}},
                    "studentAnswer": {"type": "string"},
                    "correctAnswer": {"type": "string"},
                    "analysis": {"type": "string"},
                    "tip": {"type": "string"},
                },
                "required": [
                    "subject",
                    "knowledgePoints",
                    "stemText",
                    "questionType",
                    "options",
                    "uncertainSpans",
                    "studentAnswer",
                    "correctAnswer",
                    "analysis",
                    "tip",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

SCAN_SYSTEM_PROMPT = (
    "你是一位小学教师助手。你会收到整页试卷的照片（可能有多页）。请找出页面上所有被判为错误的题目："
    "依据包括红叉、半对半错的勾叉、扣分标记、老师的红笔订正、学生作答与正确答案不符等。"
    "答对的题（打勾且作答正确）不要输出。对每道错题：提取题目原文（保留分数、公式与选项原样），"
    "识别学生写的作答，判断学科，标注 1 到 3 个知识点（课本常见说法），给出正确答案、"
    "面向小学生的简短解析（不超过 120 字）和一句「下次注意」提示，并说明判错依据。"
    "bbox 为该题在所在页面上的位置，格式 [x0, y0, x1, y1]，均为 0 到 1 的比例（相对页面宽高），"
    "要完整包住题干、选项和学生作答。看不清的词写入 uncertainSpans。"
    "页面上的学生姓名、学校、班级一律忽略。"
)

_SCAN_ITEM_PROPS = dict(RECOGNIZE_SCHEMA["properties"]["items"]["items"]["properties"])
_SCAN_ITEM_PROPS.update(
    {
        "page": {"type": "integer"},
        "bbox": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        "reason": {"type": "string"},
    }
)
SCAN_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _SCAN_ITEM_PROPS,
                "required": RECOGNIZE_SCHEMA["properties"]["items"]["items"]["required"] + ["page", "bbox", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

VARIANT_SCHEMA = {
    "type": "object",
    "properties": {
        "variants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "questionType": {"type": "string", "enum": QUESTION_TYPES},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer": {"type": "string"},
                    "analysis": {"type": "string"},
                },
                "required": ["question", "questionType", "options", "answer", "analysis"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["variants"],
    "additionalProperties": False,
}


def extract_json(text: str) -> dict:
    """从模型输出里取出 JSON 对象：兼容 ```json 围栏、前后多余说明文字。"""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise json.JSONDecodeError("no JSON object found", text, 0)


def is_relay_base_url(url: str | None) -> bool:
    return bool(url) and "anthropic.com" not in url


class ClaudeProvider(AIProvider):
    def __init__(self, model: str = "claude-opus-5-5", relay: bool | None = None):
        # 凭据与地址从环境解析：ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL（中转）或 `ant auth login` 的配置
        self.client = anthropic.Anthropic()
        self.model = model
        env_relay = os.getenv("ANTHROPIC_RELAY_MODE")
        if relay is not None:
            self.relay = relay
        elif env_relay in ("0", "1"):
            self.relay = env_relay == "1"
        else:
            self.relay = is_relay_base_url(os.getenv("ANTHROPIC_BASE_URL"))
        self.name = "claude-relay" if self.relay else "claude"

    # ------------------------------------------------------------------ helpers
    def _create(self, system: str, content: list[dict], schema: dict, max_tokens: int):
        """统一用流式请求再取完整消息：SDK 对大 max_tokens 的非流式调用会直接拒绝，流式也不受 HTTP 超时影响。"""
        if self.relay:
            instruction = (
                "\n\n只输出一个 JSON 对象，不要任何解释、前后缀或 Markdown 围栏。"
                "JSON 必须符合下面的 JSON Schema：\n" + json.dumps(schema, ensure_ascii=False)
            )
            content = list(content) + [{"type": "text", "text": instruction}]
            with self.client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
            ) as stream:
                return stream.get_final_message()
        with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
            # 安全分类器拒答时由服务端自动改用备用模型
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            return stream.get_final_message()

    def _call(self, system: str, content: list[dict], schema: dict, max_tokens: int = 16000) -> dict:
        try:
            response = self._create(system, content, schema, max_tokens)
        except anthropic.AuthenticationError as e:
            raise AIError("AI 服务的密钥无效，请检查 ANTHROPIC_API_KEY") from e
        except anthropic.PermissionDeniedError as e:
            log.warning("anthropic 403: %s", e.message)
            raise AIError("AI 服务额度不足或无权限，请联系管理员充值") from e
        except anthropic.RateLimitError as e:
            raise AIError("AI 服务正忙，请稍后再试") from e
        except anthropic.APIStatusError as e:
            log.warning("anthropic status error %s: %s", e.status_code, e.message)
            raise AIError("AI 服务暂时不可用，题目已保留，稍后可重试") from e
        except anthropic.APIConnectionError as e:
            raise AIError("连不上 AI 服务，请检查网络") from e

        if response.stop_reason == "refusal":
            detail = getattr(response, "stop_details", None)
            log.warning("claude refusal: %s", getattr(detail, "category", None))
            raise AIError("这张截图 AI 无法处理，请手动填写题目")
        if response.stop_reason == "max_tokens":
            raise AIError("AI 返回内容过长被截断，请减少一次识别的题目数量")

        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        try:
            return extract_json(text)
        except json.JSONDecodeError as e:
            log.warning("unparseable model output: %.300s", text)
            raise AIError("AI 返回了无法解析的结果，请重试") from e

    # ------------------------------------------------------------------ api
    def recognize(self, crops: list[Crop], subjects: list[str], grade: str) -> list[RecognizedItem]:
        content: list[dict] = []
        for i, crop in enumerate(crops):
            content.append({"type": "text", "text": f"第 {i + 1} 张截图："})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": crop.media_type,
                        "data": base64.standard_b64encode(crop.data).decode("utf-8"),
                    },
                }
            )
            if crop.hint:
                content.append({"type": "text", "text": f"用户补充的题干文字：{crop.hint}"})
        subject_names = "、".join(SUBJECT_LABELS[s] for s in subjects if s in SUBJECT_LABELS)
        content.append(
            {
                "type": "text",
                "text": (
                    f"学生年级：小学{grade}年级。可选学科：{subject_names}（subject 字段用英文枚举）。"
                    f"共 {len(crops)} 张截图，请按截图顺序在 items 中返回 {len(crops)} 项，每张截图一项。"
                ),
            }
        )
        data = self._call(SYSTEM_PROMPT, content, RECOGNIZE_SCHEMA)
        items = [RecognizedItem(**_clean_item(it)) for it in data.get("items", [])]
        # 兜底：条数不符时按截图数对齐
        while len(items) < len(crops):
            items.append(RecognizedItem(subject=subjects[0] if subjects else "math", knowledgePoints=[], stemText=""))
        return items[: len(crops)]

    def scan_pages(self, pages: list[Crop], subjects: list[str], grade: str) -> list[ScannedItem]:
        content: list[dict] = []
        for i, page in enumerate(pages):
            content.append({"type": "text", "text": f"第 {i} 页（page = {i}）："})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": page.media_type,
                        "data": base64.standard_b64encode(page.data).decode("utf-8"),
                    },
                }
            )
        subject_names = "、".join(SUBJECT_LABELS[s] for s in subjects if s in SUBJECT_LABELS)
        content.append(
            {
                "type": "text",
                "text": (
                    f"学生年级：小学{grade}年级。可选学科：{subject_names}（subject 字段用英文枚举）。"
                    f"共 {len(pages)} 页，请把所有页面上的错题都列出来，page 从 0 开始计数；没有错题则 items 为空数组。"
                ),
            }
        )
        data = self._call(SCAN_SYSTEM_PROMPT, content, SCAN_SCHEMA, max_tokens=24000)
        items: list[ScannedItem] = []
        for raw in data.get("items", []):
            cleaned = _clean_item(raw)
            page = int(raw.get("page", 0) or 0)
            bbox = raw.get("bbox") if isinstance(raw.get("bbox"), list) and len(raw.get("bbox")) == 4 else [0, 0, 1, 1]
            try:
                bbox = [min(1.0, max(0.0, float(v))) for v in bbox]
            except (TypeError, ValueError):
                bbox = [0.0, 0.0, 1.0, 1.0]
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                bbox = [0.0, 0.0, 1.0, 1.0]
            items.append(ScannedItem(**cleaned, page=min(max(page, 0), len(pages) - 1), bbox=bbox, reason=str(raw.get("reason") or "")))
        return items

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        subject = SUBJECT_LABELS.get(mistake.get("subject", ""), mistake.get("subject", ""))
        prompt = (
            f"学科：{subject}；知识点：{'、'.join(mistake.get('knowledgePoints', []))}。\n"
            f"原题：{mistake.get('stemText', '')}\n"
            f"学生当时的错误：{mistake.get('studentAnswer', '')}（错因：{'、'.join(mistake.get('reasons', []))}）\n"
            f"请出 {count} 道考查同一知识点、难度相当、数字或情境不同的同类变式题。"
            "优先出单选题（3 个选项，answer 写选项字母 A/B/C）或填空题（answer 写答案本身），"
            "每题附不超过 80 字的解析。"
        )
        data = self._call(
            "你是一位小学教师，擅长为学生出同类变式题，题目表述简洁、面向小学生。",
            [{"type": "text", "text": prompt}],
            VARIANT_SCHEMA,
            max_tokens=4000,
        )
        return [Variant(**_clean_variant(v)) for v in data.get("variants", [])][:count]


_ITEM_KEYS = {f for f in RecognizedItem.__dataclass_fields__}  # noqa: SLF001
_VARIANT_KEYS = {f for f in Variant.__dataclass_fields__}  # noqa: SLF001


def _clean_item(raw: dict) -> dict:
    """中转模式下模型可能多给或少给字段：只保留已知字段并补默认值。"""
    out = {k: raw[k] for k in _ITEM_KEYS if k in raw}
    out.setdefault("subject", "math")
    if out["subject"] not in SUBJECTS:
        out["subject"] = "math"
    out.setdefault("knowledgePoints", [])
    out.setdefault("stemText", "")
    if out.get("questionType") not in QUESTION_TYPES:
        out["questionType"] = "solve"
    for key in ("options", "uncertainSpans"):
        if not isinstance(out.get(key), list):
            out[key] = []
    for key in ("studentAnswer", "correctAnswer", "analysis", "tip"):
        out[key] = str(out.get(key) or "")
    return out


def _clean_variant(raw: dict) -> dict:
    out = {k: raw[k] for k in _VARIANT_KEYS if k in raw}
    out.setdefault("question", "")
    if out.get("questionType") not in QUESTION_TYPES:
        out["questionType"] = "solve"
    if not isinstance(out.get("options"), list):
        out["options"] = []
    out["answer"] = str(out.get("answer") or "")
    out["analysis"] = str(out.get("analysis") or "")
    return out
