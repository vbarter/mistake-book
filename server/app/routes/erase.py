"""试卷手写擦除：一次擦一张照片，客户端逐张调用、显示进度，擦好的照片存在手机上（服务器不留）。

POST /api/erase/page  {image: dataURL}
  → {image: 擦后 dataURL, marks: 擦了几处, located: ["ai", "ocr"] 里用上的定位方式, warning?: 定位失败时的提示}

手写定位两路并行：大模型（全局识别队列里排队，和扫描共用并发上限）+ 百度 OCR 逐行框（配置了才调）。
两路都失败时只按颜色擦蓝笔、红笔，并提示黑色笔迹可能没擦干净。
"""
from __future__ import annotations

import base64
import logging
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, abort, jsonify, request

from .. import usage
from ..ai import AIError, Crop, get_provider
from ..ai import ocr
from ..ai import queue as page_queue
from ..ai.erase import EraseError, decode, encode, erase, split_ocr_hand
from ..auth_utils import current_user, login_required
from .recognize import _decode

bp = Blueprint("erase", __name__)
log = logging.getLogger(__name__)

_ocr_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="erase-ocr")
MAX_BYTES = 12 * 1024 * 1024


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
        img = decode(raw)
    except EraseError as e:
        abort(400, str(e))

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
    usage.track(user, "erase", pages=1)
    body: dict = {
        "image": "data:image/jpeg;base64," + base64.b64encode(encode(out)).decode(),
        "marks": len(hand),
        "located": located,
        "erasedPixels": int((mask > 0).sum()),
    }
    if "ai" not in located:
        body["warning"] = "手写定位没成功，只擦了彩色笔迹，黑色笔迹可以用手动补擦抹掉"
    return jsonify(body)
