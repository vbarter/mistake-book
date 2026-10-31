"""后台导出：错题本 / 电子试卷 PDF 提交后在服务器后台排版，App 关掉、切走都不影响；
生成好的文件放在 UPLOAD_DIR/exports/，「我的导出」里可以随时再下载，保留 7 天。

和 /digitize/book、/digitize/pdf 收同样的请求体，只是不在这次请求里等 PDF 排完。
"""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import datetime, timedelta

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from ..auth_utils import current_user, login_required
from ..extensions import db
from ..models import ExportJob
from ..pdf import build_book_pdf, build_papers_pdf
from ..usage import track
from .recognize import book_args, paper_args, pdf_error_message

bp = Blueprint("exports", __name__)
log = logging.getLogger(__name__)

KEEP_FOR = timedelta(days=7)
KEEP_LATEST = 30  # 每人最多留这么多份，更早的连文件一起删
STALE_AFTER = timedelta(minutes=10)  # 排版中超过 10 分钟没动静（服务重启），按失败报
_slots = threading.Semaphore(2)  # 同时最多排两本，别把识别任务挤住


def _dir() -> str:
    path = os.path.join(current_app.config["UPLOAD_DIR"], "exports")
    os.makedirs(path, exist_ok=True)
    return path


def _file(job: ExportJob) -> str:
    return os.path.join(_dir(), f"{job.id}.pdf")


def _remove(job: ExportJob) -> None:
    try:
        os.remove(_file(job))
    except FileNotFoundError:
        pass
    db.session.delete(job)


def _cleanup(user_id: str) -> None:
    """删掉 7 天前的，以及超出每人份数的旧导出（文件一起删）。"""
    cutoff = datetime.now() - KEEP_FOR
    for job in ExportJob.query.filter(ExportJob.created_at < cutoff).all():
        _remove(job)
    for job in ExportJob.query.filter_by(user_id=user_id).order_by(ExportJob.created_at.desc()).offset(KEEP_LATEST).all():
        _remove(job)
    db.session.commit()


def delete_user_exports(user_id: str) -> None:
    """注销账号时连同导出文件一起删。"""
    for job in ExportJob.query.filter_by(user_id=user_id).all():
        _remove(job)


def _run(app, job_id: str, kind: str, args: tuple) -> None:
    with app.app_context():
        with _slots:
            job = db.session.get(ExportJob, job_id)
            if not job:
                return
            job.status = "running"
            db.session.commit()
            try:
                pdf = build_book_pdf(*args) if kind == "book" else build_papers_pdf(*args)
                with open(_file(job), "wb") as f:
                    f.write(pdf)
                job = db.session.get(ExportJob, job_id)
                job.status, job.size, job.pages = "done", len(pdf), len(re.findall(rb"/Type\s*/Page\b", pdf))
                db.session.commit()
            except Exception as e:  # noqa: BLE001
                log.exception("export job %s failed", job_id)
                db.session.rollback()
                job = db.session.get(ExportJob, job_id)
                if job:
                    job.status, job.error = "failed", pdf_error_message("错题本" if kind == "book" else "电子试卷", e)
                    db.session.commit()
            finally:
                db.session.remove()


def _view(job: ExportJob) -> dict:
    if job.status in ("queued", "running") and job.updated_at and datetime.now() - job.updated_at > STALE_AFTER:
        job.status, job.error = "failed", "服务刚刚重启，这次导出没有完成，请重新导出"
        db.session.commit()
    return job.to_dict()


@bp.post("/exports")
@login_required
def create_export():
    """提交导出：kind = book（错题本，请求体同 /digitize/book）| paper（电子试卷，同 /digitize/pdf）。立刻返回任务，后台排版。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    kind = str(data.get("kind") or "book")
    if kind == "book":
        title, subtitle, items = book_args(data)
        args: tuple = (title, subtitle, items)
        detail = subtitle
        track(user, "book", questions=len(items))
    elif kind == "paper":
        title, papers = paper_args(data)
        args = (title, papers)
        detail = f"{len(papers)} 张试卷"
        track(user, "pdf")
    else:
        abort(400, "不支持的导出类型")
    _cleanup(user.id)
    job = ExportJob(user_id=user.id, kind=kind, title=(title or "电子试卷")[:120], detail=detail[:160], status="queued")
    db.session.add(job)
    db.session.commit()
    job_id = job.id
    app = current_app._get_current_object()  # noqa: SLF001
    if current_app.config.get("TESTING") or current_app.config.get("DIGITIZE_SYNC"):
        _run(app, job_id, kind, args)
        db.session.expire_all()  # 排版在另一个会话里写的库，这里重新读
    else:
        threading.Thread(target=_run, args=(app, job_id, kind, args), name=f"export-{job_id[:8]}", daemon=True).start()
    job = db.session.get(ExportJob, job_id)
    return jsonify(_view(job)), 202 if job.status in ("queued", "running") else 200


@bp.get("/exports")
@login_required
def list_exports():
    """我的导出：最近 7 天，新的在前。"""
    user = current_user()
    jobs = ExportJob.query.filter_by(user_id=user.id).filter(ExportJob.created_at >= datetime.now() - KEEP_FOR).order_by(ExportJob.created_at.desc()).limit(KEEP_LATEST).all()
    return jsonify({"items": [_view(j) for j in jobs]})


def _own(job_id: str) -> ExportJob:
    job = db.session.get(ExportJob, job_id)
    if not job or job.user_id != current_user().id:
        abort(404, "这份导出不存在或已过期")
    return job


@bp.get("/exports/<job_id>")
@login_required
def get_export(job_id: str):
    return jsonify(_view(_own(job_id)))


@bp.get("/exports/<job_id>/file")
@login_required
def export_file(job_id: str):
    job = _own(job_id)
    path = _file(job)
    if job.status != "done" or not os.path.exists(path):
        abort(404, "文件还没生成好或已过期")
    return send_file(path, mimetype="application/pdf", as_attachment=True, download_name=f"{job.id}.pdf")


@bp.delete("/exports/<job_id>")
@login_required
def delete_export(job_id: str):
    _remove(_own(job_id))
    db.session.commit()
    return jsonify({"ok": True})
