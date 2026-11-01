"""试卷手写擦除：只改照片里「手写框」内的笔迹像素，印刷文字尽量不动。

做法（方案见 reports/试卷一键擦除方案.md，第一版用「框内擦除 + 印刷保护」）：
1. 手写框来自两处：大模型（claude.locate_marks，找得全）和百度 OCR 的手写行（ocr.line_boxes，顺带给出印刷行框）。
   百度偶尔把整行印刷标成手写，太宽太扁的「手写行」按印刷算。
2. 框内比纸面暗的像素算笔迹；落在印刷行框里的不擦（宁可留一道划线，也不擦掉印刷字），长横线（下划线、表格线）不擦。
3. 框附近的蓝笔、红笔按颜色擦（在印刷行里也擦：印刷是黑的）。
4. 擦掉的像素填「纸面」：把所有墨迹挖掉，在 1/4 分辨率上 inpaint 出纸色再放大，带着原照片的光照明暗，填回去看不出补丁。

坐标一律是相对整张照片的 0–1：[x0, y0, x1, y1]。
"""
from __future__ import annotations

import cv2
import numpy as np

DARK_DELTA = 38  # 比纸面暗多少（灰度）算墨迹
BOX_PAD = 4  # 手写框外扩像素，笔画边缘常常压在框外一点
PRINT_SHRINK = 2  # 印刷行框内缩像素，框边上贴着的笔迹照样擦
HLINE_MIN = 60  # 横向连续这么长的深色算下划线 / 表格线，不擦


class EraseError(Exception):
    """照片解不开之类，message 面向用户。"""


def decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise EraseError("照片解不开，换一张试试")
    return img


def encode(img: np.ndarray, quality: int = 88) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise EraseError("擦除结果保存失败")
    return buf.tobytes()


def _rough_paper(img: np.ndarray) -> np.ndarray:
    """粗估纸色：闭运算抹掉笔画再取中值，只用来判断哪些像素是墨迹"""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    return cv2.medianBlur(cv2.morphologyEx(img, cv2.MORPH_CLOSE, k), 21)


def _dark(img: np.ndarray, paper: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
    p = cv2.cvtColor(paper, cv2.COLOR_BGR2GRAY).astype(np.int16)
    return ((p - g) > DARK_DELTA).astype(np.uint8) * 255


def _colored(img: np.ndarray) -> np.ndarray:
    """蓝笔、红笔：饱和度够、又不太暗（太暗的像素色相不可靠，印刷黑字在暗处会有假饱和度）"""
    h, s, v = cv2.split(cv2.cvtColor(img, cv2.COLOR_BGR2HSV))
    ink = (s > 70) & (v > 80)
    blue = ink & (h > 95) & (h < 135)
    red = ink & ((h < 12) | (h > 165))
    return cv2.dilate((blue | red).astype(np.uint8) * 255, np.ones((5, 5), np.uint8))


def _paper(img: np.ndarray, ink: np.ndarray) -> np.ndarray:
    """纸面重建：挖掉墨迹，1/4 分辨率上 inpaint 补纸色再放大"""
    h, w = img.shape[:2]
    sw, sh = max(1, w // 4), max(1, h // 4)
    small = cv2.resize(img, (sw, sh), interpolation=cv2.INTER_AREA)
    holes = cv2.resize(cv2.dilate(ink, np.ones((7, 7), np.uint8)), (sw, sh), interpolation=cv2.INTER_AREA)
    holes = cv2.dilate((holes > 0).astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
    fill = cv2.inpaint(small, holes, 6, cv2.INPAINT_TELEA)
    return cv2.GaussianBlur(cv2.resize(fill, (w, h), interpolation=cv2.INTER_CUBIC), (0, 0), 2)


def _rects(boxes: list, w: int, h: int, pad: int) -> np.ndarray:
    mask = np.zeros((h, w), np.uint8)
    for b in boxes or []:
        try:
            x0, y0, x1, y1 = (float(v) for v in b)
        except (TypeError, ValueError):
            continue
        if x1 <= x0 or y1 <= y0:
            continue
        X0, Y0 = int(x0 * w) - pad, int(y0 * h) - pad
        X1, Y1 = int(np.ceil(x1 * w)) + pad, int(np.ceil(y1 * h)) + pad
        if X1 > X0 and Y1 > Y0:
            mask[max(0, Y0) : max(0, Y1), max(0, X0) : max(0, X1)] = 255
    return mask


def split_ocr_hand(hand: list, aspect: float) -> tuple[list, list]:
    """百度的手写行里挑出「其实是印刷」的：又宽又扁（宽 > 8 倍高）的一整行。返回 (手写, 误标的印刷)。aspect = 照片宽 / 高"""
    keep, wrong = [], []
    for b in hand or []:
        bw, bh = (b[2] - b[0]) * aspect, (b[3] - b[1])
        (wrong if bh > 0 and bw > 8 * bh else keep).append(b)
    return keep, wrong


def erase(img: np.ndarray, hand_boxes: list, print_boxes: list | None = None) -> tuple[np.ndarray, np.ndarray]:
    """擦掉手写框里的笔迹，返回 (擦后照片, 擦掉的像素掩膜)。"""
    h, w = img.shape[:2]
    dark = _dark(img, _rough_paper(img))
    colored = _colored(img)
    region = _rects(hand_boxes, w, h, BOX_PAD)
    hlines = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (HLINE_MIN, 1)))

    ink = cv2.bitwise_and(region, dark)
    ink[hlines > 0] = 0
    if print_boxes:
        ink[_rects(print_boxes, w, h, -PRINT_SHRINK) > 0] = 0
    ink = cv2.dilate(ink, np.ones((5, 5), np.uint8))
    # 彩色笔迹只在框附近擦，免得把照片边上的桌布、书皮擦花
    near = cv2.dilate(region, np.ones((15, 15), np.uint8))
    ink = cv2.bitwise_or(ink, cv2.bitwise_and(colored, near))

    paper = _paper(img, cv2.bitwise_or(dark, colored))
    out = img.copy()
    sel = ink > 0
    out[sel] = paper[sel]
    return out, ink


def erase_jpeg(data: bytes, hand_boxes: list, print_boxes: list | None = None) -> bytes:
    img = decode(data)
    out, _ = erase(img, hand_boxes, print_boxes)
    return encode(out)
