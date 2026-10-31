#!/usr/bin/env python3
"""把 cn-math-taxonomy 的知识图谱精简成知错本用的 app/data/taxonomy.json。

用法（源仓库是本机克隆，锁定某个提交后再跑）：

    TAXONOMY_SRC=~/dev/cn-math-taxonomy python3 scripts/build_taxonomy.py

只保留标注用得到的字段：知识点的 id、名称、学科、领域、年级、学期、章节；先修关系只保留 hard 边；
题库、掌握标准、诊断题都不要。源仓库的 id-aliases.json（旧 id → 新 id）一并带上，图谱改 id 时用来迁移旧数据。
输出文件头写明来源、提交号和许可（CC BY-NC 4.0），见 app/data/TAXONOMY_NOTICE.md。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "taxonomy.json"

# 图谱的 subject → 知错本的 subject（constants.SUBJECTS）。图谱里数学没有 subject 字段。
SUBJECT_MAP = {
    None: "math",
    "": "math",
    "math": "math",
    "chinese": "chinese",
    "english": "english",
    "science": "science",
    "morality": "politics",
    "history": "history",
    "physics": "physics",
}


def git_commit(src: Path) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(src), "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def main() -> int:
    src = Path(os.environ.get("TAXONOMY_SRC", "")).expanduser()
    if not src or not (src / "data" / "topics.json").exists():
        print("请用 TAXONOMY_SRC 指向 cn-math-taxonomy 的本机目录（要有 data/topics.json）", file=sys.stderr)
        return 2
    topics_raw = json.loads((src / "data" / "topics.json").read_text("utf-8"))
    deps_raw = json.loads((src / "data" / "dependencies.json").read_text("utf-8"))
    aliases_path = src / "data" / "id-aliases.json"
    aliases_raw = json.loads(aliases_path.read_text("utf-8")) if aliases_path.exists() else {}

    topics = []
    ids: set[str] = set()
    for t in topics_raw:
        if t.get("external"):
            continue
        subject = SUBJECT_MAP.get(t.get("subject"))
        if not subject:
            print(f"跳过未知学科 {t.get('subject')!r}: {t.get('id')}", file=sys.stderr)
            continue
        try:
            grade = int(t["grade"])
        except (KeyError, TypeError, ValueError):
            print(f"跳过没有年级的知识点 {t.get('id')}", file=sys.stderr)
            continue
        topics.append({
            "id": t["id"],
            "name": str(t.get("name") or "").strip(),
            "subject": subject,
            "domain": str(t.get("domain") or "").strip(),
            "grade": grade,
            "semester": str(t.get("semester") or "").strip(),
            "chapter": str(t.get("chapter") or "").strip(),
        })
        ids.add(t["id"])
    topics.sort(key=lambda x: (x["subject"], x["grade"], x["id"]))

    prereqs = sorted(
        {(d["topicId"], d["prerequisiteId"]) for d in deps_raw
         if d.get("strength") == "hard" and d.get("topicId") in ids and d.get("prerequisiteId") in ids}
    )

    # 旧 id → 代表知识点（只保留还存在的目标）
    id_aliases = {}
    for old, info in (aliases_raw.get("aliases") or {}).items():
        targets = [x for x in (info.get("targets") or []) if x in ids]
        if targets:
            id_aliases[old] = targets

    out = {
        "meta": {
            "source": "https://github.com/xiaoyang111222/cn-math-taxonomy",
            "commit": git_commit(src),
            "license": "CC BY-NC 4.0",
            "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "topics": len(topics),
            "prereqs": len(prereqs),
        },
        "topics": topics,
        "prereqs": [list(p) for p in prereqs],
        "idAliases": id_aliases,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    by_subject: dict[str, int] = {}
    for t in topics:
        by_subject[t["subject"]] = by_subject.get(t["subject"], 0) + 1
    print(f"写入 {OUT}（{OUT.stat().st_size // 1024} KB）：{len(topics)} 个知识点，{len(prereqs)} 条 hard 先修边，提交 {out['meta']['commit']}")
    print("按学科：" + "，".join(f"{k} {v}" for k, v in sorted(by_subject.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
