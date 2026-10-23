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
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FONT = "STSong-Light"
BLANK_RE = re.compile(r"\[\[([^\[\]]{1,24})\]\]")
MARK_LABEL = {"correct": "正确", "wrong": "错误", "partial": "半对", "unmarked": "未批改"}
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


def _paper_part(story: list, sheets: list[dict], title: str) -> None:
    for si, sheet in enumerate(sheets):
        if si > 0:
            story.append(PageBreak())
        story.append(Paragraph(_esc(sheet.get("title") or title or "电子版试卷"), S_TITLE))
        sub = " · ".join(x for x in [sheet.get("label") or "", f"得分 {sheet['score']}" if sheet.get("score") else ""] if x)
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
                st = S_CELL_WRONG if mark in ("wrong", "partial") else S_CELL_OK if mark == "correct" else S_CELL
                verdict = UNANSWERED if unanswered and mark == "wrong" else MARK_LABEL.get(mark, mark)
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
    tbl = Table(rows, colWidths=[16 * mm, 72 * mm, 30 * mm, 52 * mm], repeatRows=1)
    tbl.setStyle(TableStyle(styles))
    story.append(tbl)


def _summary_part(story: list, sheets: list[dict], questions: list[dict]) -> None:
    wrong = [q for q in questions if q.get("mark") in ("wrong", "partial")]
    story.append(PageBreak())
    story.append(Paragraph("错题汇总", S_TITLE))
    syllabus = next((s.get("syllabus") for s in sheets if s.get("syllabus")), "")
    exam = " · ".join(x for x in [next((s.get("region") for s in sheets if s.get("region")), ""), next((s.get("examGrade") for s in sheets if s.get("examGrade")), ""), next((s.get("examLevel") for s in sheets if s.get("examLevel")), "")] if x)
    sub = f"共 {len(questions)} 题，错 {len(wrong)} 题"
    if exam:
        sub += f" · {exam}"
    if syllabus:
        sub += f" · 按{syllabus}归类"
    story.append(Paragraph(_esc(sub), S_SUB))
    if not wrong:
        story.append(Paragraph("本卷没有错题。", S_BODY))
        return

    def numbers(qs: list[dict]) -> str:
        return "、".join(str(q.get("number") or "") for q in qs)

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
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=title or "电子版试卷")
    story: list = []
    _paper_part(story, sheets, title)
    _answer_part(story, sheets)
    _summary_part(story, sheets, questions)
    doc.build(story)
    return buf.getvalue()
