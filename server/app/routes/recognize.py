"""识别：接收框选后的截图（dataURL 列表），返回 AI 识别结果（不入库，由核对页确认后保存）。"""
from __future__ import annotations

import base64
import logging

from flask import Blueprint, Response, abort, current_app, jsonify, request

from ..ai import AIError, Crop, get_provider
from ..auth_utils import current_user, login_required
from ..constants import SUBJECTS
from ..pdf import build_pdf

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


@bp.post("/digitize")
@login_required
def digitize():
    """试卷数字化：整页照片 → 按原卷版面还原的电子版（sheets → blocks），并派生可收录的题目列表。"""
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

    subjects = [s for s in (user.subjects or SUBJECTS) if s in SUBJECTS] or SUBJECTS
    provider = get_provider()
    try:
        page_infos, questions = provider.digitize_pages(pages, subjects=subjects, grade=user.grade or "5")
    except AIError as e:
        return jsonify({"error": "ai_unavailable", "message": str(e)}), 502
    except Exception:  # noqa: BLE001
        log.exception("digitize failed")
        return jsonify({"error": "ai_failed", "message": "AI 还原试卷出错了，请稍后重试"}), 502

    out = []
    for i, q in enumerate(questions):
        d = q.to_dict()
        d["index"] = i
        out.append(d)
    return jsonify({"pages": [p.to_dict() for p in page_infos], "questions": out, "provider": provider.name})  # pages = sheets


@bp.post("/digitize/pdf")
@login_required
def digitize_pdf():
    """电子版试卷 → 可打印 PDF：原题干净还原 + 作答与批改对照表 + 错题汇总。前端把扫描结果原样传回。"""
    data = request.get_json(silent=True) or {}
    sheets = data.get("pages")
    questions = data.get("questions") or []
    if not isinstance(sheets, list) or not sheets or not all(isinstance(s, dict) for s in sheets):
        abort(400, "缺少电子版内容")
    if not isinstance(questions, list):
        abort(400, "题目列表格式不对")
    title = str(data.get("title") or "")[:80]
    try:
        pdf = build_pdf(title, sheets, questions)
    except Exception:  # noqa: BLE001
        log.exception("pdf failed")
        return jsonify({"error": "pdf_failed", "message": "生成 PDF 出错了，请稍后重试"}), 500
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": "attachment; filename=paper.pdf"})
