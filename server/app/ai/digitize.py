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
    # 学生在答案旁边写了草稿 / 演算，识别时一起抄进来了（多行）：第一行是填在空上的答案，和正确答案一致就算对；
    # 或者几行合起来正好是答案的几个部分（「矩形 CDHG」「矩形 ABGH」对「矩形 CDHG、矩形 ABGH」）
    lines = [x for x in s.splitlines() if x.strip()]
    if len(lines) > 1:
        first = _norm_answer(lines[0])
        if any(_norm_answer(x) == first for x in alts):
            return "correct"
        parts = {_norm_answer(x) for x in re.split(r"[、,，;；]|\s和\s", a) if x.strip()}
        if len(parts) == len(lines) and {_norm_answer(x) for x in lines} == parts:
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


_BANK_OPTION = re.compile(r"(?<![A-Za-z])([A-H])\s*[.．、)）]\s*([A-Za-z\u4e00-\u9fff][^；;。,，\n]*?)(?=\s*(?:[；;，,、]|\s+[A-H]\s*[.．、)）]|$))")
_BANK_HINT = re.compile(r"词库|方框|选词|box|words|phrases", re.I)


def _wordbank_from_figure(blocks: list[DigitizedBlock]) -> list[DigitizedBlock]:
    """词库方框有时被识别成插图 / 表格（text 是「词库方框：A. placed；B. goal；…」），选项就挂不到短文上。
    figure 的文字里有 3 个以上「字母. 词」、并且写明是词库或紧挨着带空的短文时，改成 wordbank。"""
    for i, b in enumerate(blocks):
        if b.type != "figure" or b.blanks:
            continue
        text = " ".join(x for x in (b.title, b.text) if x)
        found = [(c, w.strip()) for c, w in _BANK_OPTION.findall(text)]
        letters = [c for c, _ in found]
        if len(found) < 3 or letters != [chr(ord("A") + k) for k in range(len(letters))]:
            continue
        near_passage = any(0 <= j < len(blocks) and blocks[j].type == "passage" and blocks[j].blanks for j in (i + 1, i + 2, i - 1))
        if _BANK_HINT.search(text) or near_passage:
            b.type = "wordbank"
            b.options = [f"{c}. {w}" for c, w in found]
            b.text = ""
    return blocks


def clean_sheet(raw: dict, page: int) -> DigitizedPage:
    subject = raw.get("subject") if raw.get("subject") in SUBJECTS else ""
    blocks = _wordbank_from_figure(merge_figures(_merge_labels([b for b in (clean_block(x, subject or "math") for x in (raw.get("blocks") or [])) if b])))
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
    return ("\n" if any("\n" in p for p in seen) else "；").join(seen)


def _nearby_wordbank(blocks: list[DigitizedBlock], i: int) -> list[str]:
    """passage 的词库框通常紧挨着短文（前或后），中间最多隔一个块；
    一篇短文被拆成几个 passage 块（「3. Memory Map」「4. Matching Pairs」）时，往前越过这几块找。"""
    for j in (i - 1, i + 1, i - 2, i + 2):
        if 0 <= j < len(blocks) and blocks[j].type == "wordbank":
            return list(blocks[j].options)
    j = i - 1
    while j >= 0 and blocks[j].type == "passage":
        j -= 1
    if j >= 0 and blocks[j].type == "wordbank":
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


# ---------------------------------------------------------------- page chrome & split questions

_PAGE_NO = re.compile(r"^\s*(?:第\s*\d+\s*页\s*[/／,，、]?\s*(?:共\s*\d+\s*页)?|\d+\s*/\s*\d+|[-—]\s*\d+\s*[-—])\s*$")
_AD = re.compile(r"家教|jiajiao|\+\s*V\s*[:：]|学科网|组卷网|zxxk|菁优网|21世纪教育|二一教育|免费增值服务|扫码关注|侵权必究", re.I)


