"""学生年级与「解法不超纲」：

- resolve：这张卷子按几年级讲。优先级：试卷标题 / 卷头印的年级 > App 里用户自己设的年级 > 大模型按题目判断的大致年级。
- method_rules：按学段写给大模型的解法要求（小学用算术方法、初中不用高中方法……），讲解、阅卷、补答、变式题共用。
- check_methods：生成后的规则检查，找出越过年级的写法（小学设未知数列方程、∵∴，初中用导数向量……），越界的讲解重写一次。
"""
from __future__ import annotations

import re

from .. import taxonomy

_CN = "一二三四五六七八九"


def to_int(grade) -> int | None:
    """「5」/ 5 → 5；空、非法、超出 1–12 → None。"""
    try:
        g = int(str(grade).strip())
    except (TypeError, ValueError):
        return None
    return g if 1 <= g <= 12 else None


def label(grade) -> str:
    """1–9 说「五年级」，10–12 说「高一」到「高三」；认不出返回空。"""
    g = to_int(grade)
    if g is None:
        return ""
    if g >= 10:
        return f"高{_CN[g - 10]}"
    return f"{_CN[g - 1]}年级"


def resolve(sheets, profile_grade="") -> tuple[int | None, str]:
    """这批卷面按几年级讲，返回 (年级, 来源)。来源：paper 卷面 / profile 用户设置 / guess 模型判断 / "" 不知道。"""
    for s in sheets:
        g = taxonomy.parse_grade(getattr(s, "examGrade", ""), getattr(s, "region", ""))
        if g:
            return g, "paper"
    g = to_int(profile_grade)
    if g:
        return g, "profile"
    guesses = [g for s in sheets if (g := to_int(getattr(s, "guessedGrade", "")))]
    if guesses:
        return max(set(guesses), key=guesses.count), "guess"
    return None, ""


_SOURCE = {"paper": "试卷上印的年级", "profile": "家长在 App 里设置的年级", "guess": "按题目内容判断的大致年级"}

_COMMON = (
    "解法只能用学生这个年级及以前学过的知识和方法，按这个年级课本和老师上课的讲法写，让学生能看懂、考试能照着写；"
    "不要因为高年级方法更快就用高年级方法。"
)

_RULES = {
    "primary_low": (
        "小学一到四年级：只用算术方法——直接列算式、画图或线段图、列表、假设法、倒推、找规律；"
        "不要用字母表示未知数，不要列方程；每步用「先算……」「再算……」说清算的是什么量，再写算式；"
        "不用「∵」「∴」这类符号，推理用「因为……所以……」的文字。"
    ),
    "primary_high": (
        "小学五六年级：优先用算术方法——列分步算式或综合算式、画线段图、假设法、抓住倍数或差的关系"
        "（如「小数点向右移动两位，新数是原数的 100 倍，比原数多 99 倍，原数 = 增加量 ÷ 99」），每步说清算的是什么量；"
        "只有算术方法明显绕（多步倒推、等量关系复杂）时才用简易方程，写成「解：设……为 x」，"
        "按「等式两边同时加、减、乘、除以同一个数（0 除外），等式仍然成立」来解，"
        "不要说「移项」「合并同类项」「系数化为 1」，不列二元方程组；"
        "不用「∵」「∴」这类符号，推理用「因为……所以……」的文字；不用负数运算、函数、勾股定理等初中内容。"
    ),
    "junior": (
        "初中：可以用方程（组）、不等式、函数、几何证明和「∵ ……，∴ ……」规范书写，但只用学生所在年级为止学过的内容"
        "（如七年级还没学一元二次方程、勾股定理和二次函数，八年级还没学二次函数和相似三角形）；"
        "不用高中方法：导数、向量、正弦定理、余弦定理、三角恒等变换、数列公式、空间直角坐标系；"
        "物理不用微积分和矢量分解公式，化学不用物质的量（mol）。"
    ),
    "senior": (
        "高中：按高中课本的方法写，只用学生所在年级为止学过的内容；不用大学方法（洛必达法则、泰勒展开、偏导数、矩阵、微分方程）。"
    ),
}


