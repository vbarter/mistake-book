"""今天作业计划：拆作业 / 加入清单 / 一键排提醒时间 / 到点自动开始 / 顺延 / 接着上一项 / 计时操作 / 学习计划对上 / 合并与注销。"""
from datetime import datetime, timedelta

import pytest

from app.extensions import db
from app.models import HomeworkItem
from app.homework_parse import same_homework, split_text

DAY = "2026-11-13"


@pytest.fixture(autouse=True)
def _ctx(app):
    with app.app_context():
        yield


class Clock:
    def __init__(self, app, at: str):
        self.now = datetime.fromisoformat(f"{DAY}T{at}")
        app.config["HOMEWORK_NOW"] = lambda: self.now

    def set(self, at: str):
        self.now = datetime.fromisoformat(f"{DAY}T{at}")

    def tick(self, **kw):
        self.now += timedelta(**kw)


def _login(client, phone, nickname=None):
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    body = {"phone": phone, "code": r.get_json()["devCode"]}
    if nickname:
        body["profile"] = {"nickname": nickname}
    r = client.post("/api/auth/register", json=body)
    return {"Authorization": f"Bearer {r.get_json()['token']}"}, r.get_json()["user"]["id"]


def _add(client, h, items):
    r = client.post("/api/homework/items", json={"day": DAY, "items": items}, headers=h)
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _get(client, h):
    return client.get(f"/api/homework?day={DAY}", headers=h).get_json()


def _by(day, title):
    return next(it for it in day["items"] if it["title"] == title)


def test_split_text_by_subject_heads():
    items = split_text("周五英语：\n1.订签校默\n2.U5-6拓学单\n3.复习U4-U6\n语文：1.写自己“鼻子一酸”的经历，200字左右")
    assert [(i["title"], i["subject"]) for i in items] == [
        ("订签校默", "english"), ("U5-6拓学单", "english"), ("复习U4-U6", "english"), ("写自己“鼻子一酸”的经历，200字左右", "chinese"),
    ]
    assert items[3]["est"] == 30
    assert [i["title"] for i in split_text("写周记，再做练习部分第13课")] == ["写周记", "做练习部分第13课"]
    assert [i["subject"] for i in split_text("M：1.观看空中课堂\n2.拓学本")] == ["math", "math"]


def test_same_homework():
    assert same_homework("U5-6 拓学单", "U5-6拓学单")
    assert same_homework("第三单元练习", "数学第三单元练习")
    assert not same_homework("背单词", "复习 U4-U6")


def test_parse_endpoint(client):
    h, _ = _login(client, "13800000001")
    r = client.post("/api/homework/parse", json={"text": "英语：1.订签校默 2.U5-6拓学单", "day": DAY}, headers=h)
    assert r.status_code == 200
    body = r.get_json()
    assert [i["title"] for i in body["items"]] == ["订签校默", "U5-6拓学单"]
    assert body["planDue"] == []
    assert client.post("/api/homework/parse", json={}, headers=h).status_code == 400


def test_parse_falls_back_to_rules_when_ai_fails(client, monkeypatch):
    """大模型额度不足等失败时：打了字的用规则拆，只有照片的才报错"""
    from app.ai import AIError, get_provider

    provider = get_provider()

    def boom(text, images):
        raise AIError("AI 服务额度不足或无权限，请联系管理员充值")

    monkeypatch.setattr(provider, "parse_homework", boom)
    h, _ = _login(client, "13800000011")
    r = client.post("/api/homework/parse", json={"text": "数学：1.口算第 23 页 2.练习册", "day": DAY}, headers=h)
    assert r.status_code == 200
    assert [i["title"] for i in r.get_json()["items"]] == ["口算第 23 页", "练习册"]
    png = "data:image/png;base64,iVBORw0KGgo="
    r = client.post("/api/homework/parse", json={"images": [png], "day": DAY}, headers=h)
    assert r.status_code == 502 and "打字" in r.get_json()["message"]


