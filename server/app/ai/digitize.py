"""试卷数字化的公共逻辑：清洗模型返回的版面块，并从版面块派生可收录的题目。

版面块（DigitizedBlock）忠实于原卷排版；错题本收录仍以「题」为单位，
所以这里把 item 块整题派生为一题、passage 块的每个编号空各派生为一题。
"""
from __future__ import annotations

import re

from ..constants import QUESTION_TYPES, SUBJECTS
from .base import BLOCK_TYPES, DigitizedBlank, DigitizedBlock, DigitizedPage, DigitizedQuestion

MARKS = ("correct", "wrong", "partial", "unmarked")
UNANSWERED = "未作答"
BLANK_RE = re.compile(r"\[\[([^\[\]]{1,24})\]\]")


def _str(v) -> str:
    return "" if v is None else str(v)


def _str_list(v) -> list[str]:
    return [str(x) for x in v if str(x).strip()] if isinstance(v, list) else []


def clean_bbox(raw) -> list[float]:
    bbox = raw if isinstance(raw, list) and len(raw) == 4 else [0, 0, 1, 1]
    try:
        bbox = [min(1.0, max(0.0, float(v))) for v in bbox]
    except (TypeError, ValueError):
        bbox = [0.0, 0.0, 1.0, 1.0]
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        bbox = [0.0, 0.0, 1.0, 1.0]
    return bbox


def clean_blank(raw: dict, fallback_number: str = "") -> DigitizedBlank | None:
    if not isinstance(raw, dict):
        return None
    bid = _str(raw.get("id")).strip() or _str(raw.get("number")).strip()
    if not bid:
        return None
    student = _str(raw.get("student"))
    mark = raw.get("mark") if raw.get("mark") in MARKS else "unmarked"
    note = _str(raw.get("note"))
    # 没写作答的空视为不会做：按错题处理；老师已打勾的（例如阅读题整体给分）不改
    if not student.strip() and mark in ("unmarked", "wrong"):
        mark = "wrong"
        if UNANSWERED not in note:
            note = UNANSWERED if not note else f"{UNANSWERED}；{note}"
    return DigitizedBlank(
        id=bid,
        number=_str(raw.get("number")).strip() or fallback_number or bid.split("-")[0],
        student=student,
        mark=mark,
        note=note,
        answer=_str(raw.get("answer")),
        analysis=_str(raw.get("analysis")),
    )


def clean_block(raw: dict) -> DigitizedBlock | None:
    """中转模式下模型可能多给或少给字段：只保留已知字段并补默认值；空块丢弃。"""
    if not isinstance(raw, dict):
        return None
    btype = raw.get("type") if raw.get("type") in BLOCK_TYPES else "text"
    # 题号去掉尾部的点（"44." → "44"）；正文开头若重复了题号（"49. After…"）也去掉
    number = _str(raw.get("number")).strip().rstrip(".．、 ")
    blanks: list[DigitizedBlank] = []
    seen: set[str] = set()
    for b in raw.get("blanks") or []:
        blank = clean_blank(b, number)
        if blank and blank.id not in seen:
            seen.add(blank.id)
            blanks.append(blank)
    text = _str(raw.get("text"))
    if number and btype == "item":
        text = re.sub(r"^\s*" + re.escape(number) + r"\s*[.．、]\s*", "", text, count=1)
    # 文本里引用了但 blanks 里没有的占位，补一个空记录，保证渲染时每个占位都有落点
    for bid in BLANK_RE.findall(text):
        if bid not in seen:
            seen.add(bid)
            blanks.append(DigitizedBlank(id=bid, number=number or bid.split("-")[0], mark="wrong", note=UNANSWERED))
    subject = raw.get("subject") if raw.get("subject") in SUBJECTS else "math"
    qtype = raw.get("questionType") if raw.get("questionType") in QUESTION_TYPES else ("choice" if raw.get("options") else "fill")
    block = DigitizedBlock(
        type=btype,
        text=text,
        label=_str(raw.get("label")).strip(),
        title=_str(raw.get("title")).strip(),
        instruction=_str(raw.get("instruction")).strip(),
        points=_str(raw.get("points")).strip(),
        number=number,
        hint=_str(raw.get("hint")).strip(),
        options=_str_list(raw.get("options")),
        blanks=blanks,
        bbox=clean_bbox(raw.get("bbox")),
        subject=subject,
        questionType=qtype,
        knowledgePoints=_str_list(raw.get("knowledgePoints"))[:3],
        tip=_str(raw.get("tip")),
        uncertainSpans=_str_list(raw.get("uncertainSpans")),
    )
    if btype == "wordbank" and not block.options:
        return None
    if btype in ("passage", "item", "text") and not block.text.strip() and not block.blanks:
        return None
    if btype == "section" and not (block.label or block.title or block.instruction):
        return None
    return block


_LABEL_ONLY_RE = re.compile(r"^[（(]?[A-Za-z一二三四五六七八九十ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,3}[）)]?$")


def _merge_labels(blocks: list[DigitizedBlock]) -> list[DigitizedBlock]:
    """模型偶尔把「(B)」这类篇号单独输出成 text 块：并进紧随其后（最多隔一个词库）的 passage 的 label。"""
    out: list[DigitizedBlock] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b.type == "text" and _LABEL_ONLY_RE.match(b.text.strip()):
            label = b.text.strip()
            for j in (i + 1, i + 2):
                if j < len(blocks) and blocks[j].type == "passage" and (j == i + 1 or blocks[i + 1].type == "wordbank"):
                    if not blocks[j].label:
                        blocks[j].label = label
                    if blocks[j].label.strip("（）()") == label.strip("（）()"):
                        b = None  # 篇号已在短文上，不再单独成块
                    break
        if b is not None:
            out.append(b)
        i += 1
    return out