def band(grade) -> str:
    g = to_int(grade)
    if g is None:
        return ""
    if g <= 4:
        return "primary_low"
    if g <= 6:
        return "primary_high"
    if g <= 9:
        return "junior"
    return "senior"


def method_rules(grade) -> str:
    """写给大模型的解法要求；年级不知道时让它按题目所在学段最基础的方法讲。"""
    b = band(grade)
    if not b:
        return "解法要求：年级不确定，先按题目内容判断这是几年级的题，再用那个年级课本里最基础、最常用的方法讲，小学题不要设未知数列方程。"
    return f"解法要求：{_COMMON}{_RULES[b]}"


def grade_note(grade, source: str = "") -> str:
    """放进用户消息里的一段：学生年级（及来源）+ 解法要求。"""
    name = label(grade)
    head = f"学生年级：{name}（{_SOURCE[source]}）。" if name and source in _SOURCE else (f"学生年级：{name}。" if name else "学生年级：不确定。")
    return head + method_rules(grade)


# 越界写法：(学段, 正则, 说明)。只查讲解的文字，按学段从低到高越来越宽。
_X = r"[a-zA-Z]"
_CHECKS: dict[str, list[tuple[re.Pattern, str]]] = {
    "primary_low": [
        (re.compile(rf"设[^，。,；;：:]{{0,16}}为\s*\$?\s*{_X}\b|设\s*\$?\s*{_X}\s*\$?\s*[为是=]|列方程|解方程|方程"), "设未知数列方程"),
    ],
    "primary_high": [
        (re.compile(r"方程组|二元一次"), "列二元方程组"),
    ],
    "primary": [
        (re.compile(r"[∵∴]|\\because|\\therefore"), "用了「∵」「∴」符号"),
        (re.compile(r"移项|合并同类项|系数化为"), "用了初中解方程的说法（移项、合并同类项）"),
        (re.compile(r"勾股定理|函数|[xy]\s*\^\s*\{?2|[xy]²"), "用了初中内容（函数、勾股定理、平方未知数）"),
    ],
    "junior": [
        (re.compile(r"导数|求导|f'\(|f\^\{?\\prime|\\int|定积分|不定积分|微积分|微分"), "用了导数 / 微积分"),
        (re.compile(r"向量|\\vec|\\overrightarrow"), "用了向量"),
        (re.compile(r"正弦定理|余弦定理"), "用了正弦 / 余弦定理"),
        (re.compile(r"物质的量|\bmol\b|摩尔"), "用了物质的量（mol）"),
    ],
    "senior": [
        (re.compile(r"洛必达|泰勒|偏导|矩阵|微分方程"), "用了大学方法"),
    ],
}


def check_methods(grade, text: str) -> list[str]:
    """讲解文字里越过年级的写法，返回说明列表；没有越界或年级不知道返回空。"""
    b = band(grade)
    if not b or not text:
        return []
    groups = {
        "primary_low": ["primary_low", "primary_high", "primary", "junior", "senior"],
        "primary_high": ["primary_high", "primary", "junior", "senior"],
        "junior": ["junior", "senior"],
        "senior": ["senior"],
    }[b]
    out: list[str] = []
    for gname in groups:
        for pat, why in _CHECKS[gname]:
            if pat.search(text) and why not in out:
                out.append(why)
    return out


def explanation_text(r: dict) -> str:
    """explain 一条结果里要检查的文字：思路、解答步骤、技巧（知识点和易错不查，可能正常提到「不能用方程」之类）。"""
    steps = r.get("steps") if isinstance(r.get("steps"), list) else []
    return "\n".join(str(x or "") for x in [r.get("thinking"), *steps, r.get("technique")])
