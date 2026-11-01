"""试卷手写擦除：算法、接口、空白卷导出"""
import base64

import cv2
import numpy as np

from app.ai.erase import erase, split_ocr_hand
from app.ai.ocr import baidu_line_boxes


def _sheet():
    """白纸上：一行印刷黑字（横线 + 竖线组成），右边一段手写黑笔，印刷行上压一道手写斜线"""
    img = np.full((400, 600, 3), 235, np.uint8)
    for x in range(40, 300, 30):  # 印刷：一串小方块字
        cv2.rectangle(img, (x, 100), (x + 18, 124), (20, 20, 20), 2)
    cv2.line(img, (320, 124), (420, 124), (20, 20, 20), 2)  # 下划线（印刷）
    cv2.putText(img, "42", (340, 118), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (30, 30, 30), 3)  # 手写在下划线上
    cv2.line(img, (60, 95), (100, 130), (25, 25, 25), 3)  # 划在印刷字上的斜线
    cv2.line(img, (450, 250), (550, 300), (180, 60, 20), 4)  # 蓝笔
    return img


def _dark(img, box):
    x0, y0, x1, y1 = box
    return int((cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY) < 120).sum())


def test_erase_removes_handwriting_and_keeps_print():
    img = _sheet()
    W, H = 600, 400
    hand = [[335 / W, 92 / H, 410 / W, 122 / H], [55 / W, 90 / H, 105 / W, 135 / H], [440 / W, 240 / H, 560 / W, 310 / H]]
    printed = [[35 / W, 96 / H, 305 / W, 128 / H]]
    out, mask = erase(img, hand, printed)
    assert _dark(out, (335, 92, 410, 120)) == 0  # 下划线上的答案擦掉了
    assert _dark(out, (320, 122, 420, 127)) > 100  # 下划线还在
    assert _dark(out, (130, 98, 300, 128)) == _dark(img, (130, 98, 300, 128))  # 没被框到的印刷字一点没动
    assert _dark(out, (40, 98, 70, 128)) > 0  # 印刷行保护：斜线下面的印刷字留着
    blue = cv2.cvtColor(out[240:310, 440:560], cv2.COLOR_BGR2HSV)[..., 1]
    assert (blue > 70).sum() == 0  # 蓝笔擦掉了
    assert mask.any()


def test_split_ocr_hand_treats_wide_lines_as_print():
    keep, wrong = split_ocr_hand([[0.1, 0.1, 0.13, 0.15], [0.1, 0.4, 0.9, 0.43]], aspect=1.0)
    assert keep == [[0.1, 0.1, 0.13, 0.15]] and wrong == [[0.1, 0.4, 0.9, 0.43]]


def test_baidu_line_boxes_splits_print_and_hand():
    r = {"results": [
        {"words_type": "print", "words": {"word": "1. 计算", "words_location": {"left": 10, "top": 20, "width": 100, "height": 20}}},
        {"words_type": "handwriting", "words": {"word": "A", "words_location": {"left": 200, "top": 20, "width": 20, "height": 30}}},
        {"words": {"word": "坏的"}},
    ]}
    out = baidu_line_boxes(r, (1000, 500))
    assert out["print"] == [[0.01, 0.04, 0.11, 0.08]]
    assert out["hand"] == [[0.2, 0.04, 0.22, 0.1]]


def _jpeg_url(img):
    ok, buf = cv2.imencode(".jpg", img)
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def test_erase_page_api(client, auth):
    r = client.post("/api/erase/page", json={"image": _jpeg_url(_sheet())}, headers=auth)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["image"].startswith("data:image/jpeg;base64,")
    assert body["located"] == ["ai"]  # 测试里是 Mock：定位成功但没找到框；百度没配置
    assert "warning" not in body
    out = cv2.imdecode(np.frombuffer(base64.b64decode(body["image"].split(",", 1)[1]), np.uint8), cv2.IMREAD_COLOR)
    assert out.shape == (400, 600, 3)


def test_erase_page_rejects_bad_input(client, auth):
    assert client.post("/api/erase/page", json={}, headers=auth).status_code == 400
    assert client.post("/api/erase/page", json={"image": "data:image/jpeg;base64,AAAA"}, headers=auth).status_code == 400
    assert client.post("/api/erase/page", json={"image": _jpeg_url(_sheet())}).status_code == 401


def test_blank_export(client, auth):
    tall = np.full((800, 600, 3), 240, np.uint8)
    wide = np.full((600, 800, 3), 240, np.uint8)
    r = client.post("/api/exports", json={"kind": "blank", "title": "嘉定二模 空白卷", "images": [_jpeg_url(tall), _jpeg_url(wide)]}, headers=auth)
    assert r.status_code == 200, r.get_json()
    job = r.get_json()
    assert job["status"] == "done" and job["pages"] == 2 and job["kind"] == "blank"
    pdf = client.get(f"/api/exports/{job['id']}/file", headers=auth)
    assert pdf.data.startswith(b"%PDF")
    assert client.post("/api/exports", json={"kind": "blank", "images": []}, headers=auth).status_code == 400
