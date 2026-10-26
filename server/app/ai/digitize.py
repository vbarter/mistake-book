"""试卷数字化的公共逻辑：清洗模型返回的版面块，并从版面块派生可收录的题目。

版面块（DigitizedBlock）忠实于原卷排版；错题本收录仍以「题」为单位，
所以这里把 item 块整题派生为一题、passage 块的每个编号空各派生为一题。
"""
from __future__ import annotations

import logging
import re

from ..constants import QUESTION_TYPES, SUBJECTS
from .base import BLOCK_TYPES, DigitizedBlank, DigitizedBlock, DigitizedPage, DigitizedQuestion

log = logging.getLogger(__name__)

MARKS = ("correct", "wrong", "partial", "blank", "unmarked")
PHOTO_ISSUES = ("blurry", "cropped", "dark", "glare", "tilted", "covered")  # blank = 未作答，单独一类，不算答错
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


_SUBSUP = str.maketrans("₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹", "01234567890123456789")


def _norm_answer(s: str) -> str:
    """比较作答用：全角转半角，上下标数字转普通数字（O₂ 与 O2 相同），忽略大小写、空白和首尾标点。"""
    s = re.sub(r"\\d?frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", s.replace("$", ""))
    s = re.sub(r"\\(left|right|mathrm|text|displaystyle)", "", s).replace("{", "").replace("}", "").replace("^", "")
    s = s.translate(_SUBSUP)
    s = "".join(chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c for c in s)
    s = s.strip().lower().replace("．", ".").replace("，", ",")
    s = re.sub(r"\s+", " ", s)
    return s.rstrip(".。,，;；!！?？ ")


def auto_mark(mark: str, student: str, answer: str, question_type: str = "fill") -> str:
    """老师没批改（unmarked）但模型给了正确答案时，自动对照学生作答判对错。

    只对选择题 / 填空题这类短答案做，解答题不做；看不清（□）的不做。
    answer 里用 / 或 ； 分隔的视为多个可接受答案。
    """
    if mark != "unmarked" or question_type == "solve":
        return mark
    s, a = student.strip(), answer.strip()
    if not s or not a or "□" in s or len(a) > 60:
        return mark
    alts = [x for x in re.split(r"[/／;；]|\s或\s", a) if x.strip()]
    ns = _norm_answer(s)
    if any(_norm_answer(x) == ns for x in alts):
        return "correct"
    # 算式、函数式这类答案写法很多（因式分解 / 展开、分数 / 小数），字面不同不代表错：留给 AI 阅卷判等价
    if question_type != "choice" and any(re.search(r"[=/\\]|[a-z]\d|\d[a-z]|√", _norm_answer(x)) for x in alts):
        return mark
    # 选择题：学生只写了字母，答案写成「B. awards」这种也算对
    if len(ns) == 1 and any(_norm_answer(x)[:1] == ns and re.match(r"^[a-h][.、．\s]", _norm_answer(x)) for x in alts):
        return "correct"
    return "wrong"


def clean_blank(raw: dict, fallback_number: str = "") -> DigitizedBlank | None:
    if not isinstance(raw, dict):
        return None
    bid = _str(raw.get("id")).strip() or _str(raw.get("number")).strip()
    if not bid:
        return None
    student = _str(raw.get("student"))
    mark = raw.get("mark") if raw.get("mark") in MARKS else "unmarked"
    note = _str(raw.get("note"))
    # 没写作答的空单独归为「未作答」（blank），不算答错；老师已打勾的（例如阅读题整体给分）不改
    if not student.strip() and mark in ("unmarked", "wrong", "blank"):
        mark = "blank"
        note = "；".join(x for x in note.split("；") if x and x != UNANSWERED)
    return DigitizedBlank(
        id=bid,
        number=_str(raw.get("number")).strip() or fallback_number or bid.split("-")[0],
        student=student,
        mark=mark,
        note=note,
        answer=_str(raw.get("answer")),
        analysis=_str(raw.get("analysis")),
    )


_LINE_START = re.compile(r"^\s*(?:[A-H][.、．)）]|\(?\d{1,3}[.)）、．]|[①-⑳]|[一二三四五六七八九十]+[、.．]|[(（]\d{1,3}[)）])")
_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]")


