"""试卷手写擦除。

后台任务（App 1.9 起用这个）：
POST /api/erase/jobs  {pages: [照片 dataURL, ...]}  → 202 任务（立刻返回，擦除在服务器后台跑，切 App、杀 App 都不影响）
GET  /api/erase/jobs/<id>                          → 状态、进度、每张照片好了没
GET  /api/erase/jobs/<id>/pages/<序号>              → 擦好的照片（JPEG），保留一天

一次一张（1.8.9 的客户端在用，保留）：
POST /api/erase/page  {image: dataURL}
  → {image: 擦后 dataURL, marks: 擦了几处, located: ["ai", "ocr"] 里用上的定位方式, warning?: 定位失败时的提示}

每张照片手写定位两路并行：大模型（全局识别队列里排队，和扫描共用并发上限）+ 百度 OCR 逐行框（配置了才调）。
两路都失败时只按颜色擦蓝笔、红笔，并提示黑色笔迹可能没擦干净。
"""
from __future__ import annotations

import base64
import logging
import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from ..ai import AIError, Crop, get_provider
from ..ai import ocr
from ..ai import queue as page_queue
from ..ai.erase import EraseError, decode, encode, erase, split_ocr_hand
from ..auth_utils import current_user, login_required
from ..extensions import db
from ..models import EraseJob
from ..usage import track
from .recognize import _decode

bp = Blueprint("erase", __name__)
log = logging.getLogger(__name__)

_ocr_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="erase-ocr")
MAX_BYTES = 12 * 1024 * 1024
MAX_PAGES = 30
PAGES_AT_ONCE = 3  # 一个任务里同时擦几张（大模型调用还要在全局队列里排队）
KEEP_FOR = timedelta(days=1)
STALE_AFTER = timedelta(minutes=10)
NO_AI_WARNING = "手写定位没成功，只擦了彩色笔迹，黑色笔迹可能没擦干净，可以稍后重新擦除"


def erase_photo(raw: bytes, media: str) -> tuple[bytes, dict]:
    """擦一张照片：两路定位 + 本地擦除。返回 (擦后 JPEG, {marks, located, erasedPixels, warning?})。照片解不开抛 EraseError。"""
    img = decode(raw)
    provider = get_provider()
    ai_future = page_queue.submit(lambda: provider.locate_marks(Crop(data=raw, media_type=media)))
    ocr_future = _ocr_pool.submit(ocr.line_boxes, raw)

    located: list[str] = []
    hand: list = []
    printed: list = []
    try:
        hand += ai_future.result(timeout=180)
        located.append("ai")
    except AIError as e:
        log.warning("erase: locate_marks failed: %s", e)
    except Exception:  # noqa: BLE001
        log.exception("erase: locate_marks crashed")
    try:
        lines = ocr_future.result(timeout=90)
        if lines is not None:
            h, w = img.shape[:2]
            ocr_hand, wrong = split_ocr_hand(lines.get("hand") or [], w / max(1, h))
            hand += ocr_hand
            printed = (lines.get("print") or []) + wrong
            located.append("ocr")
    except Exception as e:  # noqa: BLE001  OCR 只是辅助，失败了照样擦
        log.warning("erase: ocr line boxes failed: %s", e)

    out, mask = erase(img, hand, printed)
    info: dict = {"marks": len(hand), "located": located, "erasedPixels": int((mask > 0).sum())}
    if "ai" not in located:
        info["warning"] = NO_AI_WARNING
    return encode(out), info


@bp.post("/erase/page")
@login_required
def erase_page():
    user = current_user()
    data = request.get_json(silent=True) or {}
    image = data.get("image")
    if not isinstance(image, str) or not image.startswith("data:image"):
        abort(400, "缺少照片")
    raw, media = _decode(image)
    if len(raw) > MAX_BYTES:
        abort(400, "照片太大了")
    try:
        out, info = erase_photo(raw, media)
    except EraseError as e:
        abort(400, str(e))
    track(user, "erase", pages=1)
    return jsonify({"image": "data:image/jpeg;base64," + base64.b64encode(out).decode(), **info})


# ---------------------------------------------------------------- 后台任务


def _dir(job_id: str) -> str:
    return os.path.join(current_app.config["UPLOAD_DIR"], "erase", job_id)


def _cleanup() -> None:
    """删掉一天前的任务和照片"""
    cutoff = datetime.now() - KEEP_FOR
    for job in EraseJob.query.filter(EraseJob.created_at < cutoff).all():
        shutil.rmtree(_dir(job.id), ignore_errors=True)
        db.session.delete(job)
    db.session.commit()


def delete_user_erase_jobs(user_id: str) -> None:
    """注销账号时连照片一起删"""
    for job in EraseJob.query.filter_by(user_id=user_id).all():
        shutil.rmtree(_dir(job.id), ignore_errors=True)
        db.session.delete(job)


