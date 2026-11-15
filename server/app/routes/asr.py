"""语音输入：POST /api/asr {audio: base64 或 dataURL, format?: "mp3"} → {text}

小程序按住话筒录音（60 秒以内），松手把音频传上来，转给腾讯云一句话识别，返回文字。
音频不落盘、不保存。
"""
from __future__ import annotations

import base64
import binascii

from flask import Blueprint, abort, jsonify, request

from .. import asr
from ..auth_utils import login_required

bp = Blueprint("asr", __name__)


@bp.post("/asr")
@login_required
def recognize():
    if not asr.configured():
        abort(503, description="语音识别还没开通，先打字吧")
    data = request.get_json(silent=True) or {}
    raw = str(data.get("audio") or "")
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    fmt = str(data.get("format") or "mp3").lower()
    if fmt not in asr.FORMATS:
        abort(400, description="不支持的音频格式")
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        abort(400, description="音频数据不对")
    if not blob:
        abort(400, description="没有录到声音")
    if len(blob) > asr.MAX_BYTES:
        abort(413, description="说得太长了，一次 60 秒以内")
    try:
        text = asr.recognize(base64.b64encode(blob).decode("ascii"), len(blob), fmt)
    except asr.ASRError as e:
        abort(502, description=str(e))
    return jsonify({"text": text})