def clean_sheet(raw: dict, page: int) -> DigitizedPage:
    blocks = _merge_labels([b for b in (clean_block(x) for x in (raw.get("blocks") or [])) if b])
    return DigitizedPage(
        page=page,
        label=_str(raw.get("label")).strip(),
        title=_str(raw.get("title")).strip(),
        score=_str(raw.get("score")).strip(),
        note=_str(raw.get("note")).strip(),
        examLevel=_str(raw.get("examLevel")).strip(),
        examGrade=_str(raw.get("examGrade")).strip(),
        region=_str(raw.get("region")).strip(),
        syllabus=_str(raw.get("syllabus")).strip(),
        blocks=blocks,
    )


def clean_sheets(data: dict, page: int) -> list[DigitizedPage]:
    """一张照片的模型输出 → 若干 sheet；一个块都没有的 sheet 丢弃，但至少保留一张。"""
    sheets = [clean_sheet(s, page) for s in (data.get("sheets") or []) if isinstance(s, dict)]
    sheets = [s for s in sheets if s.blocks]
    return sheets or [DigitizedPage(page=page)]


# ---------------------------------------------------------------- derive questions


def _aggregate_mark(blanks: list[DigitizedBlank]) -> str:
    marks = {b.mark for b in blanks}
    if not marks:
        return "unmarked"
    if "partial" in marks or {"wrong", "correct"} <= marks:
        return "partial"
    if "wrong" in marks:
        return "wrong"
    if "correct" in marks:
        return "correct"
    return "unmarked"


def _render_text(text: str, blanks: list[DigitizedBlank], focus: str | None) -> str:
    """把 [[id]] 占位换成纯文本：当前空用「____」，其余空用「(编号)____」。"""
    by_id = {b.id: b for b in blanks}

    def repl(m: re.Match) -> str:
        bid = m.group(1)
        if focus is None or bid == focus:
            return "____"
        b = by_id.get(bid)
        return f"({b.number if b else bid})____"

    return BLANK_RE.sub(repl, text)


def _join(parts: list[str]) -> str:
    """按空拼接；相同内容（如多个「未作答」）只保留一次。"""
    seen: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return "；".join(seen)


def _nearby_wordbank(blocks: list[DigitizedBlock], i: int) -> list[str]:
    """passage 的词库框通常紧挨着短文（前或后），中间最多隔一个块。"""
    for j in (i - 1, i + 1, i - 2, i + 2):
        if 0 <= j < len(blocks) and blocks[j].type == "wordbank":
            return list(blocks[j].options)
    return []


def derive_questions(sheets: list[DigitizedPage]) -> list[DigitizedQuestion]:
    questions: list[DigitizedQuestion] = []
    for si, sheet in enumerate(sheets):
        for bi, block in enumerate(sheet.blocks):
            if block.type == "item":
                blanks = block.blanks
                stem = _render_text(block.text, blanks, None)
                if block.hint:
                    stem = f"{stem} {block.hint}"
                if block.instruction:
                    stem = f"{stem}（{block.instruction}）" if not block.instruction.startswith("（") else f"{stem}{block.instruction}"
                if len(blanks) > 1:
                    student = _join([f"{b.student}" for b in blanks])
                    answer = _join([b.answer for b in blanks])
                else:
                    student = blanks[0].student if blanks else ""
                    answer = blanks[0].answer if blanks else ""
                questions.append(
                    DigitizedQuestion(
                        page=sheet.page,
                        number=block.number or (blanks[0].number if blanks else ""),
                        subject=block.subject,
                        questionType=block.questionType,
                        stemText=stem.strip(),
                        options=list(block.options),
                        studentAnswer=student,
                        mark=_aggregate_mark(blanks),
                        teacherNote=_join([b.note for b in blanks]),
                        bbox=list(block.bbox),
                        knowledgePoints=list(block.knowledgePoints),
                        correctAnswer=answer,
                        analysis=_join([b.analysis for b in blanks]),
                        tip=block.tip,
                        uncertainSpans=list(block.uncertainSpans),
                        sheet=si,
                        blockIndex=bi,
                        blankIds=[b.id for b in blanks],
                    )
                )
            elif block.type == "passage":
                options = _nearby_wordbank(sheet.blocks, bi)
                for b in block.blanks:
                    questions.append(
                        DigitizedQuestion(
                            page=sheet.page,
                            number=b.number or b.id,
                            subject=block.subject,
                            questionType="choice" if options else block.questionType,
                            stemText=_render_text(block.text, block.blanks, b.id).strip(),
                            options=options,
                            studentAnswer=b.student,
                            mark=b.mark,
                            teacherNote=b.note,
                            bbox=list(block.bbox),
                            knowledgePoints=list(block.knowledgePoints),
                            correctAnswer=b.answer,
                            analysis=b.analysis,
                            tip=block.tip,
                            uncertainSpans=list(block.uncertainSpans),
                            sheet=si,
                            blockIndex=bi,
                            blankIds=[b.id],
                        )
                    )
    return questions