def strip_page_chrome(sheets: list[DigitizedPage]) -> list[DigitizedPage]:
    """页码（「第2页共7页」）、页眉页脚的广告（「上海最大家教平台…+V」「学科网」）不是卷面内容：去掉这类 text 块；
    整页都是广告的（「免费增值服务介绍」）整张去掉，但至少留一张。"""
    out: list[DigitizedPage] = []
    dropped = 0
    for s in sheets:
        keep = []
        ad_page = False
        for b in s.blocks:
            text = " ".join(x for x in (b.title, b.text) if x).strip()
            if b.type in ("text", "figure") and not b.blanks and _AD.search(text) and len(text) < 200:
                ad_page = True
                dropped += 1
                continue
            if b.type == "text" and not b.blanks and _PAGE_NO.match(text):
                dropped += 1
                continue
            keep.append(b)
        for attr in ("note", "title"):
            if _AD.search(getattr(s, attr)):
                setattr(s, attr, "")
        if ad_page and not any(b.type in ("item", "passage", "section") for b in keep):
            continue  # 广告页
        s.blocks = keep
        out.append(s)
    if dropped:
        log.info("dropped %d page header / footer / ad block(s)", dropped)
    return out or sheets[:1]


_TOP_NUMBER = re.compile(r"^(\d{1,3})(?:\s*[(（][^()（）]{1,4}[)）])*$")  # 「20」「25(3)」
_SUB_ONLY = re.compile(r"^(?:[(（][0-9一二三四五六七八九十]{1,3}[)）]|[①-⑳]|(?:I{1,3}|IV|VI{0,3}|[ⅠⅡⅢⅣⅤⅥ])\b)")
_STEM_NUMBER = re.compile(r"^\s*(\d{1,3})\s*[.．、]\s*(?=\S)")
_OPTION_AT = re.compile(r"(?:^|(?<=\s))([A-H])(?:\s*[.．、:：]\s*|(?=[\u4e00-\u9fff$]))")  # 「A. xx」，也有印成「A逐渐减小」不带点的
_SENTENCE_END = re.compile(r"[。！？!?.…」”）)：:；;]\s*$")


def _number_kind(number: str) -> str:
    """题号分三类：top（「20」「25(3)」）、sub（「(3)」「①」「II」）、loose（空、「续题」「water」「top-1」等模型编的号）。"""
    n = number.strip().rstrip(".．、 ")
    if _TOP_NUMBER.match(n):
        return "top"
    if _SUB_ONLY.match(n):
        return "sub"
    return "loose"


def _base(number: str) -> str:
    m = re.match(r"\d+", number.strip())
    return m.group(0) if m else ""


def _parse_options(text: str, start: str = "A") -> list[str]:
    """「A. most popular B. more popular C. …」或逐行的「B.同步人脸识别…」→ 选项列表；
    必须从 start 字母开头、字母连续，至少两项（接着前页选项的可以只有一项）。"""
    t = (text or "").strip()
    found = list(_OPTION_AT.finditer(t))
    if not found or found[0].start() != 0 or found[0].group(1) != start:
        return []
    letters = [m.group(1) for m in found]
    if letters != [chr(ord(start) + k) for k in range(len(letters))] or (len(letters) < 2 and start == "A"):
        return []
    out = []
    for k, m in enumerate(found):
        end = found[k + 1].start() if k + 1 < len(found) else len(t)
        body = t[m.end():end].strip().rstrip("；;")
        if not body:
            return []
        out.append(f"{m.group(1)}. {body}")
    return out


def _next_letter(options: list[str]) -> str:
    letters = [_option_text(o)[0] for o in options]
    return chr(ord(letters[-1]) + 1) if letters and letters[-1] else "A"


def _needs_options(blk: DigitizedBlock) -> bool:
    return blk.questionType == "choice" and len(blk.options) < 2


def _glue(a: str, b: str) -> str:
    if not a:
        return b
    if not b:
        return a
    return a + ("" if (_CJK.search(a[-1]) or _CJK.search(b[0])) else " ") + b


