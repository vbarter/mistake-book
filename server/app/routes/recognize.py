"""识别：接收框选后的截图（dataURL 列表），返回 AI 识别结果（不入库，由核对页确认后保存）。"""
from __future__ import annotations

import base64
import logging
import threading
from datetime import datetime, timedelta

from flask import Blueprint, Response, abort, current_app, jsonify, request

from ..ai import AIError, Crop, get_provider, provider_name
from ..ai import queue as page_queue
from ..ai.digitize import derive_questions, sheets_from_dicts
from ..extensions import db
from ..usage import track
from ..models import DigitizeJob
from ..auth_utils import current_user, login_required
from ..constants import SUBJECTS
from ..pdf import build_book_pdf, build_papers_pdf

bp = Blueprint("recognize", __name__)
log = logging.getLogger(__name__)


def _decode(data_url: str) -> tuple[bytes, str]:
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        abort(400, "图片格式不正确")
    media = "image/png" if "image/png" in header else "image/jpeg"
    if "image/webp" in header:
        media = "image/webp"
    try:
        return base64.b64decode(b64), media
    except Exception:  # noqa: BLE001
        abort(400, "图片解码失败")


@bp.post("/recognize")
@login_required
def recognize():
    user = current_user()
    data = request.get_json(silent=True) or {}
    crops_raw = data.get("crops")
    if not isinstance(crops_raw, list) or not crops_raw:
        abort(400, "请先框选至少一道题")
    if len(crops_raw) > current_app.config["MAX_CROPS_PER_RECOGNIZE"]:
        abort(400, f"一次最多识别 {current_app.config['MAX_CROPS_PER_RECOGNIZE']} 道题")

    crops: list[Crop] = []
    for raw in crops_raw:
        image = raw.get("image") if isinstance(raw, dict) else raw
        if not image:
            abort(400, "缺少截图")
        blob, media = _decode(image)
        crops.append(Crop(data=blob, media_type=media, hint=str(raw.get("hint", "")) if isinstance(raw, dict) else ""))

    subjects = [s for s in (user.subjects or SUBJECTS) if s in SUBJECTS] or SUBJECTS
    provider = get_provider()
    try:
        items = provider.recognize(crops, subjects=subjects, grade=user.grade or "5")
    except AIError as e:
        return jsonify({"error": "ai_unavailable", "message": str(e)}), 502
    except Exception:  # noqa: BLE001  未知异常也给出可读提示，不返回 500 页面
        log.exception("recognize failed")
        return jsonify({"error": "ai_failed", "message": "AI 识别出错了，请稍后重试"}), 502

    # 不回传截图：客户端已持有裁剪图，按 index 对应即可（回传会让响应膨胀到 1 MB 以上）
    results = []
    for i, item in enumerate(items):
        d = item.to_dict()
        d["index"] = i
        d["aiGenerated"] = True
        results.append(d)
    return jsonify({"items": results, "provider": provider.name})


