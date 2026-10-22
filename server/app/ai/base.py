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
class ScannedItem(RecognizedItem):
    """整页扫描找到的一道错题：多了所在页序号与归一化框（0–1，相对整页）。"""

    page: int = 0
    bbox: list[float] = field(default_factory=lambda: [0.0, 0.0, 1.0, 1.0])
    reason: str = ""  # 判定为错题的依据，例如「有红叉」「答案与正确答案不符」


@dataclass
class DigitizedQuestion:
    """电子版试卷里的一道题：题目原文 + 学生手写作答的转写 + 老师批改。"""

    page: int
    number: str  # 题号原样，如 "1" "二、3"
    subject: str
    questionType: str
    stemText: str
    options: list[str] = field(default_factory=list)
    studentAnswer: str = ""  # 学生手写内容的转写
    mark: str = "unmarked"  # correct | wrong | partial | unmarked
    teacherNote: str = ""  # 老师红笔批注 / 扣分
    bbox: list[float] = field(default_factory=lambda: [0.0, 0.0, 1.0, 1.0])
    knowledgePoints: list[str] = field(default_factory=list)
    correctAnswer: str = ""
    analysis: str = ""
    tip: str = ""
    uncertainSpans: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DigitizedPage:
    page: int
    title: str = ""
    score: str = ""
    note: str = ""  # 卷面上的其他文字（订正提醒等）

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

    def scan_pages(self, pages: list[Crop], subjects: list[str], grade: str) -> list[ScannedItem]:
        """整页扫描：找出页面上所有被判错的题目并识别。"""
        raise NotImplementedError

    def digitize_pages(self, pages: list[Crop], subjects: list[str], grade: str) -> tuple[list[DigitizedPage], list[DigitizedQuestion]]:
        """试卷数字化：转写全部题目与手写作答、老师批改；判错题附答案解析。"""
        raise NotImplementedError

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        raise NotImplementedError