def join_page_breaks(sheets: list[DigitizedPage]) -> list[DigitizedBlock]:
    """一句话被分页截断：下一页顶端没有题号、接不上新题的 text / passage 块，接回上一页最后一道题或短文的末尾。
    返回被接长的块。"""
    touched: list[DigitizedBlock] = []
    for si in range(1, len(sheets)):
        blocks = sheets[si].blocks
        if not blocks:
            continue
        first = blocks[0]
        if first.type not in ("text", "passage") or first.blanks or first.label:
            continue
        text = first.text.strip()
        if not text or _STEM_NUMBER.match(text) or _parse_options(text) or _OPTION_AT.match(text):
            continue
        prev = next((b for b in reversed(sheets[si - 1].blocks) if b.type != "figure"), None)
        if prev is None or prev.type not in ("item", "passage") or not prev.text.strip():
            continue
        if _SENTENCE_END.search(BLANK_RE.sub("", prev.text)):
            continue  # 上一页的话已经说完：这是新的内容
        prev.text = _glue(prev.text.rstrip(), text)
        blocks.pop(0)
        touched.append(prev)
    return touched


def _split_groups(sheets: list[DigitizedPage]) -> tuple[list[list[tuple[int, int]]], dict[tuple[int, int], tuple[int, int]]]:
    """找出被分页或插图拆开的题：返回 (要合成一块的若干组位置（第一个是题干）, {小题位置: 只有题干的大题位置})。

    题干（有题号、没有空，或者是没有选项的选择题）后面、下一个题号之前出现的：
    没题号 / 模型编的号（「续题」「water」「top-1」）的小题、同一个题号的小题、接着字母的选项文字，都是这一题的后半。
    「(1)」「①」这种小题号仍各自成题，只记下它们的大题题干（派生题目时补在前面）。"""
    skip = listening_blocks(sheets)
    groups: list[list[tuple[int, int]]] = []
    parents: dict[tuple[int, int], tuple[int, int]] = {}
    head: tuple[int, int] | None = None
    group: list[tuple[int, int]] = []
    letter = "A"  # 题干是缺选项的选择题时，下一个选项应是哪个字母
    got_options = False  # 这一组已经从后面补到了选项

    def blk(pos):
        return sheets[pos[0]].blocks[pos[1]]

    def close():
        nonlocal group
        if len(group) > 1:
            groups.append(group)
        group = []

    for si, sheet in enumerate(sheets):
        first_question = True
        for bi, b in enumerate(sheet.blocks):
            pos = (si, bi)
            if pos in skip:
                close()
                head = None
                continue
            if b.type == "section":
                if b.label or b.title:  # 只有一句作答说明（「仔细阅读上述材料，解答下面的问题」）的不算新大题
                    close()
                    head = None
                continue
            if b.type in ("figure", "wordbank"):
                continue
            if b.type == "passage":
                if b.blanks:
                    close()
                    head = None
                continue
            h = blk(head) if head else None
            if b.type == "text":
                m = _STEM_NUMBER.match(b.text)
                if m and not b.blanks:  # 「22.如图为……」被识别成 text：当题干
                    close()
                    head, group = pos, [pos]
                    letter, got_options = "A", False
                    first_question = False
                elif h is not None and _needs_options(blk(group[0])) and _parse_options(b.text, letter):
                    group.append(pos)
                    letter = _next_letter(_parse_options(b.text, letter))
                    got_options = True
                continue
            # item
            num = b.number.strip().rstrip(".．、 ")
            kind = _number_kind(num)
            stem_only = h is not None and not any(blk(p).blanks for p in group)
            lacks_options = h is not None and _needs_options(blk(group[0])) and not got_options and not any(len(blk(p).options) >= 2 for p in group[1:])
            head_num = (h.number if h.type == "item" else _STEM_NUMBER.match(h.text).group(1)) if h is not None else ""
            if kind == "top":
                # 同一个题号又出现一次：前一半只有题干 / 缺选项，或者是下一页开头接着写的（「(4)…」续在下一页还标着 26）
                if h is not None and _base(num) == _base(head_num) and num.replace(" ", "") in (head_num.replace(" ", ""), _base(head_num)) and (stem_only or lacks_options or (first_question and head[0] < si)):
                    group.append(pos)
                else:
                    close()
                    head, group = pos, [pos]
                    letter, got_options = (_next_letter(b.options) if b.options else "A"), False
            elif kind == "sub":
                if h is not None:
                    parents[pos] = head
            elif h is not None:
                ids = [x.id for x in b.blanks]
                same_number = head_num and any(i.startswith(head_num + "-") for i in ids)
                new_page = first_question and head[0] < si
                sub_text = bool(_SUB_NUMBER.match(BLANK_RE.sub("", b.text).strip()))  # 没题号、正文以「(2)」开头：前一题的小问
                if stem_only or lacks_options or same_number or sub_text or "续" in num + "".join(ids) or new_page:
                    group.append(pos)
            first_question = False
    close()
    return groups, parents


