"""识别：接收框选后的截图（dataURL 列表），返回 AI 识别结果（不入库，由核对页确认后保存）。"""
from __future__ import annotations

import base64

from flask import Blueprint, abort, current_app, jsonify, request

from ..ai import AIError, Crop, get_provider
from ..auth_utils import current_user, login_required
from ..constants import SUBJECTS

bp = Blueprint("recognize", __name__)


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

    results = []
    for i, item in enumerate(items):
        d = item.to_dict()
        d["stemImage"] = crops_raw[i].get("image") if isinstance(crops_raw[i], dict) else crops_raw[i]
        d["aiGenerated"] = True
        results.append(d)
    return jsonify({"items": results, "provider": provider.name})
