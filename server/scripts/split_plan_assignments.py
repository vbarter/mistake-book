"""把以前「一份作业带几个附件」的学习计划作业拆开：一个附件一份作业（和现在新布置的一样），同学才能一份一份地交。
原来那份留着它的扫描件（有的话）或第一个附件，名字、已交的作业和批阅结果都不动；其余附件各建一份新作业（待交），截止时间照抄，名字用文件名。
文件本体不动（存储路径按计划和文件 id，不含作业 id）。撤回的作业不拆。默认只打印要拆什么，加 --apply 才真的改。
在 server/ 目录下运行：python scripts/split_plan_assignments.py [--apply]
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def split(apply: bool = False) -> list[dict]:
    from app.extensions import db
    from app.models import PlanAssignment, PlanFile

    done = []
    for a in PlanAssignment.query.filter_by(revoked=False).order_by(PlanAssignment.created_at).all():
        files = PlanFile.query.filter(PlanFile.assignment_id == a.id, PlanFile.submission_id.is_(None)).order_by(PlanFile.position, PlanFile.created_at).all()
        scans = [f for f in files if f.kind == "scan"]
        attachments = [f for f in files if f.kind != "scan"]
        moved = attachments if scans else attachments[1:]  # 有扫描件：附件全部拆出去；没有：留第一个
        if not moved:
            continue
        done.append({"assignment": a.id, "plan": a.plan_id, "title": a.title, "split": [f.name for f in moved]})
        if not apply:
            continue
        for i, f in enumerate(moved, 1):
            # 排在原来那份后面（列表按创建时间倒序），和文件原来的顺序一致
            b = PlanAssignment(plan_id=a.plan_id, title=(f.name.rsplit(".", 1)[0] or a.title)[:120], due_at=a.due_at, created_at=a.created_at - timedelta(seconds=i))
            db.session.add(b)
            db.session.flush()
            f.assignment_id = b.id
            f.position = 0
    if apply:
        db.session.commit()
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    from app import create_app

    with create_app().app_context():
        rows = split(apply=args.apply)
    for r in rows:
        print(f"{r['plan']} 「{r['title']}」拆出 {len(r['split'])} 份：{'、'.join(r['split'])}")
    print(f"{'已拆' if args.apply else '将要拆（加 --apply 才会改）'} {len(rows)} 份作业")


if __name__ == "__main__":
    main()