def _renumber_blanks(blk: DigitizedBlock) -> None:
    """合并后的空统一编号：一个空用题号，多个空用「题号-1」「题号-2」…（占位一起改）。"""
    if not blk.blanks:
        return
    ids = [b.id for b in blk.blanks]
    new = [blk.number] if len(ids) == 1 else [f"{blk.number}-{k}" for k in range(1, len(ids) + 1)]
    tmp = {old: f"\x00{k}\x00" for k, old in enumerate(ids)}
    text = BLANK_RE.sub(lambda m: f"[[{tmp[m.group(1)]}]]" if m.group(1) in tmp else m.group(0), blk.text)
    for k, (b, nid) in enumerate(zip(blk.blanks, new)):
        text = text.replace(f"[[\x00{k}\x00]]", f"[[{nid}]]")
        b.id, b.number = nid, blk.number
    blk.text = text


def _merge_group(sheets: list[DigitizedPage], group: list[tuple[int, int]]) -> tuple[tuple[int, int], DigitizedBlock]:
    """把一组拆开的块合成一道 item，放在插图所在的那页（客户端在题目所在页找插图），没有插图就放在最后一页；返回 (位置, 块)。"""
    blocks = [sheets[si].blocks[bi] for si, bi in group]
    head = blocks[0]
    number = head.number if head.type == "item" else _STEM_NUMBER.match(head.text).group(1)
    if head.type == "text":
        head.text = _STEM_NUMBER.sub("", head.text, count=1)
    first, last = group[0], group[-1]
    figure_sheets = [si for si in sorted({si for si, _ in group}) if any(
        b.type == "figure" and (not b.number or _base(b.number) == _base(number)) and first <= (si, bi) <= last
        for bi, b in enumerate(sheets[si].blocks))]
    anchor_sheet = figure_sheets[0] if figure_sheets else last[0]
    target = next(p for p in group if p[0] == anchor_sheet)
    items = [b for b in blocks if b.type == "item"] or [head]
    base_blk = next((b for b in items if b.knowledgePoints), items[0])

    # 页底的题干（只有已知条件）末尾被多给了一个空，小问在后面：这个空不是作答处，去掉
    if head.type == "item" and len(head.blanks) == 1 and any(b.blanks for b in blocks[1:]) and head.text.rstrip().endswith(f"[[{head.blanks[0].id}]]") and not head.blanks[0].student.strip():
        head.text = head.text.rstrip()[: -len(f"[[{head.blanks[0].id}]]")].rstrip()
        head.blanks = []
    options = list(next((b.options for b in blocks if len(b.options) >= 2), head.options))
    texts: list[str] = []
    blanks: list[DigitizedBlank] = []
    seen: dict[str, DigitizedBlank] = {}
    for b in blocks:
        extra = _parse_options(b.text, _next_letter(options)) if b.type == "text" and b is not head else []
        if extra:
            options += extra
            continue
        text = b.text
        for x in b.blanks:
            if x.id in seen:  # 两页都记了同一个空（短文页一个、选项页一个）：留一个，作答取有的那个
                kept = seen[x.id]
                if not kept.student.strip() and x.student.strip():
                    kept.student, kept.mark, kept.note = x.student, x.mark, x.note
                text = text.replace(f"[[{x.id}]]", "", 1)
                continue
            seen[x.id] = x
            blanks.append(x)
        if text.strip():
            texts.append(text.strip())
    # 图片当选项（选项是几张标了 A、B、C 的小图），选项还没有：用插图的描述补上
    if head.questionType == "choice" and len(options) < 2:
        figs = [b for si, s in enumerate(sheets) for bi, b in enumerate(s.blocks)
                if b.type == "figure" and len(b.label.strip()) == 1 and b.label.strip() in "ABCDEFGH" and first <= (si, bi) <= last]
        if len(figs) >= 2:
            options = [f"{f.label.strip()}. （图）{f.text[:60]}" for f in figs]
    merged = DigitizedBlock(
        type="item",
        text="\n".join(texts),
        number=number,
        hint=" ".join(dict.fromkeys(b.hint for b in blocks if b.hint)),
        instruction=" ".join(dict.fromkeys(b.instruction for b in blocks if b.instruction)),
        points=next((b.points for b in blocks if b.points), ""),
        options=options,
        blanks=blanks,
        bbox=list(sheets[target[0]].blocks[target[1]].bbox),
        subject=base_blk.subject,
        questionType="choice" if len(options) >= 2 else (head.questionType if head.type == "item" else base_blk.questionType),
        knowledgePoints=list(base_blk.knowledgePoints),
        tip=next((b.tip for b in items if b.tip), ""),
        uncertainSpans=[x for b in blocks for x in b.uncertainSpans],
    )
    if all(si == target[0] for si, _ in group):
        bxs = [b.bbox for b in blocks]
        merged.bbox = [min(x[0] for x in bxs), min(x[1] for x in bxs), max(x[2] for x in bxs), max(x[3] for x in bxs)]
    _renumber_blanks(merged)
    return target, merged


