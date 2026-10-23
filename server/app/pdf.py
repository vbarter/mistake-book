"""电子版试卷导出 PDF（可打印）：

第一部分「试卷」：原题干净还原，空格只留下划线与空号，不带任何手写内容；
第二部分「作答与批改」：每个空的学生作答、判定、正确答案单独列表；
第三部分「错题汇总」：按错误类型、所属大题、知识点归类，并附解析。

字体用 reportlab 内置的 CJK CID 字体（STSong-Light），不依赖服务器上的字体文件。
"""
from __future__ import annotations

import html
import io
import re
from collections import OrderedDict

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .ai.digitize import auto_mark

FONT = "STSong-Light"
BLANK_RE = re.compile(r"\[\[([^\[\]]{1,24})\]\]")
MARK_LABEL = {"correct": "正确", "wrong": "错误", "partial": "半对", "blank": "未作答", "unmarked": "未批改"}
PROBLEM_MARKS = ("wrong", "partial", "blank")


def _kind(q: dict) -> str:
    """答错 / 半对 / 未作答；旧数据里未作答存成 wrong + 空作答，一并识别。"""
    if q.get("mark") == "blank" or not (q.get("studentAnswer") or "").strip():
        return UNANSWERED
    return "半对" if q.get("mark") == "partial" else "答错"
UNANSWERED = "未作答"


def _font() -> None:
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(FONT))


_font()
S_TITLE = ParagraphStyle("title", fontName=FONT, fontSize=16, leading=22, alignment=TA_CENTER, spaceAfter=2)
S_SUB = ParagraphStyle("sub", fontName=FONT, fontSize=9, leading=12, alignment=TA_CENTER, textColor=colors.grey, spaceAfter=8)
S_H = ParagraphStyle("h", fontName=FONT, fontSize=12, leading=17, spaceBefore=8, spaceAfter=2)
S_H2 = ParagraphStyle("h2", fontName=FONT, fontSize=11, leading=15, spaceBefore=6, spaceAfter=2)
S_INS = ParagraphStyle("ins", fontName=FONT, fontSize=9, leading=13, textColor=colors.HexColor("#555555"), spaceAfter=3)
S_BODY = ParagraphStyle("body", fontName=FONT, fontSize=10.5, leading=17)
S_ITEM = ParagraphStyle("item", fontName=FONT, fontSize=10.5, leading=17, leftIndent=18, firstLineIndent=-18, spaceAfter=3)
S_OPT = ParagraphStyle("opt", fontName=FONT, fontSize=10, leading=15, leftIndent=18)
S_SMALL = ParagraphStyle("small", fontName=FONT, fontSize=8.5, leading=12, textColor=colors.grey, alignment=TA_CENTER)
S_CELL = ParagraphStyle("cell", fontName=FONT, fontSize=9.5, leading=13)
S_CELL_WRONG = ParagraphStyle("cellw", parent=S_CELL, textColor=colors.HexColor("#b42323"))
S_CELL_OK = ParagraphStyle("cello", parent=S_CELL, textColor=colors.HexColor("#1e7a47"))


def _esc(text: str) -> str:
    return html.escape(text or "", quote=False).replace("\n", "<br/>")


def _blank_print(text: str, blanks: list[dict]) -> str:
    """打印版：空格只留下划线与空号。"""
    by_id = {b.get("id"): b for b in blanks}

    def repl(m: re.Match) -> str:
        b = by_id.get(m.group(1)) or {}
        num = b.get("number") or m.group(1).split("-")[0]
        # reportlab 的 <u> 配合 CID 字体下划线位置不稳，直接用全角下划线画空格：＿＿＿36＿＿＿
        return f"＿＿＿{_esc(str(num))}＿＿＿"

    return BLANK_RE.sub(repl, _esc(text))


def _strip_paren(s: str) -> str:
    return re.sub(r"^[（(]|[）)]$", "", s or "").strip()