def test_add_schedule_and_auto_start(app, client):
    clock = Clock(app, "18:40")
    h, _ = _login(client, "13800000002")
    day = _add(client, h, [
        {"title": "订签校默", "subject": "english", "est": 10},
        {"title": "U5-6 拓学单", "subject": "english", "est": 25},
        {"title": "写作", "subject": "chinese", "est": 30},
    ])
    assert [it["status"] for it in day["items"]] == ["todo"] * 3
    day = client.post("/api/homework/schedule", json={"day": DAY, "from": "18:45"}, headers=h).get_json()
    assert [it["remindAt"] for it in day["items"]] == ["18:45", "18:55", "19:20"]
    assert day["summary"]["nextId"] == day["items"][0]["id"] and day["summary"]["nextAt"] == "18:45"

    # 18:47 打开：第一项 18:45 已经自动开始，已用 2 分钟
    clock.set("18:47")
    day = _get(client, h)
    first = day["items"][0]
    assert first["status"] == "running" and first["autoStarted"] and first["used"] == 120
    assert day["summary"]["currentId"] == first["id"]

    # 做到 19:00 才做完：第二项 18:55 到点时第一项还在计时，不打断，标「已过」，第一项做完后从 19:00 开始
    clock.set("18:58")
    day = _get(client, h)
    assert _by(day, "U5-6 拓学单")["status"] == "todo" and _by(day, "U5-6 拓学单")["late"]
    clock.set("19:00")
    day = client.post(f"/api/homework/items/{first['id']}/finish", headers=h).get_json()
    assert _by(day, "订签校默")["status"] == "done" and _by(day, "订签校默")["used"] == 15 * 60
    second = _by(day, "U5-6 拓学单")
    assert second["status"] == "running" and second["startedAt"].endswith("19:00:00") and second["used"] == 0


def test_chain_starts_after_previous(app, client):
    clock = Clock(app, "18:00")
    h, _ = _login(client, "13800000003")
    day = _add(client, h, [{"title": "口算", "remindAt": "18:10"}, {"title": "背古诗", "chain": True}])
    a, b = day["items"]
    assert b["chain"] and b["remindAt"] is None
    clock.set("18:30")
    day = client.post(f"/api/homework/items/{a['id']}/finish", headers=h).get_json()
    assert _by(day, "背古诗")["status"] == "running"
    assert _by(day, "背古诗")["startedAt"].endswith("18:30:00")


def test_manual_start_pause_resume_snooze_skip(app, client):
    clock = Clock(app, "18:00")
    h, _ = _login(client, "13800000004")
    day = _add(client, h, [{"title": "周练 5", "remindAt": "19:00"}, {"title": "听读", "remindAt": "19:30"}])
    a, b = (it["id"] for it in day["items"])

    day = client.post(f"/api/homework/items/{a}/start", headers=h).get_json()  # 不想等，现在就开始
    assert _by(day, "周练 5")["status"] == "running" and not _by(day, "周练 5")["autoStarted"]
    clock.tick(minutes=5)
    day = client.post(f"/api/homework/items/{a}/pause", headers=h).get_json()
    assert _by(day, "周练 5")["status"] == "paused" and _by(day, "周练 5")["used"] == 300
    clock.tick(minutes=30)  # 暂停期间不计时；也不会把别的项拉起来
    assert _by(_get(client, h), "周练 5")["used"] == 300
    day = client.post(f"/api/homework/items/{a}/resume", headers=h).get_json()
    clock.tick(minutes=1)
    assert _by(_get(client, h), "周练 5")["used"] == 360

    # 先跳过：停表、已用时间留着、排到最后、不再自动开始
    day = client.post(f"/api/homework/items/{a}/skip", headers=h).get_json()
    skipped = _by(day, "周练 5")
    assert skipped["status"] == "todo" and skipped["used"] == 360 and skipped["remindAt"] is None
    assert day["items"][-1]["id"] == a

    # 到点了，晚 10 分钟再开始：停表清零，提醒时间改到 10 分钟后
    clock.set("19:31")
    assert _by(_get(client, h), "听读")["status"] == "running"
    day = client.post(f"/api/homework/items/{b}/snooze", headers=h).get_json()
    assert _by(day, "听读")["status"] == "todo" and _by(day, "听读")["remindAt"] == "19:41" and _by(day, "听读")["used"] == 0
    clock.set("19:42")
    assert _by(_get(client, h), "听读")["status"] == "running"


def test_start_another_stops_current(app, client):
    Clock(app, "18:00")
    h, _ = _login(client, "13800000005")
    day = _add(client, h, [{"title": "甲项作业"}, {"title": "乙项作业"}])
    a, b = (it["id"] for it in day["items"])
    client.post(f"/api/homework/items/{a}/start", headers=h)
    day = client.post(f"/api/homework/items/{b}/start", headers=h).get_json()
    assert _by(day, "甲项作业")["status"] == "todo" and _by(day, "乙项作业")["status"] == "running"