def merge_split_questions(sheets: list[DigitizedPage]) -> list[DigitizedBlock]:
    """一道题被分页或插图拆成几块（题干在页底、小题 / 选项 / 图在下一页；题干和小题中间隔着图）：合成一道题。
    合完后仍然没有空、也没有小题的题（「想一想：他为什么要这样编排呢？」）补一个空，让大模型作答。
    返回合并过 / 补过空的块（它们的答案要看着完整题目重做）。"""
    groups, _ = _split_groups(sheets)
    touched: list[DigitizedBlock] = []
    remove: set[tuple[int, int]] = set()
    put: dict[tuple[int, int], DigitizedBlock] = {}
    for group in groups:
        target, merged = _merge_group(sheets, group)
        put[target] = merged
        remove |= set(group) - {target}
        touched.append(merged)
    if groups:
        for si, sheet in enumerate(sheets):
            sheet.blocks = [put.get((si, bi), b) for bi, b in enumerate(sheet.blocks) if (si, bi) not in remove]
        log.info("merged %d split question(s)", len(groups))
    touched += options_from_figures(sheets)
    _, parents = _split_groups(sheets)
    parent_heads = set(parents.values())
    skip = listening_blocks(sheets)
    answered = {(x.number or x.id).strip() for s in sheets for b in s.blocks for x in b.blanks}  # 题号已经是别处的空（短文里的 [[83]]）
    for si, sheet in enumerate(sheets):
        for bi, b in enumerate(sheet.blocks):
            if b.type != "item" or b.blanks or (si, bi) in parent_heads or (si, bi) in skip or _number_kind(b.number) == "loose" or b.number.strip() in answered:
                continue
            if not _has_sub_questions(sheets, si, bi):
                b.blanks = [DigitizedBlank(id=b.number, number=b.number, mark="blank")]
                b.text = f"{b.text.rstrip()} [[{b.number}]]"
                touched.append(b)
    return touched


def options_from_figures(sheets: list[DigitizedPage]) -> list[DigitizedBlock]:
    """选项是几张标了 A、B、C 的小图、而且印在下一页开头的选择题：用插图描述补上选项，并把题挪到插图那页（客户端按题目所在页找选项图）。"""
    touched: list[DigitizedBlock] = []
    for si in range(len(sheets) - 1):
        blocks = sheets[si].blocks
        if not blocks:
            continue
        item = blocks[-1]
        if item.type != "item" or not _needs_options(item):
            continue
        nxt = sheets[si + 1].blocks
        figs = []
        for b in nxt:
            if b.type == "figure" and len(b.label.strip()) == 1 and b.label.strip() == chr(ord("A") + len(figs)):
                figs.append(b)
            else:
                break
        if len(figs) < 2:
            continue
        item.options = [f"{f.label.strip()}. （图）{f.text[:60]}" for f in figs]
        blocks.pop()
        nxt.insert(0, item)
        touched.append(item)
    return touched


