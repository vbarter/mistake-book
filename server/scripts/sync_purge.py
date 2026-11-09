"""清理云同步的删除标记：删除超过 N 天（默认 30）的文件夹 / 试卷 / 照片记录彻底删掉，照片文件一起从对象存储删掉。
删除标记留一段时间，是为了让很久没打开的设备下次同步时也知道这些东西删了。
在 server/ 目录下运行（可放进 crontab 每天跑一次）：python scripts/sync_purge.py [--days 30] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def purge(days: int, dry_run: bool = False) -> dict:
    from app import storage
    from app.extensions import db
    from app.models import SyncFolder, SyncPage, SyncPaper

    cutoff = datetime.now() - timedelta(days=days)
    counts = {}
    pages = SyncPage.query.filter(SyncPage.deleted.is_(True), SyncPage.server_updated_at < cutoff).all()
    if pages and not dry_run:
        storage.get_storage().delete([storage.object_key(p.owner_id, p.id, kind) for p in pages for kind in storage.KINDS])
    counts["pages"] = len(pages)
    for model, key in ((SyncPaper, "papers"), (SyncFolder, "folders")):
        q = model.query.filter(model.deleted.is_(True), model.server_updated_at < cutoff)
        counts[key] = q.count()
        if not dry_run:
            q.delete(synchronize_session=False)
    if not dry_run:
        for p in pages:
            db.session.delete(p)
        db.session.commit()
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    from app import create_app

    with create_app().app_context():
        print(purge(args.days, args.dry_run))


if __name__ == "__main__":
    main()
