from __future__ import annotations

from dataclasses import dataclass, field, asdict


class AIError(Exception):
    """AI 调用失败，message 面向用户可读。"""


@dataclass
class Crop:
    data: bytes
    media_type: str = "image/jpeg"
    hint: str = ""  # 可选：前端传来的辅助文字（例如用户已手动输入的题干）


@dataclass
class RecognizedItem:
    subject: str
    knowledgePoints: list[str]
    stemText: str
    questionType: str = "solve"
    options: list[str] = field(default_factory=list)
    uncertainSpans: list[str] = field(default_factory=list)
    studentAnswer: str = ""
    correctAnswer: str = ""
    analysis: str = ""
    tip: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Variant:
    question: str
    questionType: str
    options: list[str]
    answer: str
    analysis: str

    def to_dict(self) -> dict:
        return asdict(self)


class AIProvider:
    name = "base"

    def recognize(self, crops: list[Crop], subjects: list[str], grade: str) -> list[RecognizedItem]:
        raise NotImplementedError

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        raise NotImplementedError