def test_edit_and_delete(app, client):
    Clock(app, "18:00")
    h, _ = _login(client, "13800000006")
    other, _ = _login(client, "13800000007")
    day = _add(client, h, [{"title": "拓学本 第 42 页", "subject": "math"}])
    item = day["items"][0]["id"]
    day = client.patch(f"/api/homework/items/{item}", json={"title": "拓学本 第 42-43 页", "subject": "math", "remindAt": "20:25"}, headers=h).get_json()
    assert day["items"][0]["title"] == "拓学本 第 42-43 页" and day["items"][0]["remindAt"] == "20:25"
    assert client.patch(f"/api/homework/items/{item}", json={"remindAt": "25:00"}, headers=h).status_code == 400
    assert client.patch(f"/api/homework/items/{item}", json={"subject": "art"}, headers=h).status_code == 400
    # 小程序没有 PATCH，用 PUT 改
    put = client.put(f"/api/homework/items/{item}", json={"chain": True}, headers=h).get_json()["items"][0]
    assert put["chain"] is True and put["remindAt"] is None
    assert client.delete(f"/api/homework/items/{item}", headers=other).status_code == 404
    day = client.delete(f"/api/homework/items/{item}", headers=h).get_json()
    assert day["items"] == []


def test_all_done_summary(app, client):
    clock = Clock(app, "18:45")
    h, _ = _login(client, "13800000008")
    day = _add(client, h, [{"title": "订签校默", "est": 10, "remindAt": "18:45"}])
    item = day["items"][0]["id"]
    assert _get(client, h)["items"][0]["status"] == "running"
    clock.tick(minutes=9)
    day = client.post(f"/api/homework/items/{item}/finish", headers=h).get_json()
    s = day["summary"]
    assert s["allDone"] and s["done"] == 1 and s["used"] == 540 and s["startedAt"].endswith("18:45:00")


def test_photos(app, client):
    Clock(app, "18:00")
    h, _ = _login(client, "13800000009")
    item = _add(client, h, [{"title": "U6 单元卷"}])["items"][0]["id"]
    r = client.post(f"/api/homework/items/{item}/photos", json={"count": 2}, headers=h)
    assert r.status_code == 201
    uploads = r.get_json()["uploads"]
    assert client.put(uploads[0]["url"], data=b"\xff\xd8jpeg", headers=uploads[0]["headers"]).status_code in (200, 201, 204)
    day = client.post(f"/api/homework/items/{item}/photos/uploaded", json={"ids": [u["id"] for u in uploads]}, headers=h).get_json()
    assert day["items"][0]["photoCount"] == 1 and len(day["items"][0]["photos"]) == 1


def test_plan_assignment_matched(app, client):
    Clock(app, "18:00")
    teacher, _ = _login(client, "13800000010", "李老师")
    kid, _ = _login(client, "13800000011")
    due = f"{DAY}T20:00:00"
    body = {"name": "英语周末班", "dueAt": due, "title": "U5-6 拓学单", "files": [{"clientId": "c1", "kind": "scan", "name": "1.jpg", "mime": "image/jpeg", "size": 10}]}
    created = client.post("/api/plans", json=body, headers=teacher).get_json()
    assert client.post("/api/plans/join", json={"code": created["invite"]["code"]}, headers=kid).status_code == 200
    more = {"title": "第三单元练习", "dueAt": f"{DAY}T21:00:00", "files": [{"clientId": "c2", "kind": "scan", "name": "2.jpg", "mime": "image/jpeg", "size": 10}]}
    assert client.post(f"/api/plans/{created['plan']['id']}/assignments", json=more, headers=teacher).status_code == 201
    later = {**more, "title": "下周的卷子", "dueAt": "2026-11-20T21:00:00"}
    assert client.post(f"/api/plans/{created['plan']['id']}/assignments", json=later, headers=teacher).status_code == 201
    r = client.post("/api/homework/parse", json={"text": "英语：1.订签校默 2.U5-6拓学单", "day": DAY}, headers=kid).get_json()
    hit = next(i for i in r["items"] if i["title"] == "U5-6拓学单")
    assert hit.get("planAssignmentId") == created["assignment"]["id"] and hit["teacher"] == "李老师"
    # 今天要交、但文字里没有的列出来；下周的不列
    assert [d["title"] for d in r["planDue"]] == ["第三单元练习"]
    # 加进清单后不再重复列：只剩还没加的那份
    _add(client, kid, [{"title": "第三单元练习", "planAssignmentId": r["planDue"][0]["assignmentId"], "source": "plan"}])
    r = client.post("/api/homework/parse", json={"text": "复习", "day": DAY}, headers=kid).get_json()
    assert [d["title"] for d in r["planDue"]] == ["U5-6 拓学单"]


def test_merge_and_delete_account(app, client):
    Clock(app, "18:00")
    h, uid = _login(client, "13800000012")
    _add(client, h, [{"title": "背 U6 单词"}])
    assert HomeworkItem.query.filter_by(user_id=uid).count() == 1
    assert client.delete("/api/auth/me", headers=h).status_code == 200
    assert HomeworkItem.query.filter_by(user_id=uid).count() == 0