def _has_sub_questions(sheets: list[DigitizedPage], si: int, bi: int) -> bool:
    """题号为 N 的题后面（下一个大题号之前）有没有「N(1)」「(1)」这样的小题。"""
    num = sheets[si].blocks[bi].number.strip()
    after = [b for s in sheets[si:] for b in (s.blocks[bi + 1:] if s is sheets[si] else s.blocks)]
    for b in after:
        if b.type == "section" and (b.label or b.title):
            return False
        if b.type not in ("item", "passage"):
            continue
        n = b.number.strip()
        if _number_kind(n) == "sub" or re.match(re.escape(num) + r"\s*[(（①-⑳]", n):
            return True
        if _number_kind(n) == "top":
            return False
    return False


def parent_stems(sheets: list[DigitizedPage]) -> dict[tuple[int, int], tuple[int, int]]:
    """「(1)」「①」这种小题各自成题时，它们所属大题那块的位置：{小题位置: 大题位置}。"""
    return _split_groups(sheets)[1]


def stem_lead(blk: DigitizedBlock) -> str:
    """大题的引导部分（第一个小题或第一个空之前的那几行），补在单独成题的小题前面。"""
    lines: list[str] = []
    for line in _STEM_NUMBER.sub("", blk.text, count=1).split("\n"):
        if _SUB_NUMBER.match(line.strip()) or BLANK_RE.search(line):
            break
        lines.append(line)
    return "\n".join(lines).strip()


_GUESSED = re.compile(r"缺[前后上下]页|本页|前页|上一页|下一页|前一页|后页|原文不在|不在本页|无法确定|条件不足|需结合|推定|看不到")
_LETTERS = re.compile(r"^[A-Ha-h](?:\s*[、,，;；]?\s*[A-Ha-h])*$")


def needs_context(sheets: list[DigitizedPage], touched: list[DigitizedBlock]) -> list[tuple[int, int]]:
    """要看着前后页重新作答的题块：合并过 / 补过空 / 接长过的；大题题干在别的页上的小题；
    模型自己说缺了别页内容（「本页未显示前页已知条件」「原文不在本页，推定」）的；该有答案却没给的；
    有选项但答案不是字母的选择题（先尝试按选项内容换成字母）。听力不做。"""
    skip = listening_blocks(sheets)
    parents = parent_stems(sheets)
    ids = {id(b) for b in touched}
    out: list[tuple[int, int]] = []
    for si, sheet in enumerate(sheets):
        for bi, blk in enumerate(sheet.blocks):
            if blk.type not in ("item", "passage") or not blk.blanks or (si, bi) in skip:
                continue
            options = blk.options or (_nearby_wordbank(sheet.blocks, bi) if blk.type == "passage" else [])
            if blk.type == "item" and len(blk.options) >= 2 and blk.questionType == "choice":
                for b in blk.blanks:
                    if b.answer and not _LETTERS.match(b.answer.strip()):
                        b.answer = option_letter(blk.options, b.answer) or b.answer
            bad = any(
                _GUESSED.search(f"{b.answer} {b.analysis}")
                or (not b.answer.strip() and b.mark != "correct")
                or (blk.type == "item" and blk.questionType == "choice" and len(options) >= 2 and b.answer and not _LETTERS.match(b.answer.strip()))
                for b in blk.blanks
            )
            cross = (si, bi) in parents and parents[(si, bi)][0] != si
            if id(blk) in ids or bad or cross:
                out.append((si, bi))
    return out


