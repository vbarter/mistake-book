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


def test_erase_job_runs_in_background(client, auth, app):
    pages = [_jpeg_url(_sheet()), _jpeg_url(_sheet())]
    r = client.post("/api/erase/jobs", json={"pages": pages}, headers=auth)
    assert r.status_code == 200, r.get_json()  # 测试里同步跑完
    job = r.get_json()
    assert job["status"] == "done" and job["totalPages"] == 2 and job["donePages"] == 2
    assert [p["status"] for p in job["pages"]] == ["done", "done"]
    assert job["warning"] == ""
    again = client.get(f"/api/erase/jobs/{job['id']}", headers=auth).get_json()
    assert again["status"] == "done"
    img = client.get(f"/api/erase/jobs/{job['id']}/pages/1", headers=auth)
    assert img.status_code == 200 and img.mimetype == "image/jpeg"
    out = cv2.imdecode(np.frombuffer(img.data, np.uint8), cv2.IMREAD_COLOR)
    assert out.shape == (400, 600, 3)
    assert client.get(f"/api/erase/jobs/{job['id']}/pages/5", headers=auth).status_code == 404


def test_erase_job_is_private_and_validated(client, auth):
    job = client.post("/api/erase/jobs", json={"pages": [_jpeg_url(_sheet())]}, headers=auth).get_json()
    r = client.post("/api/auth/code", json={"phone": "13800000001", "purpose": "register"})
    code = r.get_json()["devCode"]
    other = client.post("/api/auth/register", json={"phone": "13800000001", "code": code, "profile": {"nickname": "小林", "grade": "5"}}).get_json()["token"]
    h2 = {"Authorization": f"Bearer {other}"}
    assert client.get(f"/api/erase/jobs/{job['id']}", headers=h2).status_code == 404
    assert client.get(f"/api/erase/jobs/{job['id']}/pages/0", headers=h2).status_code == 404
    assert client.post("/api/erase/jobs", json={"pages": []}, headers=auth).status_code == 400
    assert client.post("/api/erase/jobs", json={"pages": ["not-an-image"]}, headers=auth).status_code == 400


def test_erase_job_page_failure_is_reported(client, auth):
    bad = "data:image/jpeg;base64," + base64.b64encode(b"not a jpeg").decode()
    job = client.post("/api/erase/jobs", json={"pages": [_jpeg_url(_sheet()), bad]}, headers=auth).get_json()
    assert job["status"] == "done"  # 有一张成功就算完成
    assert [p["status"] for p in job["pages"]] == ["done", "failed"]
    all_bad = client.post("/api/erase/jobs", json={"pages": [bad]}, headers=auth).get_json()
    assert all_bad["status"] == "failed" and all_bad["error"]


def _clean_sheet() -> dict:
    return {
        "page": 0, "title": "嘉定区中考英语二模卷", "label": "第1页", "score": "92",
        "blocks": [
            {"type": "section", "label": "Ⅳ", "title": "Grammar", "instruction": "选择最恰当的答案"},
            {"type": "item", "number": "21", "text": "She [[21]] to school every day.", "options": ["go", "goes", "went", "going"],
             "blanks": [{"id": "21", "number": "21", "student": "STUDENTWROTE", "mark": "wrong", "answer": "goes", "note": "扣2分"}]},
            {"type": "figure", "bbox": [0.1, 0.5, 0.6, 0.8], "title": "图1", "text": "一个三角形"},
        ],
    }


def test_clean_export_prints_only_the_original_questions(client, auth):
    import io

    from pypdf import PdfReader

    tall = np.full((300, 400, 3), 240, np.uint8)
    sheet = _clean_sheet()
    sheet["blocks"][2]["image"] = _jpeg_url(tall)
    body = {"kind": "clean", "title": "嘉定二模 空白卷", "papers": [{"title": "嘉定二模", "pages": [sheet]}]}
    r = client.post("/api/exports", json=body, headers=auth)
    assert r.status_code == 200, r.get_json()
    job = r.get_json()
    assert job["status"] == "done" and job["kind"] == "clean"
    pdf = client.get(f"/api/exports/{job['id']}/file", headers=auth).data
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "to school every day" in text and "goes" in text  # 题干和选项都在
    assert "STUDENTWROTE" not in text and "92" not in text and "扣2分" not in text  # 作答、得分、批改都不印
    # 没有题目的请求照旧拒绝
    assert client.post("/api/exports", json={"kind": "clean", "papers": []}, headers=auth).status_code == 400