def _paper_part(story: list, sheets: list[dict], title: str, scanned_at: str = "") -> None:
    for si, sheet in enumerate(sheets):
        if si > 0:
            story.append(PageBreak())
        story.append(Paragraph(_esc(sheet.get("title") or title or "电子版试卷"), S_TITLE))
        sub = " · ".join(x for x in [sheet.get("label") or "", f"得分 {sheet['score']}" if sheet.get("score") else "", f"扫描于 {scanned_at}" if scanned_at else ""] if x)
        story.append(Paragraph(_esc(sub) if sub else "&nbsp;", S_SUB))
        for block in sheet.get("blocks") or []:
            t = block.get("type")
            blanks = block.get("blanks") or []
            if t == "section":
                head = " ".join(x for x in [f"{block.get('label')}." if block.get("label") else "", block.get("title") or ""] if x)
                if block.get("points"):
                    head += f"　（{_strip_paren(block['points'])}）"
                story.append(Paragraph(_esc(head), S_H))
                if block.get("instruction"):
                    story.append(Paragraph(_esc(block["instruction"]), S_INS))
            elif t == "wordbank":
                cell = Paragraph("　　".join(_esc(o) for o in block.get("options") or []), S_BODY)
                tbl = Table([[cell]], colWidths=[170 * mm])
                tbl.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, colors.black), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
                story.append(Spacer(1, 3))
                story.append(tbl)
                story.append(Spacer(1, 5))
            elif t == "passage":
                if block.get("label"):
                    story.append(Paragraph(_esc(block["label"]), S_H2))
                story.append(Paragraph(_blank_print(block.get("text") or "", blanks), S_BODY))
                story.append(Spacer(1, 4))
            elif t == "item":
                body = _blank_print(block.get("text") or "", blanks)
                if block.get("hint"):
                    body += f" <font color='#555555'>{_esc(block['hint'])}</font>"
                if block.get("instruction"):
                    body += f" <font color='#555555'>（{_esc(_strip_paren(block['instruction']))}）</font>"
                flow = [Paragraph(f"{_esc(block.get('number') or '')}. {body}", S_ITEM)]
                opts = block.get("options") or []
                if opts:
                    labeled = [o if re.match(r"^[A-H][.、．]", o) else f"{chr(65 + i)}. {o}" for i, o in enumerate(opts)]
                    flow.append(Paragraph("　　".join(_esc(o) for o in labeled), S_OPT))
                story.append(KeepTogether(flow))
            elif t == "text":
                story.append(Paragraph(_esc(block.get("text") or ""), S_SMALL))
        if sheet.get("note"):
            story.append(Paragraph(_esc(sheet["note"]), S_INS))


def _section_of(sheet: dict, block_index: int) -> str:
    blocks = sheet.get("blocks") or []
    for j in range(min(block_index, len(blocks) - 1), -1, -1):
        b = blocks[j]
        if b.get("type") == "section":
            return " ".join(x for x in [b.get("label") or "", b.get("title") or ""] if x) or "（未分大题）"
    return "（未分大题）"


def _answer_part(story: list, sheets: list[dict]) -> None:
    story.append(PageBreak())
    story.append(Paragraph("作答与批改", S_TITLE))
    story.append(Paragraph("学生手写内容的转写，与老师批改、正确答案逐空对照", S_SUB))
    rows = [[Paragraph(h, S_CELL) for h in ("题号", "学生作答", "判定", "正确答案")]]
    styles = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbbbbb")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")), ("VALIGN", (0, 0), (-1, -1), "TOP")]
    for sheet in sheets:
        for block in sheet.get("blocks") or []:
            if block.get("type") not in ("passage", "item"):
                continue
            for b in block.get("blanks") or []:
                mark = b.get("mark") or "unmarked"
                student = b.get("student") or ""
                unanswered = not student.strip()
                if unanswered and mark == "wrong":
                    mark = "blank"
                mark = auto_mark(mark, student, b.get("answer") or "", block.get("questionType") or "fill")
                st = S_CELL_WRONG if mark in ("wrong", "partial") else S_CELL_OK if mark == "correct" else S_CELL
                verdict = MARK_LABEL.get(mark, mark)
                note = b.get("note") or ""
                if note and note != UNANSWERED:
                    verdict += f"（{note}）"
                rows.append([
                    Paragraph(_esc(str(b.get("number") or b.get("id") or "")), S_CELL),
                    Paragraph(_esc(student) if not unanswered else "<font color='#999999'>—</font>", st),
                    Paragraph(_esc(verdict), st),
                    Paragraph(_esc(b.get("answer") or ("" if mark == "correct" else "")), S_CELL),
                ])
                if mark in ("wrong", "partial"):
                    styles.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#fff4f4")))
                elif mark == "blank":
                    styles.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#fff7ec")))
    tbl = Table(rows, colWidths=[16 * mm, 72 * mm, 30 * mm, 52 * mm], repeatRows=1)
    tbl.setStyle(TableStyle(styles))
    story.append(tbl)