def apply_context_answer(blk: DigitizedBlock, blank: DigitizedBlank, answer: str, analysis: str) -> None:
    """重新作答的结果写回：选择题换成字母；老师没批改、之前按旧答案自动判的空，按新答案重新判（判不了的留给 AI 阅卷）。"""
    answer = answer.strip()
    if blk.questionType == "choice" and blk.options and not _LETTERS.match(answer):
        answer = option_letter(blk.options, answer) or answer
    if not answer:
        return
    blank.answer = answer[:400]
    blank.analysis = analysis.strip()[:3000]
    if blank.aiGraded or blank.mark == "unmarked":
        blank.mark = auto_mark("unmarked", blank.student, blank.answer, blk.questionType) if blank.student.strip() else "blank"
        blank.aiGraded = blank.mark not in ("unmarked", "blank")


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
    parents = parent_stems(sheets)
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
                if (si, bi) in parents:  # 「(2)」这种小题单独成题：前面补上大题题干，题目才完整
                    ps, pb = parents[(si, bi)]
                    lead = stem_lead(sheets[ps].blocks[pb])
                    stem = f"{lead}\n{stem}" if lead else stem
                if len(blanks) > 1:
                    # 学生作答和答案按空一一对应，相同的也要保留（「B；A；B」不能变成「B；A」）；批注、解析才去重
                    student = "；".join(b.student for b in blanks) if any(b.student.strip() for b in blanks) else ""
                    # 判对的空模型通常不给答案：用学生写的（它就是对的），整题答案才完整（「Did；set」而不是「；set」）
                    per_blank = [b.answer or (b.student if b.mark == "correct" else "") for b in blanks]
                    answer = "；".join(per_blank) if any(x.strip() for x in per_blank) else ""
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
    # 大题的引导语（如「17. 小华和小明……」，下面是 17(1)–(4)）被识别成没有空的 item：不是一道题，去掉
    numbers = [q.number for q in questions]
    heads = set(parents.values())
    # 没有空、题号又和别的题重复的（短文里的空 [[83]]，下面又单独印了一行「83. 问题…」）：同一题，去掉没有空的那个
    answered = {q.number for q in questions if q.blankIds}
    questions = [q for q in questions if q.blankIds or not ((q.sheet, q.blockIndex) in heads or q.number in answered or any(n.startswith(q.number + "(") for n in numbers if q.number))]
    return questions


# ---------- 数理化详解 ----------

EXPLAIN_SUBJECTS = {"math", "physics", "chemistry"}
EXPLAIN_MARKS = {"wrong", "partial", "blank"}


def explain_targets(sheets: list[DigitizedPage]) -> list[tuple[int, int, list[DigitizedBlank]]]:
    """数学、物理、化学里做错、半对、没作答的空（按题块分组），给它们写详细讲解；听力和看不清的不写。"""
    listening = listening_blocks(sheets)
    out = []
    for si, sheet in enumerate(sheets):
        for bi, blk in enumerate(sheet.blocks):
            if blk.type not in ("item", "passage") or (si, bi) in listening:
                continue
            if (blk.subject or sheet.subject) not in EXPLAIN_SUBJECTS:
                continue
            blanks = [b for b in blk.blanks if b.mark in EXPLAIN_MARKS and b.answer.strip()]
            if blanks:
                out.append((si, bi, blanks))
    return out


def _line(text) -> str:
    return re.sub(r"\s*\n\s*", " ", str(text or "")).strip()


def format_explanation(r: dict) -> str:
    """详解写成分段文字：【思路】【知识点】【解答】（每步一行）【技巧】【易错】，学生答错时最后一行「错在：」。客户端按【】分段显示。"""
    steps = [x for x in (_line(s) for s in r.get("steps") or []) if x]
    if not steps:
        return ""
    knowledge = "；".join(x for x in (_line(k).rstrip("。；;，, ") for k in r.get("knowledge") or []) if x)
    lines = []
    if _line(r.get("thinking")):
        lines.append("【思路】" + _line(r.get("thinking")))
    if knowledge:
        lines.append("【知识点】" + knowledge)
    lines.append("【解答】")
    lines += steps
    if _line(r.get("technique")):
        lines.append("【技巧】" + _line(r.get("technique")))
    if _line(r.get("pitfall")):
        lines.append("【易错】" + _line(r.get("pitfall")))
    if _line(r.get("wrongAt")):
        lines.append("错在：" + _line(r.get("wrongAt")))
    return "\n".join(lines)


def _same_answer(a: str, b: str) -> bool:
    norm = lambda x: re.sub(r"[\s$，,。.；;]|\\[,;! ]", "", x).lower()  # noqa: E731
    return norm(a) == norm(b)


def apply_explanation(blk: DigitizedBlock, blank: DigitizedBlank, r: dict) -> bool:
    """详解写回这个空；详解算出的答案和原答案不同就以详解为准（老师没批改的按新答案重新判）。"""
    text = format_explanation(r)
    if not text:
        return False
    answer = _line(r.get("answer"))
    if answer and not _same_answer(answer, blank.answer):
        apply_context_answer(blk, blank, answer, text)
    blank.analysis = text[:3000]
    return True
