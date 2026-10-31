"""知识图谱：从 cn-math-taxonomy 精简来的知识点表（data/taxonomy.json），给错题标注固定的知识点 id。

数据由 scripts/build_taxonomy.py 生成，启动后第一次用到时加载进内存。来源与许可见 data/TAXONOMY_NOTICE.md。

年级：图谱的高中 grade 是「册」不是学年（数学 10 必修一、11 必修二、12–14 选必；英语 10–16；物理 10–15），
所以候选池按**学段**取（小学 1–6、初中 7–9、高中 10 以上），不按年级精确过滤；初中按学生年级 ±1 排前面。
上海初中是五四制，六年级学的是图谱里七年级的内容，按学段取正好避开这个错位。
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from functools import lru_cache
from pathlib import Path

from flask import current_app, has_app_context

log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
TAXONOMY_PATH = DATA_DIR / "taxonomy.json"
ALIASES_PATH = DATA_DIR / "taxonomy_aliases.json"
EXTRA_PATH = DATA_DIR / "taxonomy_extra.json"  # 知错本自己补的知识点（如上海英语考纲大类），id 用 zcb_ 前缀

# 图谱覆盖的学科（知错本的 subject 枚举）；化学、生物、地理没有图谱，维持自由文本知识点
_lock = threading.Lock()
_loaded: dict | None = None

# 章节字段末尾的小节号（「九上 第二十一章 一元二次方程 21.1」「… 2.2.2」）去掉，只留到章
_SECTION_RE = re.compile(r"\s+\d+(\.\d+)*\s*$")


def enabled() -> bool:
    """自动标注开关：.env 里 TAXONOMY_TAGGING=1。数据文件不存在时视为关闭。"""
    on = current_app.config.get("TAXONOMY_TAGGING") if has_app_context() else os.getenv("TAXONOMY_TAGGING", "0") == "1"
    return bool(on) and TAXONOMY_PATH.exists()


def _load() -> dict:
    global _loaded
    if _loaded is not None:
        return _loaded
    with _lock:
        if _loaded is not None:
            return _loaded
        if not TAXONOMY_PATH.exists():
            _loaded = {"meta": {}, "topics": {}, "prereqs": {}, "idAliases": {}, "aliases": {}}
            return _loaded
        raw = json.loads(TAXONOMY_PATH.read_text("utf-8"))
        topics = {t["id"]: t for t in raw.get("topics", [])}
        if EXTRA_PATH.exists():
            for t in json.loads(EXTRA_PATH.read_text("utf-8")).get("topics", []):
                if t.get("id") and t.get("name") and t.get("subject") and t["id"] not in topics:
                    topics[t["id"]] = {"semester": "", **t, "extra": True}
        prereqs: dict[str, list[str]] = {}
        for tid, pid in raw.get("prereqs", []):
            if tid in topics and pid in topics:
                prereqs.setdefault(tid, []).append(pid)
        aliases: dict[str, dict[str, str]] = {}
        if ALIASES_PATH.exists():
            for subject, table in json.loads(ALIASES_PATH.read_text("utf-8")).items():
                if isinstance(table, dict):
                    aliases[subject] = {k: v for k, v in table.items() if v in topics}
        _loaded = {"meta": raw.get("meta", {}), "topics": topics, "prereqs": prereqs, "idAliases": raw.get("idAliases", {}), "aliases": aliases}
        log.info("taxonomy loaded: %d topics, commit %s", len(topics), _loaded["meta"].get("commit"))
        return _loaded


def reset() -> None:
    """测试用：下次访问重新读文件。"""
    global _loaded
    _loaded = None
    subjects.cache_clear()


def meta() -> dict:
    return _load()["meta"]


@lru_cache(maxsize=1)
def subjects() -> frozenset[str]:
    """图谱覆盖的学科。"""
    return frozenset(t["subject"] for t in _load()["topics"].values())


def stage_of(grade: int | str | None) -> str:
    """小学 primary（1–6）、初中 junior（7–9）、高中 senior（10 以上）；判断不了按初中。"""
    try:
        g = int(grade)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "junior"
    if g <= 6:
        return "primary"
    if g <= 9:
        return "junior"
    return "senior"


def chapter_title(topic: dict) -> str:
    """章节去掉末尾小节号：「九上 第二十一章 一元二次方程 21.1」→「九上 第二十一章 一元二次方程」。"""
    return _SECTION_RE.sub("", topic.get("chapter") or "").strip()


def view(topic_id: str) -> dict | None:
    """给客户端和落库用的精简结构。旧 id 按 idAliases 换成代表知识点。"""
    data = _load()
    t = data["topics"].get(topic_id)
    if t is None:
        targets = data["idAliases"].get(topic_id) or []
        t = data["topics"].get(targets[0]) if targets else None
    if t is None:
        return None
    return {"id": t["id"], "name": t["name"], "subject": t["subject"], "domain": t.get("domain", ""), "grade": t["grade"], "chapter": chapter_title(t)}


def get(topic_id: str) -> dict | None:
    return _load()["topics"].get(topic_id)


def candidates(subject: str, grade: int | str | None) -> list[dict]:
    """某学科、某学段的候选知识点：学生年级 ±1 的排前面，其余按年级、id 排。没有该学科返回空。"""
    stage = stage_of(grade)
    try:
        g = int(grade)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        g = {"primary": 5, "junior": 8, "senior": 10}[stage]
    pool = [t for t in _load()["topics"].values() if t["subject"] == subject
            and (stage in t["stages"] if t.get("extra") else stage_of(t["grade"]) == stage)]
    # 高中 grade 是册次，不按距离排
    if stage == "senior":
        return sorted(pool, key=lambda t: (t["grade"], t["id"]))
    return sorted(pool, key=lambda t: (abs(t["grade"] - g) > 1, t["grade"], t["id"]))


def resolve_alias(subject: str, name: str) -> str | None:
    """上海版说法 → 图谱 id（精确匹配别名表）。"""
    return _load()["aliases"].get(subject, {}).get((name or "").strip())


def prerequisites(topic_id: str, depth: int = 2) -> list[dict]:
    """沿 hard 先修边向上取 depth 层，按离得近的在前；不含自己，不重复。"""
    data = _load()
    seen: set[str] = {topic_id}
    frontier = [topic_id]
    out: list[dict] = []
    for _ in range(max(depth, 0)):
        nxt: list[str] = []
        for tid in frontier:
            for pid in data["prereqs"].get(tid, []):
                if pid not in seen:
                    seen.add(pid)
                    nxt.append(pid)
                    v = view(pid)
                    if v:
                        out.append(v)
        frontier = nxt
        if not frontier:
            break
    return out