@bp.post("/scan")
@login_required
def scan():
    """整页扫描：传整页试卷（可多页），AI 找出所有错题并返回位置（bbox 归一化）与识别结果。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    pages_raw = data.get("pages")
    if not isinstance(pages_raw, list) or not pages_raw:
        abort(400, "请先选择试卷")
    if len(pages_raw) > current_app.config["MAX_PAGES_PER_SCAN"]:
        abort(400, f"一次最多扫描 {current_app.config['MAX_PAGES_PER_SCAN']} 页")

    pages: list[Crop] = []
    for raw in pages_raw:
        image = raw.get("image") if isinstance(raw, dict) else raw
        if not image:
            abort(400, "缺少试卷图片")
        blob, media = _decode(image)
        pages.append(Crop(data=blob, media_type=media))

    subjects = [s for s in (user.subjects or SUBJECTS) if s in SUBJECTS] or SUBJECTS
    provider = get_provider()
    try:
        items = provider.scan_pages(pages, subjects=subjects, grade=user.grade or "5")
    except AIError as e:
        return jsonify({"error": "ai_unavailable", "message": str(e)}), 502
    except Exception:  # noqa: BLE001
        log.exception("scan failed")
        return jsonify({"error": "ai_failed", "message": "AI 扫描出错了，请稍后重试"}), 502

    results = []
    for i, item in enumerate(items):
        d = item.to_dict()
        d["index"] = i
        d["aiGenerated"] = True
        results.append(d)
    return jsonify({"items": results, "pages": len(pages), "provider": provider.name})


# 进程内记录每个任务已拿到识别槽位的照片数、每张照片的流式完成度（不落库，和队列一样只在本进程有效）
_started_pages: dict[str, int] = {}
_page_progress: dict[str, dict[int, float]] = {}
_touched_at: dict[str, float] = {}


def _run_job(app, job_id: str, pages: list[Crop], subjects: list[str], grade: str, region: str) -> None:
    """后台线程入口：自己开应用上下文再执行。"""
    with app.app_context():
        _run_job_here(job_id, pages, subjects, grade, region)


def _run_job_here(job_id: str, pages: list[Crop], subjects: list[str], grade: str, region: str) -> None:
    """执行一个数字化任务（在当前应用上下文里）：进度按页写回数据库，完成后存结果。"""
    if True:
        job = db.session.get(DigitizeJob, job_id)
        if not job:
            return
        job.status = "running"
        db.session.commit()
        app = current_app._get_current_object()  # noqa: SLF001

        def on_page_done(done: int, total: int) -> None:
            # 多张照片并发识别时这个回调来自线程池的线程，没有应用上下文，必须自己推一个再写库
            try:
                with app.app_context():
                    j = db.session.get(DigitizeJob, job_id)
                    if j:
                        j.done_pages = done
                        db.session.commit()
            except Exception:  # noqa: BLE001
                log.exception("digitize job %s progress update failed", job_id)

        def on_page_start(started: int, total: int) -> None:
            _started_pages[job_id] = started

        def on_page_progress(index: int, fraction: float) -> None:
            _page_progress.setdefault(job_id, {})[index] = max(0.0, min(0.98, fraction))
            # 每 10 秒把 updated_at 刷新一次：整页输出可能要几分钟，别被「10 分钟没动静」误判成卡死
            import time as _t
            now = _t.time()
            if now - _touched_at.get(job_id, 0) >= 10:
                _touched_at[job_id] = now
                try:
                    with app.app_context():
                        j = db.session.get(DigitizeJob, job_id)
                        if j:
                            j.updated_at = datetime.now()
                            db.session.commit()
                except Exception:  # noqa: BLE001
                    pass

        try:
            page_infos, questions = get_provider().digitize_pages(pages, subjects=subjects, grade=grade, region=region, on_page_done=on_page_done, on_page_start=on_page_start, on_page_progress=on_page_progress)
            out = []
            for i, q in enumerate(questions):
                d = q.to_dict()
                d["index"] = i
                out.append(d)
            j = db.session.get(DigitizeJob, job_id)
            j.result = {"pages": [p.to_dict() for p in page_infos], "questions": out, "provider": provider_name()}
            j.done_pages = len(pages)
            j.status = "done"
            db.session.commit()
            track(j.user_id, "scan_done", pages=len(pages), questions=len(out), wrong=sum(1 for q in out if q.get("mark") in ("wrong", "partial", "blank")))
            _started_pages.pop(job_id, None)
            _page_progress.pop(job_id, None)
            _touched_at.pop(job_id, None)
        except AIError as e:
            j = db.session.get(DigitizeJob, job_id)
            j.status, j.error = "failed", str(e)
            db.session.commit()
            track(j.user_id, "scan_fail", pages=len(pages))
        except Exception as e:  # noqa: BLE001
            log.exception("digitize job %s failed", job_id)
            db.session.rollback()
            j = db.session.get(DigitizeJob, job_id)
            j.status, j.error = "failed", f"AI 还原试卷出错了，请稍后重试（{type(e).__name__}）"
            db.session.commit()
            track(j.user_id, "scan_fail", pages=len(pages))
            _started_pages.pop(job_id, None)
            _page_progress.pop(job_id, None)
            _touched_at.pop(job_id, None)


def _cleanup_jobs() -> None:
    """顺手清掉一天前的任务，结果不长期保留。"""
    cutoff = datetime.now() - timedelta(days=1)
    DigitizeJob.query.filter(DigitizeJob.created_at < cutoff).delete(synchronize_session=False)
    db.session.commit()


@bp.post("/digitize")
@login_required
def digitize():
    """试卷数字化：提交任务，立刻返回任务号；识别在服务器后台跑，客户端轮询 /digitize/jobs/<id> 取进度和结果。

    测试或 DIGITIZE_SYNC=1 时同步执行，返回的任务已是 done 并带 result。
    """
    user = current_user()
    data = request.get_json(silent=True) or {}
    pages_raw = data.get("pages")
    if not isinstance(pages_raw, list) or not pages_raw:
        abort(400, "请先选择试卷")
    if len(pages_raw) > current_app.config["MAX_PAGES_PER_SCAN"]:
        abort(400, f"一次最多处理 {current_app.config['MAX_PAGES_PER_SCAN']} 页")

    pages: list[Crop] = []
    for raw in pages_raw:
        image = raw.get("image") if isinstance(raw, dict) else raw
        if not image:
            abort(400, "缺少试卷图片")
        blob, media = _decode(image)
        pages.append(Crop(data=blob, media_type=media))

    subjects = list(SUBJECTS)  # 识别卷子是什么学科，不受个人资料勾选限制
    grade = user.grade or "5"
    region = str(data.get("region") or "")[:20]

    _cleanup_jobs()
    job = DigitizeJob(user_id=user.id, status="queued", total_pages=len(pages), done_pages=0)
    db.session.add(job)
    db.session.commit()
    job_id = job.id
    track(user, "scan", pages=len(pages))

    app = current_app._get_current_object()  # noqa: SLF001
    if current_app.config.get("DIGITIZE_SYNC") or current_app.config.get("TESTING"):
        _run_job_here(job_id, pages, subjects, grade, region)
    else:
        threading.Thread(target=_run_job, args=(app, job_id, pages, subjects, grade, region), name=f"digitize-{job_id[:8]}", daemon=True).start()
    job = db.session.get(DigitizeJob, job_id)
    return jsonify(_job_view(job)), 202 if job.status in ("queued", "running") else 200


def _job_view(job: DigitizeJob) -> dict:
    """任务状态 + 进程内的实时信息：已开始识别的照片数、全局队列情况。进度按「开始算一半、完成算全部」推进。"""
    d = job.to_dict()
    started = max(_started_pages.get(job.id, 0), job.done_pages or 0)
    total = max(1, job.total_pages or 1)
    if job.status in ("queued", "running"):
        done = job.done_pages or 0
        fractions = _page_progress.get(job.id, {})
        # 已完成的页算 1，进行中的页按流式输出的完成度，刚拿到槽位还没输出的算 0.05
        partial = sum(max(0.05, min(0.98, f)) for f in sorted(fractions.values(), reverse=True)[: max(0, started - done)])
        if started - done > len(fractions):
            partial += 0.05 * (started - done - len(fractions))
        d["progress"] = min(95, int(5 + 90 * (done + partial) / total))
    d["startedPages"] = started
    d["queue"] = page_queue.stats()
    return d


STALE_AFTER = timedelta(minutes=10)


@bp.get("/digitize/jobs/<job_id>")
@login_required
def digitize_job(job_id: str):
    """查任务：进度、状态，完成后带结果。服务重启导致任务卡住的，超过 10 分钟没更新按失败报。"""
    user = current_user()
    job = db.session.get(DigitizeJob, job_id)
    if not job or job.user_id != user.id:
        abort(404, "任务不存在或已过期")
    if job.status in ("queued", "running") and job.updated_at and datetime.now() - job.updated_at > STALE_AFTER:
        job.status, job.error = "failed", "服务刚刚重启，这次还原没有完成，请重新扫描"
        db.session.commit()
    return jsonify(_job_view(job))


@bp.post("/digitize/pdf")
@login_required
def digitize_pdf():
    """电子版试卷 → 可打印 PDF：原题干净还原 + 作答与批改对照表 + 错题汇总。前端把扫描结果原样传回。"""
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "")[:80]
    papers = data.get("papers")
    if papers is None:
        papers = [{"title": title, "pages": data.get("pages"), "questions": data.get("questions") or []}]
    if not isinstance(papers, list) or not papers or len(papers) > 20:
        abort(400, "缺少电子版内容")
    for paper in papers:
        sheets = paper.get("pages") if isinstance(paper, dict) else None
        if not isinstance(sheets, list) or not sheets or not all(isinstance(s, dict) for s in sheets):
            abort(400, "缺少电子版内容")
        if not isinstance(paper.get("questions", []), list):
            abort(400, "题目列表格式不对")
    track(current_user(), "pdf")
    try:
        pdf = build_papers_pdf(title, papers)
    except Exception as e:  # noqa: BLE001
        log.exception("pdf failed")
        return jsonify({"error": "pdf_failed", "message": _pdf_error_message("电子试卷", e)}), 500
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": "attachment; filename=paper.pdf"})


@bp.post("/digitize/grade")
@login_required
def digitize_grade():
    """给已经存在 App 里的电子版补做 AI 阅卷：老师没批改、学生写了作答的空交给大模型判对错，返回判完的卷面和题目。"""
    data = request.get_json(silent=True) or {}
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        abort(400, "缺少电子版内容")
    sheets = sheets_from_dicts(pages)
    provider = get_provider()
    track(current_user(), "grade")
    graded = provider.grade_unmarked(sheets) if hasattr(provider, "grade_unmarked") else 0
    questions = []
    for i, q in enumerate(derive_questions(sheets)):
        d = q.to_dict()
        d["index"] = i
        questions.append(d)
    return jsonify({"pages": [s.to_dict() for s in sheets], "questions": questions, "graded": graded})


def _pdf_error_message(what: str, e: Exception) -> str:
    """给用户看的失败原因：说清楚是哪一步、能怎么办，不说「稍后重试」（这类错误重试也一样）。"""
    if type(e).__name__ == "LayoutError":
        return f"生成{what}失败：有一道题内容太长，一页排不下。可以先按知识点或时间分开导出。"
    return f"生成{what}失败：排版时出错了，已记录下来。可以换个范围导出，或者联系我们处理。"


@bp.post("/digitize/book")
@login_required
def digitize_book():
    """错题本 PDF（横向）：左半页空白重做，右半页错题修正。items 由前端按文件夹 / 学科 / 时间范围整理好传来。"""
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not items or not all(isinstance(x, dict) for x in items):
        abort(400, "没有可导出的错题")
    if len(items) > 400:
        abort(400, "一次最多导出 400 题")
    title = str(data.get("title") or "错题本")[:80]
    subtitle = str(data.get("subtitle") or "")[:120]
    track(current_user(), "book", questions=len(items))
    try:
        pdf = build_book_pdf(title, subtitle, items)
    except Exception as e:  # noqa: BLE001
        log.exception("book pdf failed")
        return jsonify({"error": "pdf_failed", "message": _pdf_error_message("错题本", e)}), 500
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": "attachment; filename=book.pdf"})
