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
class DigitizedBlank:
    """卷面上的一个空：空号、学生手写、老师批改、正确答案。"""

    id: str  # 在 text 里用 [[id]] 占位；编号空就是题号，如 "36"；一题多空用 "52-1" "52-2"
    number: str = ""  # 所属题号
    student: str = ""  # 学生手写转写，看不清的字用「□」
    mark: str = "unmarked"  # correct | wrong | partial | unmarked
    note: str = ""  # 老师红笔批注 / 扣分
    answer: str = ""  # 正确答案（判错或未批改时给出）
    analysis: str = ""  # 判错时的简短解析

    def to_dict(self) -> dict:
        return asdict(self)


BLOCK_TYPES = ["section", "passage", "wordbank", "item", "text"]


@dataclass
class DigitizedBlock:
    """电子版试卷里的一个版面块，按原卷阅读顺序排列。

    section  大题标题：label（"Ⅳ"）、title（英文/中文标题）、instruction（中文说明）、points（分值）
    passage  短文/材料：text 中用 [[36]] 这样的占位表示内嵌空格，blanks 逐空记录
    wordbank 词库/选项框：options
    item     小题：number、text（含占位空格）、hint（括号给词）、instruction（改写要求）、options（选择题选项）、blanks
    text     其他卷面文字（页眉页脚、订正提醒等）
    """

    type: str
    text: str = ""
    label: str = ""
    title: str = ""
    instruction: str = ""
    points: str = ""
    number: str = ""
    hint: str = ""
    options: list[str] = field(default_factory=list)
    blanks: list[DigitizedBlank] = field(default_factory=list)
    bbox: list[float] = field(default_factory=lambda: [0.0, 0.0, 1.0, 1.0])
    subject: str = "math"
    questionType: str = "fill"
    knowledgePoints: list[str] = field(default_factory=list)
    tip: str = ""
    uncertainSpans: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DigitizedQuestion:
    """从版面块派生出的一道可收录的题（一个编号空 = 一题），兼容错题本收录链路。"""

    page: int
    number: str  # 题号原样，如 "36" "二、3"
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
    sheet: int = 0  # 所在 sheet（pages 列表里的下标）
    blockIndex: int = 0  # 所在版面块在 sheet.blocks 里的下标
    blankIds: list[str] = field(default_factory=list)  # 对应的空 id

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DigitizedPage:
    """一张电子版卷面（sheet）。一张照片可能拍到左右两页，于是一个 page 可对应多个 sheet。"""

    page: int  # 来源照片下标
    label: str = ""  # 卷面页码文字，如 "第5页"
    title: str = ""
    score: str = ""
    note: str = ""  # 卷面上的其他文字（订正提醒等）
    subject: str = ""  # 整张卷子的学科（从卷头判断），题块的 subject 默认继承它
    examLevel: str = ""  # 考试类型：单元测 / 期中 / 期末 / 中考模拟 / 中考 / 高考 …
    examGrade: str = ""  # 年级 / 学段，如 "九年级"
    region: str = ""  # 地区，如 "上海"
    syllabus: str = ""  # 知识点归类依据的考纲 / 课标名称，如 "上海中考英语考纲"
    ocrText: str = ""  # OCR 模型逐行识别出的原文（印刷文字，公式为 LaTeX），同一张照片的几个 sheet 相同
    blocks: list[DigitizedBlock] = field(default_factory=list)

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

    def digitize_pages(self, pages: list[Crop], subjects: list[str], grade: str, region: str = "", on_page_done=None, on_page_start=None, on_page_progress=None) -> tuple[list[DigitizedPage], list[DigitizedQuestion]]:
        """试卷数字化：按原卷版面还原为 sheet → blocks，并派生出可收录的题目列表。region 是学生所在城市（可空）；
        每张照片拿到识别槽位时调用 on_page_start(started, total)，流式输出中按完成度调用 on_page_progress(index, fraction)，还原完调用 on_page_done(done, total)。"""
        raise NotImplementedError

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        raise NotImplementedError
