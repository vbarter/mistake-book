"""把学习计划里名字取自文件名的旧作业，改成按布置日期起的名字（「11月12日作业」，同一个计划同一天有几份的带上（2）（3））。
旧版本里，布置时没起名字、只有一个文件的作业直接用了文件名当作业名，看起来像是在数文件；新布置的已经不这样了，这个脚本处理存量。
只动名字和某个作业内容文件的文件名（去掉扩展名）一模一样的作业；自己起过名字的不动。可以重复跑，改过的不会再改。
在 server/ 目录下运行：python scripts/rename_plan_assignments.py            只列出会改哪些，不写库
                      python scripts/rename_plan_assignments.py --apply    真的改
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def rename(apply: bool = False) -> list[dict]:
    from app.extensions import db
    from app.models import PlanAssignment, PlanFile
    from app.routes.plans import dated_title

    stems: dict[str, set[str]] = {}
    for f in PlanFile.query.filter(PlanFile.submission_id.is_(None)).all():
        stem = (f.name or "").rsplit(".", 1)[0][:120].strip()
        if stem:
            stems.setdefault(f.assignment_id, set()).add(stem)
    plans: dict[str, list] = {}
    for a in PlanAssignment.query.order_by(PlanAssignment.created_at, PlanAssignment.id).all():
        plans.setdefault(a.plan_id, []).append(a)
    changes = []
    for plan_id, rows in plans.items():
        todo = [a for a in rows if (a.title or "").strip() in stems.get(a.id, set())]
        taken = {a.title for a in rows if a not in todo}
        for a in todo:  # 按布置的先后排（2）（3）
            new = dated_title(a.created_at or datetime.now(), taken)
            taken.add(new)
            changes.append({"plan": plan_id, "assignment": a.id, "old": a.title, "new": new})
            if apply:
                a.title = new
    if apply:
        db.session.commit()
    return changes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的改；不带这个参数只列出来")
    args = ap.parse_args()
    from app import create_app

    with create_app().app_context():
        changes = rename(args.apply)
        for c in changes:
            print(f"{c['plan']}  {c['assignment']}  {c['old']}  ->  {c['new']}")
        print(f"{'已改' if args.apply else '会改（没写库，加 --apply 才改）'} {len(changes)} 份作业")


if __name__ == "__main__":
    main()
