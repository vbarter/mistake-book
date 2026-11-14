"""今天作业计划：把一段文字拆成一项一项作业、猜学科、估用时。

大模型（ClaudeProvider.parse_homework）拆照片和文字；这里是不调模型时的规则版本，也给模型的结果兜底：
学科不认识的归到 other，用时没给或不合理的按关键词估。
"""
from __future__ import annotations

import re
import unicodedata

from .constants import SUBJECTS

HOMEWORK_SUBJECTS = [*SUBJECTS, "other"]
MAX_ITEMS = 30
MAX_TITLE = 60

# 学科抬头：「英语：」「周五英语：」「M：」「数学作业:」
_HEADS = [
    ("chinese", r"语文|语|C"),
    ("math", r"数学|数|M"),
    ("english", r"英语|英|E"),
    ("science", r"科学"),
    ("physics", r"物理"),
    ("chemistry", r"化学"),
    ("biology", r"生物"),
    ("history", r"历史"),
    ("geography", r"地理"),
    ("politics", r"道法|道德与法治|政治"),
]
_HEAD_RE = re.compile(r"^\s*(?:周[一二三四五六日天]|今天|今日|明天)?\s*(" + "|".join(p for _, p in _HEADS) + r")\s*(?:作业)?\s*[:：]\s*", re.I)

# 没有抬头时按内容猜学科
_HINTS = [
    ("english", r"英语|单词|课文|听读|默写U|U\d|Unit|M\dU\d|拓学单|校默|背诵.*(?:单词|句型)|[A-Za-z]{4,}"),
    ("math", r"数学|口算|计算|应用题|练习册|几何|方程|周练|单元练习|拓学本|空中课堂"),
    ("chinese", r"语文|作文|周记|日记|古诗|生字|词语|阅读|默写|字左右|练习部分|课文|预习"),
    ("physics", r"物理"),
    ("chemistry", r"化学"),
    ("biology", r"生物"),
    ("history", r"历史"),
    ("geography", r"地理"),
    ("politics", r"道法|道德与法治|政治"),
    ("science", r"科学"),
]

# 用时估计（分钟）：先匹配到的为准
_EST = [
    (r"作文|周记|日记|\d{3}\s*字", 30),
    (r"卷|试卷|单元练习|周练|测验|拓学单", 25),
    (r"复习|订正", 20),
    (r"练习|练习册|习题|口算|计算|拓学本|第\s*\d+\s*[-–~至]\s*\d+\s*页", 20),
    (r"空中课堂|网课|视频|观看", 15),
    (r"背|默写|听读|朗读|读|签|订签|校默", 10),
    (r"预习", 15),
]

_NUM_SPLIT = re.compile(r"(?:^|\s|[；;。])\s*(?=\d{1,2}\s*[\.、．)）]\s*\S)")
_AND_SPLIT = re.compile(r"\s*(?:[，,]\s*(?:再|然后|还有|还要|另外)|[；;]|，?还有)\s*")  # 「写周记，再做练习部分」一句里的两件事
_NUM_PREFIX = re.compile(r"^\s*(?:\d{1,2}|[一二三四五六七八九十]{1,2})\s*[\.、．)）]\s*")


def subject_of(head: str) -> str | None:
    for subject, pattern in _HEADS:
        if re.fullmatch(pattern, head, re.I):
            return subject
    return None


def guess_subject(title: str, fallback: str = "other") -> str:
    for subject, pattern in _HINTS:
        if re.search(pattern, title, re.I):
            return subject
    return fallback


def estimate(title: str) -> int:
    for pattern, minutes in _EST:
        if re.search(pattern, title, re.I):
            return minutes
    return 20


def clean_title(text: str) -> str:
    text = _NUM_PREFIX.sub("", text.strip())
    text = re.sub(r"^(?:再|然后|还要|还有|另外)", "", text)
    text = re.sub(r"\s+", " ", text).strip(" ，,；;。")
    return text[:MAX_TITLE]


def split_text(text: str) -> list[dict]:
    """「周五英语：1.订签校默 2.U5-6拓学单 语文：1.写…」→ [{title, subject, est}]，学科跟着最近的抬头走"""
    items: list[dict] = []
    current: str | None = None
    for raw_line in re.split(r"[\r\n]+", text or ""):
        line = raw_line.strip()
        while line:
            m = _HEAD_RE.match(line)
            if m:
                current = subject_of(m.group(1)) or current
                line = line[m.end():]
                continue
            # 一行里可能还有下一个学科抬头（「…200字左右 数学：1.…」），切开分别处理
            nxt = None
            for hm in re.finditer(r"(?:^|[\s；;。])((?:" + "|".join(p for _, p in _HEADS[:2] + _HEADS[2:]) + r")\s*(?:作业)?\s*[:：])", line):
                if hm.start(1) > 0:
                    nxt = hm.start(1)
                    break
            chunk, line = (line[:nxt], line[nxt:]) if nxt else (line, "")
            parts = [q for part in _NUM_SPLIT.split(chunk) for q in _AND_SPLIT.split(part)]
            for part in parts:
                title = clean_title(part)
                if len(title) < 2:
                    continue
                subject = current or guess_subject(title)
                items.append({"title": title, "subject": subject, "est": estimate(title)})
                if len(items) >= MAX_ITEMS:
                    return items
    return items


def normalize(items: list, fallback_text: str = "") -> list[dict]:
    """模型给的结果清理一遍：去空、截长、学科不认识的按内容再猜、用时不合理的按关键词估"""
    out: list[dict] = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        title = clean_title(str(it.get("title") or ""))
        if len(title) < 2:
            continue
        subject = str(it.get("subject") or "")
        if subject not in HOMEWORK_SUBJECTS:
            subject = guess_subject(title)
        try:
            est = int(it.get("est") or it.get("minutes") or 0)
        except (TypeError, ValueError):
            est = 0
        if not 3 <= est <= 180:
            est = estimate(title)
        out.append({"title": title, "subject": subject, "est": est})
        if len(out) >= MAX_ITEMS:
            break
    if not out and fallback_text:
        return split_text(fallback_text)
    return out


def _norm_name(s: str) -> str:
    return re.sub(r"[\s\-–_·.,，。:：、()（）《》“”\"']+", "", s or "").lower()


def dup_key(title: str) -> str:
    """判重用的写法：全角半角统一、去掉开头的编号、空格和标点、大小写。两项这个一样就算同一项作业（只认完全一样，「复习」和「复习 U4」不算）"""
    return _norm_name(clean_title(unicodedata.normalize("NFKC", title or "")))


def same_homework(a: str, b: str) -> bool:
    """作业名对不对得上：去掉空格标点后一方包含另一方，且重合部分至少 3 个字"""
    x, y = _norm_name(a), _norm_name(b)
    if len(x) < 3 or len(y) < 3:
        return x == y and bool(x)
    return x in y or y in x