def unwrap_lines(text: str) -> str:
    """把 OCR 带来的「排版换行」合回一行：一句话被折成两行时合并（中文直接相连，其它用空格）；
    空行（真正的分段）和以选项 / 题号 / 序号开头的行保持换行。"""
    out: list[str] = []
    for raw in text.replace("\r", "").split("\n"):
        line = re.sub(r"[ \t]{2,}", " ", raw.strip())  # OCR 常把一个空格识别成两三个
        if not line:
            if out and out[-1] != "":
                out.append("")
            continue
        if out and out[-1] != "" and not _LINE_START.match(line):
            prev = out[-1]
            glue = "" if (_CJK.search(prev[-1]) and _CJK.search(line[0])) else " "
            out[-1] = prev + glue + line
        else:
            out.append(line)
    return "\n".join(out).strip()


def clean_block(raw: dict, default_subject: str = "math") -> DigitizedBlock | None:
    """中转模式下模型可能多给或少给字段：只保留已知字段并补默认值；空块丢弃。学科缺失时继承卷面学科。"""
    if not isinstance(raw, dict):
        return None
    btype = raw.get("type") if raw.get("type") in BLOCK_TYPES else "text"
    # 题号去掉尾部的点（"44." → "44"）；正文开头若重复了题号（"49. After…"）也去掉
    number = _str(raw.get("number")).strip().rstrip(".．、 ")
    blanks: list[DigitizedBlank] = []
    seen: set[str] = set()
    for b in ([] if btype == "figure" else raw.get("blanks") or []):
        blank = clean_blank(b, number)
        if blank and blank.id not in seen:
            seen.add(blank.id)
            blanks.append(blank)
    text = unwrap_lines(_str(raw.get("text")))
    if btype == "figure":
        text = re.sub(BLANK_RE.pattern, "", text)  # 插图里不该有作答空
    if number and btype == "item":
        text = re.sub(r"^\s*" + re.escape(number) + r"\s*[.．、]\s*", "", text, count=1)
    # 文本里引用了但 blanks 里没有的占位，补一个空记录，保证渲染时每个占位都有落点
    for bid in BLANK_RE.findall(text):
        if bid not in seen:
            seen.add(bid)
            blanks.append(DigitizedBlank(id=bid, number=number or bid.split("-")[0], mark="blank"))
    subject = raw.get("subject") if raw.get("subject") in SUBJECTS else default_subject
    qtype = raw.get("questionType") if raw.get("questionType") in QUESTION_TYPES else ("choice" if raw.get("options") else "fill")
    for b in blanks:
        before = b.mark
        b.mark = auto_mark(b.mark, b.student, b.answer, qtype)
        b.aiGraded = before == "unmarked" and b.mark != "unmarked"
    block = DigitizedBlock(
        type=btype,
        text=text,
        # 大题编号去掉尾部的点（「II.」→「II」），显示时统一加
        label=_str(raw.get("label")).strip().rstrip(".．、 ") if btype == "section" else _str(raw.get("label")).strip(),
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
    # 插图要靠 bbox 从原照片裁出来：没给位置（默认整页）就没用
    if btype == "figure" and (block.bbox == [0.0, 0.0, 1.0, 1.0] or (block.bbox[2] - block.bbox[0]) * (block.bbox[3] - block.bbox[1]) < 0.0012):
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
    subject = raw.get("subject") if raw.get("subject") in SUBJECTS else ""
    blocks = merge_figures(_merge_labels([b for b in (clean_block(x, subject or "math") for x in (raw.get("blocks") or [])) if b]))
    if not subject:
        # 卷面没判出学科时按题块多数推断
        counts: dict[str, int] = {}
        for b in blocks:
            if b.type in ("passage", "item"):
                counts[b.subject] = counts.get(b.subject, 0) + 1
        subject = max(counts, key=counts.get) if counts else ""
    return DigitizedPage(
        page=page,
        subject=subject,
        label=_str(raw.get("label")).strip(),
        title=_str(raw.get("title")).strip(),
        score=_str(raw.get("score")).strip(),
        note=_str(raw.get("note")).strip(),
        examLevel=_str(raw.get("examLevel")).strip(),
        examGrade=_str(raw.get("examGrade")).strip(),
        region=_str(raw.get("region")).strip(),
        syllabus=_str(raw.get("syllabus")).strip(),
        photoIssues=[x for x in (raw.get("photoIssues") or []) if x in PHOTO_ISSUES][:4] if isinstance(raw.get("photoIssues"), list) else [],
        photoNote=_str(raw.get("photoNote")).strip()[:60],
        rotation=_rotation(raw.get("rotation")),
        blocks=blocks,
    )


def _rotation(v) -> int:
    try:
        return int(v or 0) % 4
    except (TypeError, ValueError):
        return 0


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


GENERIC_FIGURE_TITLES = {"", "插图", "图", "示意图"}


def merge_figures(blocks: list[DigitizedBlock]) -> list[DigitizedBlock]:
    """模型常把一幅图拆成几块（一排烧杯拆成四个、一张图切成左右两半）：同一道题、彼此挨着（并排或上下叠着、间距 < 8%）的相邻插图合成一幅，
    位置取并集；图题有具体名字的（图1）留下来，「插图」这种泛称让位。"""
    out: list[DigitizedBlock] = []
    for b in blocks:
        prev = out[-1] if out else None
        # 带 label 的是选项图 / 配对图（A、B、C 各一张），不能合并
        if b.type == "figure" and prev is not None and prev.type == "figure" and prev.number == b.number and not prev.label and not b.label:
            same_title = prev.title == b.title or prev.title in GENERIC_FIGURE_TITLES or b.title in GENERIC_FIGURE_TITLES
            dx = max(0.0, max(prev.bbox[0], b.bbox[0]) - min(prev.bbox[2], b.bbox[2]))
            dy = max(0.0, max(prev.bbox[1], b.bbox[1]) - min(prev.bbox[3], b.bbox[3]))
            # 并排的（上下有重叠）横向间距 < 8%、上下叠着的纵向间距 < 8%，或两个方向都很近
            side_by_side = dy == 0.0 and dx < 0.08
            stacked = dx == 0.0 and dy < 0.08
            if same_title and (side_by_side or stacked or (dx < 0.04 and dy < 0.04)):
                prev.bbox = [min(prev.bbox[0], b.bbox[0]), min(prev.bbox[1], b.bbox[1]), max(prev.bbox[2], b.bbox[2]), max(prev.bbox[3], b.bbox[3])]
                if prev.title in GENERIC_FIGURE_TITLES:
                    prev.title = b.title
                if b.text and b.text not in prev.text:
                    prev.text = f"{prev.text}；{b.text}" if prev.text else b.text
                continue
        out.append(b)
    return out


def snap_figures(sheets: list[DigitizedPage], regions: list[dict], direction: int = 0) -> None:
    """模型给的插图位置往往不够准：和 OCR 版面分析检测到的插图 / 表格区域重叠明显的，换成 OCR 的精确位置；
    同时记下照片方向，客户端裁图后转正。"""
    boxes = [g["bbox"] for g in regions if isinstance(g, dict) and isinstance(g.get("bbox"), list) and len(g["bbox"]) == 4]
    for sh in sheets:
        sh.rotation = direction % 4
        for b in sh.blocks:
            if b.type != "figure" or not boxes:
                continue
            best = max(boxes, key=lambda r: _iou(b.bbox, r))
            # 选项图很小，OCR 常把一排几张检测成一个区域：带 label 的要几乎重合才贴，免得几张都贴到同一个大框上
            if _iou(b.bbox, best) >= (0.5 if b.label else 0.2):
                b.bbox = [float(v) for v in best]
        sh.blocks = merge_figures(sh.blocks)


def clean_sheets(data: dict, page: int) -> list[DigitizedPage]:
    """一张照片的模型输出 → 若干 sheet；一个块都没有的 sheet 丢弃，但至少保留一张。"""
    sheets = [clean_sheet(s, page) for s in (data.get("sheets") or []) if isinstance(s, dict)]
    sheets = [s for s in sheets if s.blocks]
    return sheets or [DigitizedPage(page=page)]


def _block_numbers(blk: DigitizedBlock) -> set[str]:
    if blk.type == "item":
        return {blk.number.strip()} if blk.number.strip() else set()
    if blk.type == "passage":
        return {(b.number or b.id).strip() for b in blk.blanks if (b.number or b.id)}
    return set()


def _text_key(text: str) -> str:
    """比较两道小题是不是同一题：只留字母数字和汉字，取前 12 个字。"""
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", BLANK_RE.sub("", text or "")).lower()[:12]


def unreadable(student: str) -> bool:
    """学生作答整个看不清：去掉空白和标点后只剩「□」。"""
    core = re.sub(r"[\s,，.。;；:：()（）$\\]", "", student or "")
    return bool(core) and set(core) <= {"□"}


def _is_empty_fragment(blk: DigitizedBlock) -> bool:
    """题干去掉空格占位、□ 和标点后不到 6 个字，并且每个空的作答都是空的或看不清。"""
    content = re.sub(r"[\s\W_□]", "", BLANK_RE.sub("", blk.text or ""))
    return len(content) < 6 and all(not b.student.strip() or unreadable(b.student) for b in blk.blanks)


def drop_ghost_sheets(sheets: list[DigitizedPage]) -> list[DigitizedPage]:
    """去掉照片边缘残片带来的重复题。

    照片边缘常拍进半截相邻页，模型会把它当成一张没有页码的卷面，还会把残缺短文的空错编成正常卷面上已有的题号。
    规则：别的卷面有页码、这张没有（或这张既没页码也没大题标题）时视为可疑卷面；
    可疑卷面里，短文只要有一个空号和正常卷面重复就整段丢掉（编号已不可信），小题题号和题干都相同才丢；
    丢完没有题的可疑卷面整张去掉。题号分大题重新编号的正常卷面不受影响。"""
    if len(sheets) < 2:
        return sheets
    labeled_any = any(s.label.strip() for s in sheets)

    def suspect(s: DigitizedPage) -> bool:
        return not s.label.strip() and (labeled_any or not any(b.type == "section" for b in s.blocks))

    solid_nums: set[str] = set()
    solid_items: dict[str, set[str]] = {}
    for s in sheets:
        if suspect(s):
            continue
        for blk in s.blocks:
            solid_nums |= _block_numbers(blk)
            if blk.type == "item" and blk.number.strip():
                solid_items.setdefault(blk.number.strip(), set()).add(_text_key(blk.text))
    if not solid_nums:
        return sheets

    out: list[DigitizedPage] = []
    dropped = 0
    for s in sheets:
        if not suspect(s):
            out.append(s)
            continue
        keep = []
        for blk in s.blocks:
            # 残片上既没有题目原文、学生作答又全都看不清的题：只是照片边缘的半行字，丢掉
            if blk.type in ("item", "passage") and _is_empty_fragment(blk):
                dropped += 1
                continue
            if blk.type == "passage" and _block_numbers(blk) & solid_nums:
                dropped += 1
                continue
            if blk.type == "item" and _text_key(blk.text) in solid_items.get(blk.number.strip(), set()):
                dropped += 1
                continue
            keep.append(blk)
        had_questions = any(b.type in ("item", "passage") for b in s.blocks)
        if had_questions and not any(b.type in ("item", "passage") for b in keep):
            continue  # 整张都是重复内容：去掉
        s.blocks = keep
        out.append(s)
    if dropped:
        log.info("dropped %d duplicate block(s) from photo-edge fragments", dropped)
    return out or sheets


def sheets_from_dicts(pages: list) -> list[DigitizedPage]:
    """App 回传的电子版（DigitizedPage.to_dict 的结构）还原成对象；不认识的字段忽略，用于对已存的试卷补做 AI 阅卷。"""
    from dataclasses import fields

    def pick(cls, d: dict) -> dict:
        names = {f.name for f in fields(cls)}
        return {k: v for k, v in d.items() if k in names}

    out: list[DigitizedPage] = []
    for p in pages or []:
        if not isinstance(p, dict):
            continue
        blocks = []
        for b in p.get("blocks") or []:
            if not isinstance(b, dict):
                continue
            blanks = [DigitizedBlank(**pick(DigitizedBlank, x)) for x in (b.get("blanks") or []) if isinstance(x, dict) and x.get("id")]
            blocks.append(DigitizedBlock(**{**pick(DigitizedBlock, b), "blanks": blanks}))
        out.append(DigitizedPage(**{**pick(DigitizedPage, p), "blocks": blocks}))
    return out


# ---------------------------------------------------------------- derive questions


def _aggregate_mark(blanks: list[DigitizedBlank]) -> str:
    marks = {b.mark for b in blanks}
    if not marks:
        return "unmarked"
    if "partial" in marks or {"wrong", "correct"} <= marks or {"blank", "correct"} <= marks:
        return "partial"
    if "wrong" in marks:
        return "wrong"
    if "blank" in marks:
        return "blank"
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


_LISTENING = re.compile(r"listen|听力|听到|听对话|听短文|听录音|听下面|听一段", re.I)


def listening_blocks(sheets: list[DigitizedPage]) -> set[tuple[int, int]]:
    """听力部分的题块（sheet 下标, 块下标）。卷子上只有题目没有录音，答案没法从卷面得出：
    从标题含「Listen / 听力 / 听到…」的大题开始，跨页一直算到下一个不是听力的大题为止。"""
    out: set[tuple[int, int]] = set()
    listening = False
    for si, sheet in enumerate(sheets):
        for bi, block in enumerate(sheet.blocks):
            if block.type == "section":
                listening = bool(_LISTENING.search(" ".join(x for x in (block.label, block.title, block.instruction) if x)))
            elif listening and block.type in ("item", "passage"):
                out.add((si, bi))
    return out


def clear_listening_answers(sheets: list[DigitizedPage]) -> int:
    """听力题的「正确答案」是大模型没听录音猜的，清掉，免得电子版上显示错的答案。返回清了几个空。"""
    n = 0
    for si, bi in listening_blocks(sheets):
        for b in sheets[si].blocks[bi].blanks:
            if b.answer or b.analysis:
                b.answer, b.analysis = "", ""
                n += 1
    return n


_PLACEHOLDER_ONLY = re.compile(r"^[\s_＿.．、:：()（）0-9]*$")
_LETTER = re.compile(r"^\s*([A-Ha-h])\s*[.．、)）]?\s*(.*)$", re.S)


def _option_text(option: str) -> tuple[str, str]:
    """「A. However」→（"A", "However"）。"""
    m = _LETTER.match(option)
    return (m.group(1).upper(), m.group(2).strip()) if m else ("", option.strip())


def split_choice_links(sheets: list[DigitizedPage]) -> dict[tuple[int, int], tuple[int, int, str]]:
    """跨页拆开的选择题：短文（带空）在一页、选项在后一页（完形填空常见）。
    每张照片单独识别，于是短文页出「没有选项的空」，选项页出「只有选项、题干为空的选择题」，同一题号出两遍。
    返回 {选项块位置: (短文所在 sheet, 块下标, 空 id)}：选项块并进短文的那个空，不再单独出题。"""
    blanks: dict[str, tuple[int, int, str]] = {}  # 题号 → 最近一个没有选项的短文空
    links: dict[tuple[int, int], tuple[int, int, str]] = {}
    for si, sheet in enumerate(sheets):
        for bi, block in enumerate(sheet.blocks):
            if block.type == "passage" and not _nearby_wordbank(sheet.blocks, bi):
                for b in block.blanks:
                    blanks[(b.number or b.id).strip()] = (si, bi, b.id)
            elif block.type == "item" and block.options and len(block.blanks) == 1:
                num = (block.number or block.blanks[0].number or block.blanks[0].id).strip()
                stem = BLANK_RE.sub("", block.text).replace(num, "")
                hit = blanks.get(num)
                if hit and hit[0] < si and _PLACEHOLDER_ONLY.match(stem):
                    links[(si, bi)] = hit
    return links


def reconcile_split_choices(sheets: list[DigitizedPage]) -> list[tuple[DigitizedBlock, DigitizedBlank, DigitizedBlock]]:
    """跨页选择题两边答案对齐：短文那页看得到上下文，它给的词如果正好是某个选项，就换成选项字母；
    选项那页只看得到选项、答案是猜的，改成同一个字母。
    返回对不上的（短文页给的词不在选项里）：[(选项块, 短文里的空, 短文块)]，交给大模型看着短文和选项重新选。"""
    unresolved = []
    for (si, bi), (ps, pb, bid) in split_choice_links(sheets).items():
        item = sheets[si].blocks[bi]
        passage = sheets[ps].blocks[pb]
        blank = next(b for b in passage.blanks if b.id == bid)
        letter = option_letter(item.options, blank.answer)
        if letter:
            set_split_choice(item, blank, letter, blank.analysis)
        else:
            unresolved.append((item, blank, passage))
    return unresolved


def option_letter(options: list[str], answer: str) -> str:
    """答案（字母或选项内容）对应的选项字母；对不上返回空。"""
    word = _norm_answer(answer or "")
    for opt in options:
        code, text = _option_text(opt)
        if word and (word == _norm_answer(text) or word == code.lower()):
            return code
    return ""


def set_split_choice(item: DigitizedBlock, blank: DigitizedBlank, letter: str, analysis: str) -> None:
    """短文里的空和选项页的题统一成同一个字母答案。"""
    blank.answer = letter
    if analysis:
        blank.analysis = analysis
    target = item.blanks[0]
    target.answer, target.analysis = letter, blank.analysis or target.analysis


_SUB_NUMBER = re.compile(r"^[(（][0-9一二三四五六七八九十]+[)）]|^[①②③④⑤⑥⑦⑧⑨⑩]")
_PARENT = re.compile(r"^(\d+)\s*(?:[(（]|$)")


def _with_parent_numbers(questions: list[DigitizedQuestion], sheets: list[DigitizedPage]) -> None:
    """小题题号只写了「(3)」「(7)①」时补上所属大题号（「12(3)」）：大题号取最近的数字大题标题（如「12. 调控化学变化」），
    或前面最近一个「11(2)」这样带大题号的题。全角括号统一成半角。"""
    parent_at: dict[tuple[int, int], str] = {}
    parent = ""
    for si, sheet in enumerate(sheets):
        for bi, block in enumerate(sheet.blocks):
            if block.type == "section":
                label = (block.label or "").strip().rstrip(".．、")
                parent = label if label.isdigit() else ""
            elif block.type in ("item", "passage"):
                m = _PARENT.match((block.number or "").strip())
                if m:
                    parent = m.group(1)
                parent_at[(si, bi)] = parent
    for q in questions:
        num = q.number.strip().replace("（", "(").replace("）", ")")
        p = parent_at.get((q.sheet, q.blockIndex), "")
        if p and _SUB_NUMBER.match(num):
            num = p + num
        q.number = num


def derive_questions(sheets: list[DigitizedPage]) -> list[DigitizedQuestion]:
    """从卷面派生题目。听力题不出题：没有录音，判不了对错，也不算错题 / 未作答（卷面上照常保留）。
    跨页拆开的选择题（短文一页、选项一页）合成一题；小题题号补上大题号。"""
    questions: list[DigitizedQuestion] = []
    skip = listening_blocks(sheets)
    links = split_choice_links(sheets)
    linked_options = {(ps, pb, bid): sheets[si].blocks[bi] for (si, bi), (ps, pb, bid) in links.items()}
    for si, sheet in enumerate(sheets):
        for bi, block in enumerate(sheet.blocks):
            if (si, bi) in skip or (si, bi) in links:
                continue
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
                        aiGraded=any(b.aiGraded for b in blanks),
                    )
                )
            elif block.type == "passage":
                options = _nearby_wordbank(sheet.blocks, bi)
                for b in block.blanks:
                    linked = linked_options.get((si, bi, b.id))
                    opts = list(linked.options) if linked else options
                    # 学生可能把选项圈在选项页上：短文空没写就用选项页的作答和批改
                    other = linked.blanks[0] if linked else None
                    use_other = other is not None and not b.student.strip() and other.student.strip()
                    questions.append(
                        DigitizedQuestion(
                            page=sheet.page,
                            number=b.number or b.id,
                            subject=block.subject,
                            questionType="choice" if opts else block.questionType,
                            stemText=_render_text(block.text, block.blanks, b.id).strip(),
                            options=opts,
                            studentAnswer=other.student if use_other else b.student,
                            mark=other.mark if use_other else b.mark,
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
                            aiGraded=other.aiGraded if use_other else b.aiGraded,
                        )
                    )
    _with_parent_numbers(questions, sheets)
    return questions