def _summary_part(story: list, sheets: list[dict], questions: list[dict]) -> None:
    wrong = [q for q in questions if q.get("mark") in PROBLEM_MARKS]
    story.append(PageBreak())
    story.append(Paragraph("错题与未作答汇总", S_TITLE))
    syllabus = next((s.get("syllabus") for s in sheets if s.get("syllabus")), "")
    exam = " · ".join(x for x in [next((s.get("region") for s in sheets if s.get("region")), ""), next((s.get("examGrade") for s in sheets if s.get("examGrade")), ""), next((s.get("examLevel") for s in sheets if s.get("examLevel")), "")] if x)
    n_blank = sum(1 for q in wrong if _kind(q) == UNANSWERED)
    sub = f"共 {len(questions)} 题，答错 {len(wrong) - n_blank} 题，未作答 {n_blank} 题"
    if exam:
        sub += f" · {exam}"
    if syllabus:
        sub += f" · 按{syllabus}归类"
    story.append(Paragraph(_esc(sub), S_SUB))
    if not wrong:
        story.append(Paragraph("本卷没有错题，也没有空题。", S_BODY))
        return

    def numbers(qs: list[dict]) -> str:
        return "、".join(str(q.get("number") or "") for q in qs)

    by_kind: "OrderedDict[str, list[dict]]" = OrderedDict((k, []) for k in ("答错", "半对", UNANSWERED))
    for q in wrong:
        by_kind[_kind(q)].append(q)
    story.append(Paragraph("按类型", S_H))
    for k, qs in by_kind.items():
        if qs:
            story.append(Paragraph(f"{k}（{len(qs)} 题）：{numbers(qs)}", S_BODY))

    by_kp: "OrderedDict[str, list[dict]]" = OrderedDict()
    for q in wrong:
        kp = (q.get("knowledgePoints") or ["（未标注知识点）"])[0]
        by_kp.setdefault(kp, []).append(q)
    story.append(Paragraph("按知识点", S_H))
    for k, qs in sorted(by_kp.items(), key=lambda kv: -len(kv[1])):
        story.append(Paragraph(f"{_esc(k)}（{len(qs)} 题）：{numbers(qs)}", S_BODY))

    story.append(Paragraph("逐题解析", S_H))
    for k, qs in sorted(by_kp.items(), key=lambda kv: -len(kv[1])):
        story.append(Paragraph(_esc(k), S_H2))
        for q in qs:
            student = (q.get("studentAnswer") or "").strip() or UNANSWERED
            sub_kps = "、".join((q.get("knowledgePoints") or [])[1:])
            line = f"{_esc(str(q.get('number') or ''))}. 作答：{_esc(student)}　正确：{_esc(q.get('correctAnswer') or '—')}"
            if sub_kps:
                line += f"　<font color='#555555'>{_esc(sub_kps)}</font>"
            if q.get("analysis"):
                line += f"<br/>{_esc(q['analysis'])}"
            if q.get("tip"):
                line += f"<br/><font color='#555555'>下次注意：{_esc(q['tip'])}</font>"
            story.append(Paragraph(line, S_ITEM))


def build_pdf(title: str, sheets: list[dict], questions: list[dict]) -> bytes:
    return build_papers_pdf(title, [{"title": title, "pages": sheets, "questions": questions}])


