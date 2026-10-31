"""试卷 / 题目指纹：客户端据此判断「这份试卷扫过了」「这道题在别的试卷里错过」。

只看印刷内容，不看学生作答，所以同一份卷子空白时扫、做完再扫、重拍一遍，指纹都一样。
- qKey：规范化题干（去空位、去题号、全角转半角、去空白标点）+ 学科 + 题型的哈希，相同即同一题
- qSim：题干字符 3-gram 的 64 位 SimHash（16 位十六进制），给识别差一两个字的模糊匹配用
- qNums：题干里的数字（排序后用逗号连），模糊匹配时必须相同，避免「3+5」和「3+6」被当成同一题；
  短文里的空在前面加「#空号」，同一篇短文的不同空不会互相匹配
- textSim：整个卷面印刷文字的 SimHash，判断「是不是同一页」
"""
from __future__ import annotations

import hashlib
import re

from .base import DigitizedPage, DigitizedQuestion

_SUBSUP = str.maketrans("₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹", "01234567890123456789")
_BLANKS = re.compile(r"\[\[[^\[\]]{1,24}\]\]|\(\d+\)_{2,}|_{2,}|□")
_LEAD_NUMBER = re.compile(r"^\s*[（(]?\s*\d{1,3}\s*[)）.．、]\s*")
_KEEP = re.compile(r"[^0-9a-z\u4e00-\u9fff+\-*/=<>^%°√π∠△⊥∥≈≠≤≥]")
_NUMS = re.compile(r"\d+(?:\.\d+)?")


def normalize(text: str) -> str:
    """印刷文字规范化：去空位和看不清的字，LaTeX 写法统一，全角转半角，只留字母数字汉字和常见运算符。"""
    s = _BLANKS.sub("", text or "")
    s = _LEAD_NUMBER.sub("", s)
    s = re.sub(r"\\d?frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", s.replace("$", ""))
    s = re.sub(r"\\(left|right|mathrm|text|displaystyle|times|cdot)", lambda m: "*" if m.group(1) in ("times", "cdot") else "", s)
    s = s.replace("{", "").replace("}", "").translate(_SUBSUP)
    s = "".join(chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c for c in s).lower()
    return _KEEP.sub("", s)


def simhash(text: str, n: int = 3) -> str:
    """字符 n-gram 的 64 位 SimHash，返回 16 位十六进制；文字太短时返回空串。"""
    if len(text) < n:
        return ""
    weights = [0] * 64
    for gram in {text[i : i + n] for i in range(len(text) - n + 1)}:
        h = int.from_bytes(hashlib.md5(gram.encode("utf-8")).digest()[:8], "big")
        for bit in range(64):
            weights[bit] += 1 if h >> bit & 1 else -1
    value = sum(1 << bit for bit in range(64) if weights[bit] > 0)
    return f"{value:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1") if a and b else 64


def question_print(q: DigitizedQuestion, passage: bool) -> tuple[str, str, str]:
    text = normalize(" ".join([q.stemText, *q.options]))
    nums = sorted(_NUMS.findall(text))
    tag = f"#{q.number}" if passage else ""
    qnums = ",".join(([tag] if tag else []) + nums)
    if len(text) < 4:  # 只有一个空、没有题干（「36. ____」）：认不出是哪题，不给指纹
        return "", "", qnums
    key = hashlib.sha1(f"{q.subject}|{q.questionType}|{text}|{tag}".encode("utf-8")).hexdigest()[:16]
    return key, simhash(text), qnums


def sheet_text(sheet: DigitizedPage) -> str:
    parts: list[str] = []
    for blk in sheet.blocks:
        if blk.type == "figure":
            continue
        parts += [blk.title, blk.instruction, blk.text, blk.hint, *blk.options]
    return normalize(" ".join(parts))


def add_prints(questions: list[DigitizedQuestion], sheets: list[DigitizedPage]) -> None:
    """给题目和卷面补上指纹（原地修改）。"""
    for sheet in sheets:
        sheet.textSim = simhash(sheet_text(sheet))
    for q in questions:
        blk = sheets[q.sheet].blocks[q.blockIndex] if 0 <= q.sheet < len(sheets) and 0 <= q.blockIndex < len(sheets[q.sheet].blocks) else None
        q.qKey, q.qSim, q.qNums = question_print(q, passage=bool(blk and blk.type == "passage"))