def _run(app, job_id: str, photos: list[tuple[bytes, str]]) -> None:
    with app.app_context():
        _run_here(job_id, photos)


def _run_here(job_id: str, photos: list[tuple[bytes, str]]) -> None:
    job = db.session.get(EraseJob, job_id)
    if not job:
        return
    job.status = "running"
    db.session.commit()
    folder = _dir(job_id)
    os.makedirs(folder, exist_ok=True)
    app = current_app._get_current_object()  # noqa: SLF001
    lock = threading.Lock()

    def one(i: int) -> None:
        raw, media = photos[i]
        try:
            out, info = erase_photo(raw, media)
            with open(os.path.join(folder, f"{i}.jpg"), "wb") as f:
                f.write(out)
            state = {"status": "done", "warning": info.get("warning", "")}
        except EraseError as e:
            state = {"status": "failed", "warning": str(e)}
        except Exception:  # noqa: BLE001
            log.exception("erase job %s page %s failed", job_id, i)
            state = {"status": "failed", "warning": "这张没擦成功，可以稍后重新擦除"}
        with lock, app.app_context():  # 线程池里的线程没有应用上下文
            j = db.session.get(EraseJob, job_id)
            if j:
                pages = list(j.pages_state or [])
                pages[i] = state
                j.pages_state = pages
                j.done_pages = sum(1 for p in pages if p.get("status") != "pending")
                db.session.commit()
            db.session.remove()

    if current_app.config.get("TESTING"):
        for i in range(len(photos)):
            one(i)
    else:
        with ThreadPoolExecutor(max_workers=PAGES_AT_ONCE, thread_name_prefix=f"erase-{job_id[:6]}") as pool:
            list(pool.map(one, range(len(photos))))

    db.session.expire_all()
    job = db.session.get(EraseJob, job_id)
    pages = job.pages_state or []
    ok = sum(1 for p in pages if p.get("status") == "done")
    job.status = "done" if ok else "failed"
    if not ok:
        job.error = next((p.get("warning") for p in pages if p.get("warning")), "") or "擦除没有成功，请稍后再试"
    db.session.commit()
    track(job.user_id, "erase", pages=ok)


@bp.post("/erase/jobs")
@login_required
def create_job():
    """提交一份试卷的照片，立刻返回任务；擦除在后台跑，客户端轮询 /erase/jobs/<id>。测试里同步跑完。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        abort(400, "缺少照片")
    if len(pages) > MAX_PAGES:
        abort(400, f"一次最多擦 {MAX_PAGES} 张")
    photos: list[tuple[bytes, str]] = []
    for image in pages:
        if not isinstance(image, str) or not image.startswith("data:image"):
            abort(400, "缺少照片")
        raw, media = _decode(image)
        if len(raw) > MAX_BYTES:
            abort(400, "照片太大了")
        photos.append((raw, media))

    _cleanup()
    job = EraseJob(user_id=user.id, status="queued", total_pages=len(photos), done_pages=0, pages_state=[{"status": "pending", "warning": ""} for _ in photos])
    db.session.add(job)
    db.session.commit()
    job_id = job.id
    app = current_app._get_current_object()  # noqa: SLF001
    if current_app.config.get("TESTING"):
        _run_here(job_id, photos)
        db.session.expire_all()
    else:
        threading.Thread(target=_run, args=(app, job_id, photos), name=f"erase-{job_id[:8]}", daemon=True).start()
    job = db.session.get(EraseJob, job_id)
    return jsonify(_view(job)), 202 if job.status in ("queued", "running") else 200


def _own(job_id: str) -> EraseJob:
    job = db.session.get(EraseJob, job_id)
    if not job or job.user_id != current_user().id:
        abort(404, "这次擦除已过期，请重新擦除")
    return job


def _view(job: EraseJob) -> dict:
    if job.status in ("queued", "running") and job.updated_at and datetime.now() - job.updated_at > STALE_AFTER:
        job.status, job.error = "failed", "服务刚刚重启，这次擦除没有完成，请重新擦除"
        db.session.commit()
    d = job.to_dict()
    d["queue"] = page_queue.stats()
    return d


@bp.get("/erase/jobs/<job_id>")
@login_required
def get_job(job_id: str):
    return jsonify(_view(_own(job_id)))


@bp.get("/erase/jobs/<job_id>/pages/<int:index>")
@login_required
def get_page(job_id: str, index: int):
    job = _own(job_id)
    path = os.path.join(_dir(job.id), f"{index}.jpg")
    if not os.path.exists(path):
        abort(404, "这张还没擦好")
    return send_file(path, mimetype="image/jpeg")