def build_papers_pdf(title: str, papers: list[dict]) -> bytes:
    """一张或多张试卷合成一个 PDF：每张依次是 试卷打印版 → 作答与批改 → 错题汇总。"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=title or "电子版试卷")
    story: list = []
    for i, paper in enumerate(papers):
        if i > 0:
            story.append(PageBreak())
        sheets = paper.get("pages") or []
        _paper_part(story, sheets, str(paper.get("title") or title), str(paper.get("scannedAt") or "")[:40])
        _answer_part(story, sheets)
        _summary_part(story, sheets, paper.get("questions") or [])
    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------- 错题本（横向：空白重做 | 错题修正）

S_BOOK_H = ParagraphStyle("bookh", fontName=FONT, fontSize=11, leading=15, textColor=colors.HexColor("#333333"))
S_BOOK_KP = ParagraphStyle("bookkp", fontName=FONT, fontSize=11.5, leading=16, textColor=colors.HexColor("#1f55c4"), spaceBefore=2)
S_BOOK_STEM = ParagraphStyle("bookstem", fontName=FONT, fontSize=11, leading=19)
S_BOOK_META = ParagraphStyle("bookmeta", fontName=FONT, fontSize=8.5, leading=11, textColor=colors.HexColor("#8e8e93"))
S_BOOK_ANS = ParagraphStyle("bookans", fontName=FONT, fontSize=10.5, leading=15)
S_BOOK_NOTE = ParagraphStyle("booknote", fontName=FONT, fontSize=9.5, leading=13.5, textColor=colors.HexColor("#555555"))

KIND_COLOR = {"未作答": "#b42323", "答错": "#b35300", "半对": "#b35300"}


def _blank_lines(text: str) -> str:
    """重做区：题干里的「____」换成更长的横线，留足书写空间。"""
    return _esc(text).replace("____", "＿＿＿＿＿＿")


def _book_rows(items: list[dict]):
    rows = [[Paragraph("空白重做", S_BOOK_H), Paragraph("错题修正", S_BOOK_H)]]
    styles = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.black),
        ("LINEAFTER", (0, 0), (0, -1), 0.5, colors.HexColor("#bbbbbb")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#dddddd")),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]
    current_kp = None
    for it in items:
        kp = str(it.get("knowledge") or "（未标注知识点）")
        if kp != current_kp:
            current_kp = kp
            rows.append([Paragraph(f"◆ {_esc(kp)}", S_BOOK_KP), Paragraph("", S_BOOK_KP)])
            r = len(rows) - 1
            styles.append(("SPAN", (0, r), (1, r)))
            styles.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f2f5fc")))
            styles.append(("LINEBELOW", (0, r), (-1, r), 0, colors.white))
        number = _esc(str(it.get("number") or ""))
        left = [Paragraph(f"{number}. {_blank_lines(str(it.get('stem') or ''))}", S_BOOK_STEM)]
        opts = it.get("options") or []
        if opts:
            labeled = [o if re.match(r"^[A-H][.、．]", str(o)) else f"{chr(65 + i)}. {o}" for i, o in enumerate(opts)]
            left.append(Paragraph("　".join(_esc(str(o)) for o in labeled), S_BOOK_NOTE))
        if it.get("source"):
            left.append(Paragraph(_esc(str(it["source"])), S_BOOK_META))
        left.append(Spacer(1, 18))  # 书写留白
        right = []
        for a in it.get("answers") or []:
            kind = str(a.get("kind") or "答错")
            student = str(a.get("student") or "").strip() or UNANSWERED
            color = KIND_COLOR.get(kind, "#b35300")
            line = f"{_esc(str(a.get('number') or ''))}.　原答案：<font color='{color}'>{_esc(student)}</font>　正确：<font color='#1e7a47'>{_esc(str(a.get('answer') or '—'))}</font>"
            if a.get("sub"):
                line += f"　<font color='#8e8e93' size='8.5'>{_esc(str(a['sub']))}</font>"
            right.append(Paragraph(line, S_BOOK_ANS))
            if a.get("analysis"):
                right.append(Paragraph(_esc(str(a["analysis"])), S_BOOK_NOTE))
            if a.get("tip"):
                right.append(Paragraph(f"下次注意：{_esc(str(a['tip']))}", S_BOOK_NOTE))
        rows.append([left, right or [Paragraph("", S_BOOK_ANS)]])
    return rows, styles


def build_book_pdf(title: str, subtitle: str, items: list[dict]) -> bytes:
    """横向 A4：每行一道错题，左栏只有原题（空格留白），右栏原答案 / 正确答案 / 解析；按知识点分组。"""
    buf = io.BytesIO()
    page = landscape(A4)
    doc = SimpleDocTemplate(buf, pagesize=page, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm, title=title)
    story: list = [Paragraph(_esc(title), S_TITLE), Paragraph(_esc(subtitle) if subtitle else "空白重做 + 错题修正 · 对折或遮住右半页再做左边", S_SUB)]
    rows, styles = _book_rows(items)
    width = page[0] - 28 * mm
    tbl = Table(rows, colWidths=[width / 2, width / 2], repeatRows=1, splitByRow=1)
    tbl.setStyle(TableStyle(styles))
    story.append(tbl)
    doc.build(story)
    return buf.getvalue()
