"""学习计划：建计划 + 布置作业 / 点卡片加入 / 成员看不到名单 / 交作业 / 批阅 / 重名 / 改名联动 / 撤回 / 解散 / 合并 / 注销。"""
import pytest

from app.extensions import db
from app.models import Plan, PlanAssignment, PlanFile, PlanMember, PlanSubmission, User


@pytest.fixture(autouse=True)
def _ctx(app):
    """测试里直接查库要用"""
    with app.app_context():
        yield


def _login(client, phone, nickname=None):
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    body = {"phone": phone, "code": r.get_json()["devCode"]}
    if nickname:
        body["profile"] = {"nickname": nickname}
    r = client.post("/api/auth/register", json=body)
    return {"Authorization": f"Bearer {r.get_json()['token']}"}, r.get_json()["user"]["id"]


SCAN = {"clientId": "c1", "kind": "scan", "name": "第 1 页.jpg", "mime": "image/jpeg", "size": 10}
PDF = {"clientId": "c2", "kind": "attachment", "name": "第三单元练习.pdf", "mime": "application/pdf", "size": 10}
RESULTS = [
    {"n": "1", "m": "correct", "s": "7", "a": "7", "t": "3+4=?", "k": "加法"},
    {"n": "2", "m": "wrong", "s": "10", "a": "12", "t": "3×4=?", "k": "乘法"},
    {"n": "3", "m": "blank", "t": "12÷4=?", "k": "除法"},
]


def _create(client, teacher, **over):
    body = {"name": "五年级数学", "subject": "math", "dueAt": "2099-01-01T20:00:00", "files": [SCAN], **over}
    r = client.post("/api/plans", json=body, headers=teacher)
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _upload(client, headers, uploads, data=b"x" * 10):
    for u in uploads:
        assert client.put(u["url"], data=data, headers=u["headers"]).status_code == 200
    r = client.post("/api/plans/files/uploaded", json={"ids": [u["id"] for u in uploads]}, headers=headers).get_json()
    assert r["missing"] == []


def _join(client, headers, code):
    r = client.post("/api/plans/join", json={"code": code}, headers=headers)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _submit(client, headers, aid, results=RESULTS):
    r = client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [SCAN]}, headers=headers)
    assert r.status_code == 201, r.get_json()
    out = r.get_json()
    _upload(client, headers, out["uploads"])
    sid = out["submission"]["id"]
    if results is not None:
        assert client.put(f"/api/plans/submissions/{sid}/results", json={"results": results}, headers=headers).status_code == 200
    return sid


def test_create_plan_with_first_assignment(client, auth):
    out = _create(client, auth, files=[SCAN, {**SCAN, "clientId": "c2", "name": "第 2 页.jpg"}])
    assert out["plan"]["role"] == "owner" and out["plan"]["subject"] == "math"
    assert len(out["assignments"]) == 1  # 扫描件是同一份卷子的几页，合成一份
    assert [u["clientId"] for u in out["uploads"]] == ["c1", "c2"]
    assert f"/api/plans/j/{out['invite']['code']}?a={out['assignment']['id']}" in out["invite"]["url"]

    # 文件传上去之前拿不到下载链接
    a = client.get(f"/api/plans/assignments/{out['assignment']['id']}", headers=auth).get_json()["assignment"]
    assert [f["url"] for f in a["files"]] == [None, None]
    # 别人不能替创建人确认上传
    other, _ = _login(client, "13800000009")
    assert client.put(out["uploads"][0]["url"], data=b"x").status_code == 200
    assert client.post("/api/plans/files/uploaded", json={"ids": [out["uploads"][0]["id"]]}, headers=other).get_json()["done"] == []
    _upload(client, auth, out["uploads"])
    a = client.get(f"/api/plans/assignments/{out['assignment']['id']}", headers=auth).get_json()["assignment"]
    assert all(f["url"] for f in a["files"]) and [f["kind"] for f in a["files"]] == ["scan", "scan"]
    got = client.get(a["files"][1]["url"])
    assert got.status_code == 200 and got.mimetype == "image/jpeg"

    listing = client.get("/api/plans", headers=auth).get_json()
    assert listing["plans"][0]["members"] == 0 and listing["summary"]["owned"] == 1


def test_create_validation(client, auth):
    assert client.post("/api/plans", json={"name": "", "subject": "math", "files": [SCAN]}, headers=auth).status_code == 400
    assert client.post("/api/plans", json={"name": "x", "subject": "nope", "files": [SCAN]}, headers=auth).status_code == 400
    assert client.post("/api/plans", json={"name": "x", "subject": "math", "files": []}, headers=auth).status_code == 201  # 可以先不放作业
    bad = {**PDF, "mime": "application/zip"}
    assert client.post("/api/plans", json={"name": "x", "subject": "math", "files": [bad]}, headers=auth).status_code == 400
    big = {**PDF, "size": 21 * 1024 * 1024}
    assert client.post("/api/plans", json={"name": "x", "subject": "math", "files": [big]}, headers=auth).status_code == 413
    assert Plan.query.count() == 1  # 只有上面没放作业的那个
    assert client.post("/api/plans", json={"name": "x", "subject": "mixed", "files": [SCAN]}, headers=auth).status_code == 201
    # 新建不再选学科：不带学科也能建，学科留空；转发落地页不显示学科这一行
    r = client.post("/api/plans", json={"name": "寒假计划", "files": []}, headers=auth)
    assert r.status_code == 201 and r.get_json()["plan"]["subject"] is None
    page = client.get(f"/api/plans/j/{r.get_json()['invite']['code']}").get_data(as_text=True)
    assert "<span>学科</span>" not in page and "还没有布置" in page


def test_invite_preview_lists_assignments_with_their_files(client, auth):
    """加入页先看到作业名、再看到作业下面的文件：新的在上，卡片指向的那份带 shared；文件只给名字，不给打开的地址"""
    out = _create(client, auth, title="第三单元练习", files=[SCAN, PDF])
    pid, code, first = out["plan"]["id"], out["invite"]["code"], out["assignment"]["id"]
    second = client.post(f"/api/plans/{pid}/assignments", json={"title": "周末卷", "files": [SCAN]}, headers=auth).get_json()["assignment"]["id"]
    r = client.get(f"/api/plans/invite/{code}?a={first}").get_json()
    assert [(a["title"], a["shared"], [f["name"] for f in a["files"]]) for a in r["assignments"]] == [
        ("周末卷", False, ["第 1 页.jpg"]),
        ("第三单元练习", True, ["第 1 页.jpg", "第三单元练习.pdf"]),
    ]
    assert r["assignment"]["id"] == first and all(f["url"] is None for a in r["assignments"] for f in a["files"])
    # 没指定哪份：最新一份算这次布置的
    r = client.get(f"/api/plans/invite/{code}").get_json()
    assert r["assignment"]["id"] == second and [a["shared"] for a in r["assignments"]] == [True, False]
    html = client.get(f"/api/plans/j/{code}?a={first}").get_data(as_text=True)
    assert html.index("周末卷") < html.index("第三单元练习.pdf") and html.count("<details") == 2 and html.count("这次布置") == 1
    assert "2 个文件" in html and "X-Amz" not in html and "/api/plans/files/" not in html
    # 删掉的作业不出现；指向它的旧卡片落到最新一份
    assert client.delete(f"/api/plans/assignments/{first}", headers=auth).status_code == 200
    r = client.get(f"/api/plans/invite/{code}?a={first}").get_json()
    assert [a["title"] for a in r["assignments"]] == ["周末卷"] and r["assignment"]["id"] == second


def test_invite_preview_and_landing_page(client, auth):
    out = _create(client, auth)
    code = out["invite"]["code"]
    r = client.get(f"/api/plans/invite/{code}").get_json()  # 不用登录
    assert r["plan"]["name"] == "五年级数学" and r["plan"]["teacher"] == "小雨" and r["assignment"]["id"] == out["assignment"]["id"]
    assert r["role"] is None and r["members"] == {"count": 0, "list": []} and r["plan"]["teacherAvatar"] is None
    assert client.get("/api/plans/invite/nope").status_code == 404
    # 带登录信息：创建人 / 还没加入 / 已加入各不一样；加入后落地页上能看到已经有谁
    assert client.get(f"/api/plans/invite/{code}", headers=auth).get_json()["role"] == "owner"
    stu, _ = _login(client, "13900000077", "小明")
    assert client.get(f"/api/plans/invite/{code}", headers=stu).get_json()["role"] is None
    assert _join(client, stu, code)["joined"] is True
    r = client.get(f"/api/plans/invite/{code}", headers=stu).get_json()
    assert r["role"] == "member" and r["members"] == {"count": 1, "list": [{"name": "小明", "avatar": None}]}
    assert client.get(f"/api/plans/invite/{code}", headers={"Authorization": "Bearer bad"}).get_json()["role"] is None  # 登录过期当成没登录
    page = client.get(f"/api/plans/j/{code}?a={out['assignment']['id']}")
    html = page.get_data(as_text=True)
    assert page.status_code == 200 and "打开上壹课，加入学习计划" in html and f"shangyike://plans/join?code={code}" in html
    assert "先看作业" not in html and "已有 1 人加入" in html and '<span class="ava">雨</span>' in html
    assert client.get("/api/plans/j/nope").status_code == 404


def test_join_and_member_cannot_see_members(client, auth):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    stu, stu_id = _login(client, "13800000001", "王小明")
    assert client.get(f"/api/plans/{pid}", headers=stu).status_code == 403  # 没加入看不了

    j = _join(client, stu, code)
    assert j["joined"] is True and j["plan"]["role"] == "member" and j["me"] == {"name": "王小明", "defaultName": False, "needsName": False}
    assert _join(client, stu, code)["joined"] is False  # 再点一次不重复加入
    assert _join(client, auth, code)["plan"]["role"] == "owner"  # 老师自己点开不会变成成员
    assert PlanMember.query.count() == 1

    view = client.get(f"/api/plans/{pid}", headers=stu).get_json()
    assert "members" not in view and "invite" not in view and "members" not in view["plan"]
    row = view["assignments"][0]
    assert row["status"] == "todo" and "submitted" not in row and "members" not in row
    detail = client.get(f"/api/plans/assignments/{aid}", headers=stu).get_json()
    assert "board" not in detail and "invite" not in detail and detail["submission"] is None
    assert client.get("/api/plans", headers=stu).get_json()["summary"]["todo"] == 1
    # 成员不能布置作业、改计划、移除别人
    assert client.post(f"/api/plans/{pid}/assignments", json={"files": [SCAN]}, headers=stu).status_code == 403
    assert client.patch(f"/api/plans/{pid}", json={"name": "x"}, headers=stu).status_code == 403
    assert client.delete(f"/api/plans/{pid}/members/{stu_id}", headers=stu).status_code == 403

    owner = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    assert [m["name"] for m in owner["members"]] == ["王小明"] and owner["assignments"][0]["missing"] == 1
    board = client.get(f"/api/plans/assignments/{aid}", headers=auth).get_json()["board"]
    assert board["missing"][0]["viewed"] is True and board["unseen"] == 0  # 学生点开过


def test_names_follow_account_and_duplicates_get_tail(client, auth):
    out = _create(client, auth)
    pid, code = out["plan"]["id"], out["invite"]["code"]
    a, _ = _login(client, "13800001111")  # 没起名字，默认「小同学」
    b, _ = _login(client, "13800002222")
    c, _ = _login(client, "13800003333", "李华")
    ja = _join(client, a, code)
    assert ja["me"] == {"name": "小同学", "defaultName": True, "needsName": True}  # 刚注册的新用户，要先起名字
    _join(client, b, code)
    _join(client, c, code)
    members = client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"]
    assert [(m["name"], m["tail"]) for m in members] == [("小同学", "1111"), ("小同学", "2222"), ("李华", "")]

    # 老用户（注册超过半小时）还是默认名字：不拦，只提示
    from datetime import datetime, timedelta

    u = User.query.filter_by(phone="13800002222").first()
    u.created_at = datetime.now() - timedelta(days=3)
    db.session.commit()
    assert _join(client, b, code)["me"] == {"name": "小同学", "defaultName": True, "needsName": False}

    # 在 App 里改名，计划里跟着变，重名的尾号也随之消失
    assert client.patch("/api/auth/me", json={"nickname": "张三"}, headers=a).status_code == 200
    members = client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"]
    assert [(m["name"], m["tail"]) for m in members] == [("张三", ""), ("小同学", ""), ("李华", "")]
    assert client.get(f"/api/plans/{pid}", headers=a).get_json()["me"] == {"name": "张三", "defaultName": False}


def test_submit_review_flow(client, auth):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    s1, _ = _login(client, "13800000001", "王小明")
    s2, _ = _login(client, "13800000002", "李华")
    s3, _ = _login(client, "13800000003", "赵六")
    for s in (s1, s2, s3):
        _join(client, s, code)
    # 还没人交：待批是 0，交上来过的也是 0（首页靠它不说「都批完了」）
    row = next(p for p in client.get("/api/plans", headers=auth).get_json()["plans"] if p["id"] == pid)
    assert (row["toReview"], row["handed"]) == (0, 0)
    assert client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [SCAN]}, headers=auth).status_code == 403  # 老师不用交
    assert client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [PDF]}, headers=s1).status_code == 400  # 交的必须是照片

    sid1 = _submit(client, s1, aid)
    sid2 = _submit(client, s2, aid, [{**RESULTS[0]}, {**RESULTS[1]}, {**RESULTS[2], "m": "correct"}])
    mine = client.get(f"/api/plans/assignments/{aid}", headers=s1).get_json()["submission"]
    assert mine["score"] == {"total": 3, "correct": 1, "wrong": 1, "blank": 1} and mine["files"][0]["url"] and mine["late"] is False
    assert client.get(f"/api/plans/submissions/{sid2}", headers=s1).status_code == 403  # 看不了别人的
    assert client.put(f"/api/plans/submissions/{sid2}/results", json={"results": RESULTS}, headers=s1).status_code == 403

    board = client.get(f"/api/plans/assignments/{aid}", headers=auth).get_json()["board"]
    assert board["members"] == 3 and [s["name"] for s in board["submitted"]] == ["王小明", "李华"]
    assert [m["name"] for m in board["missing"]] == ["赵六"] and board["unseen"] == 1
    assert board["hardest"][0] == {"number": "2", "wrong": 2, "knowledge": "乘法", "stem": "3×4=?", "graded": 2}
    plan = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    assert plan["assignments"][0]["submitted"] == 2 and plan["plan"]["toReview"] == 2 and plan["plan"]["submittedToday"] == 2
    row = next(p for p in client.get("/api/plans", headers=auth).get_json()["plans"] if p["id"] == pid)
    assert (row["toReview"], row["handed"]) == (2, 2)

    # 老师检查：上一个 / 下一个、改判、已阅
    r = client.get(f"/api/plans/submissions/{sid1}", headers=auth).get_json()
    assert r["student"]["name"] == "王小明" and r["nav"] == {"index": 1, "total": 2, "prev": None, "next": sid2}
    r = client.patch(f"/api/plans/submissions/{sid1}", json={"marks": {"1": "correct"}, "status": "reviewed", "comment": "不错"}, headers=auth).get_json()["submission"]
    assert r["status"] == "reviewed" and r["score"]["correct"] == 2 and r["results"][1]["o"] is True and r["comment"] == "不错"
    assert client.patch(f"/api/plans/submissions/{sid1}", json={"status": "reviewed"}, headers=s1).status_code == 403
    # 已阅之后不能重交、不能再改结果
    assert client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [SCAN]}, headers=s1).status_code == 409
    assert client.put(f"/api/plans/submissions/{sid1}/results", json={"results": RESULTS}, headers=s1).status_code == 409
    assert client.get(f"/api/plans/{pid}", headers=s1).get_json()["assignments"][0]["status"] == "reviewed"

    # 退回重做：学生那边回到待交，老师那边算没交，重交后旧照片换掉
    client.patch(f"/api/plans/submissions/{sid2}", json={"status": "returned", "comment": "第 2 题重做"}, headers=auth)
    row = client.get(f"/api/plans/{pid}", headers=s2).get_json()["assignments"][0]
    assert row["status"] == "returned" and row["comment"] == "第 2 题重做"
    assert client.get("/api/plans", headers=s2).get_json()["summary"]["todo"] == 1
    board = client.get(f"/api/plans/assignments/{aid}", headers=auth).get_json()["board"]
    assert sorted(m["name"] for m in board["missing"]) == ["李华", "赵六"]
    assert _submit(client, s2, aid) == sid2
    assert PlanFile.query.filter_by(submission_id=sid2).count() == 1
    assert client.get(f"/api/plans/{pid}", headers=s2).get_json()["assignments"][0]["status"] == "submitted"


def test_late_and_digitized(client, auth):
    out = _create(client, auth, dueAt="2020-01-01T20:00:00")
    aid, code = out["assignment"]["id"], out["invite"]["code"]
    stu, _ = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    dig = {"sheets": [{"label": "第 1 页"}], "questions": [{"index": 0, "number": "1", "stemText": "3+4=?"}]}
    assert client.put(f"/api/plans/assignments/{aid}/digitized", json={"digitized": dig}, headers=stu).status_code == 403
    r = client.put(f"/api/plans/assignments/{aid}/digitized", json={"digitized": dig, "title": "口算练习"}, headers=auth).get_json()
    assert r["assignment"]["questionCount"] == 1 and r["assignment"]["title"] == "口算练习"
    assert client.get(f"/api/plans/assignments/{aid}", headers=stu).get_json()["assignment"]["digitized"] == dig
    _submit(client, stu, aid)
    assert client.get(f"/api/plans/assignments/{aid}", headers=auth).get_json()["board"]["submitted"][0]["late"] is True  # 过期还能交，只是标出来


def test_more_assignments_revoke_leave_and_reset_invite(client, auth):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    stu, stu_id = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    r = client.post(f"/api/plans/{pid}/assignments", json={"title": "周末卷", "files": [SCAN]}, headers=auth)
    aid2 = r.get_json()["assignment"]["id"]
    assert r.status_code == 201 and len(client.get(f"/api/plans/{pid}", headers=stu).get_json()["assignments"]) == 2

    # 撤回没人交过的：直接没了；有人交过的：交过的人还能看到自己那份
    assert client.delete(f"/api/plans/assignments/{aid2}", headers=stu).status_code == 403
    assert client.delete(f"/api/plans/assignments/{aid2}", headers=auth).status_code == 200
    assert client.get(f"/api/plans/assignments/{aid2}", headers=stu).status_code == 404
    _submit(client, stu, aid)
    assert client.delete(f"/api/plans/assignments/{aid}", headers=auth).status_code == 200
    rows = client.get(f"/api/plans/{pid}", headers=stu).get_json()["assignments"]
    assert len(rows) == 1 and rows[0]["revoked"] is True
    assert client.get(f"/api/plans/{pid}", headers=auth).get_json()["assignments"] == []
    assert client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [SCAN]}, headers=stu).status_code == 409

    # 换邀请码：旧卡片失效，已在里面的人不受影响
    new = client.patch(f"/api/plans/{pid}", json={"resetInvite": True, "name": "新名字"}, headers=auth).get_json()
    assert new["invite"]["code"] != code and new["plan"]["name"] == "新名字"
    other, _ = _login(client, "13800000002")
    assert client.post("/api/plans/join", json={"code": code}, headers=other).status_code == 404
    assert client.get(f"/api/plans/{pid}", headers=stu).status_code == 200

    # 自己退出，再点卡片能回来；老师移除
    assert client.delete(f"/api/plans/{pid}/members/me", headers=stu).status_code == 200
    assert client.get(f"/api/plans/{pid}", headers=stu).status_code == 403 and client.get("/api/plans", headers=stu).get_json()["plans"] == []
    assert _join(client, stu, new["invite"]["code"])["joined"] is True
    assert client.delete(f"/api/plans/{pid}/members/{stu_id}", headers=auth).status_code == 200
    assert client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"] == []


def test_dissolve_deletes_everything(client, auth, app):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    _upload(client, auth, out["uploads"])
    stu, _ = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    _submit(client, stu, aid)
    from app import storage

    with app.app_context():
        store = storage.get_storage()
        keys = [f.key for f in PlanFile.query.all()]
        assert len(keys) == 2 and all(store.exists(k) for k in keys)
    assert client.delete(f"/api/plans/{pid}", headers=stu).status_code == 403
    assert client.delete(f"/api/plans/{pid}", headers=auth).status_code == 200
    with app.app_context():
        assert not any(storage.get_storage().exists(k) for k in keys)
    assert Plan.query.count() == PlanMember.query.count() == PlanSubmission.query.count() == PlanFile.query.count() == 0
    assert client.get(f"/api/plans/{pid}", headers=stu).status_code == 404


def test_dissolve_removes_members_and_says_so(client, auth):
    """解散后加入者自动退出：列表里没有了，再打开计划 / 作业、再交、再点旧卡片，都明说「已被创建人解散」"""
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    stu, _ = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    other = _create(client, auth, name="另一个计划")
    _join(client, stu, other["invite"]["code"])
    assert len(client.get("/api/plans", headers=stu).get_json()["plans"]) == 2
    assert client.delete(f"/api/plans/{pid}", headers=auth).status_code == 200

    r = client.get("/api/plans", headers=stu).get_json()
    assert [p["id"] for p in r["plans"]] == [other["plan"]["id"]] and r["summary"]["joined"] == 1
    for resp in (
        client.get(f"/api/plans/{pid}", headers=stu),
        client.get(f"/api/plans/assignments/{aid}", headers=stu),
        client.post(f"/api/plans/assignments/{aid}/submission", json={"files": [SCAN]}, headers=stu),
        client.get(f"/api/plans/invite/{code}"),
        client.post("/api/plans/join", json={"code": code}, headers=stu),
    ):
        assert resp.status_code == 404 and resp.get_json()["error"] == "plan_dissolved", resp.get_json()
        assert "解散" in resp.get_json()["message"]
    # 没存在过的照旧
    assert client.get("/api/plans/nope", headers=stu).get_json()["error"] == "not_found"
    assert client.get("/api/plans/invite/nope").get_json()["error"] == "not_found"
    # 没解散的那个不受影响
    assert client.get(f"/api/plans/{other['plan']['id']}", headers=stu).status_code == 200


def test_delete_account_cleans_plans(client, auth):
    out = _create(client, auth)
    aid, code = out["assignment"]["id"], out["invite"]["code"]
    stu, stu_id = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    _submit(client, stu, aid)
    from app.routes.plans import delete_user_plans

    delete_user_plans(stu_id)
    db.session.commit()
    assert PlanMember.query.count() == 0 and PlanSubmission.query.count() == 0 and PlanFile.query.filter(PlanFile.submission_id.isnot(None)).count() == 0
    assert Plan.query.count() == 1
    owner_id = Plan.query.first().owner_id
    delete_user_plans(owner_id)
    db.session.commit()
    assert Plan.query.count() == 0 and PlanFile.query.count() == 0


def test_merge_accounts_moves_plans(client, auth):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    a, a_id = _login(client, "13800000001", "王小明")
    b, b_id = _login(client, "13800000002", "王小明")
    _join(client, a, code)
    _join(client, b, code)
    _submit(client, a, aid)
    from app.routes.plans import merge_user_plans

    merge_user_plans(a_id, b_id)  # a 并进 b：b 已经是成员，留 b 的成员身份；a 的提交挪给 b
    db.session.commit()
    assert [m.user_id for m in PlanMember.query.all()] == [b_id]
    assert PlanSubmission.query.one().user_id == b_id
    assert client.get(f"/api/plans/{pid}", headers=b).get_json()["assignments"][0]["status"] == "submitted"
    owner_id = Plan.query.first().owner_id
    merge_user_plans(owner_id, b_id)  # 老师并进成员账号：计划归 b，b 不再是自己计划的成员
    db.session.commit()
    assert Plan.query.first().owner_id == b_id and PlanMember.query.count() == 0


def test_avatar_upload_and_shown_to_plan_members(client, auth):
    """换头像：要上传地址 → 直传 → 确认；自己的资料、成员看到的创建人、创建人看到的成员都带上头像"""
    teacher, _ = _login(client, "13900000071", "陈老师")
    student, student_id = _login(client, "13700000071", "王小明")
    assert client.get("/api/auth/me", headers=teacher).get_json()["user"]["avatar"] is None

    def upload(headers, data=b"\xff\xd8fakejpeg"):
        up = client.post("/api/auth/avatar/upload-url", headers=headers).get_json()
        assert client.put(up["url"], data=data, headers=up["headers"]).status_code == 200
        return client.post("/api/auth/avatar", headers=headers, json={"version": up["version"]})

    r = upload(teacher)
    assert r.status_code == 200
    first = r.get_json()["user"]["avatar"]
    assert first and client.get(first).data == b"\xff\xd8fakejpeg"
    # 没传文件就确认、乱填版本号都不行
    up = client.post("/api/auth/avatar/upload-url", headers=teacher).get_json()
    assert client.post("/api/auth/avatar", headers=teacher, json={"version": up["version"]}).status_code == 400
    assert client.post("/api/auth/avatar", headers=teacher, json={"version": "../x"}).status_code == 400
    # 再换一张：地址变了，旧图删掉
    second = upload(teacher, b"\xff\xd8another").get_json()["user"]["avatar"]
    assert second != first and client.get(second).data == b"\xff\xd8another"
    assert client.get(first).status_code == 404

    p = client.post("/api/plans", headers=teacher, json={"name": "五（2）班数学", "subject": "math", "title": "作业", "files": [PDF]}).get_json()
    client.post("/api/plans/join", headers=student, json={"code": p["invite"]["code"]})
    mine = client.get("/api/plans", headers=student).get_json()["plans"][0]
    assert mine["teacher"] == "陈老师" and client.get(mine["teacherAvatar"]).data == b"\xff\xd8another"
    upload(student)
    members = client.get(f"/api/plans/{p['plan']['id']}", headers=teacher).get_json()["members"]
    assert members[0]["userId"] == student_id and members[0]["avatar"]
    # 注销后头像记录和图片都没了
    assert client.delete("/api/auth/me", headers=teacher).status_code == 200
    assert client.get(second).status_code == 404


def test_create_plan_without_files_then_assign_later(client):
    """先不放作业也能建计划、转发、加入；之后布置的作业，早加入的成员照样能看到"""
    teacher, _ = _login(client, "13800003001", "王老师")
    student, _ = _login(client, "13800003002", "小明")
    r = client.post("/api/plans", json={"name": "五年级数学", "subject": "math", "files": []}, headers=teacher)
    assert r.status_code == 201, r.get_json()
    res = r.get_json()
    assert res["assignment"] is None and res["uploads"] == [] and "?a=" not in res["invite"]["url"]
    assert client.get(f"/api/plans/j/{res['invite']['code']}").status_code == 200  # 落地页没有作业也能开
    assert client.post("/api/plans/join", json={"code": res["invite"]["code"]}, headers=student).status_code == 200
    pid = res["plan"]["id"]
    assert client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"] == []

    r = client.post(f"/api/plans/{pid}/assignments", json={"files": [PDF]}, headers=teacher)
    assert r.status_code == 201
    _upload(client, teacher, r.get_json()["uploads"])
    got = client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"]
    assert [a["id"] for a in got] == [r.get_json()["assignment"]["id"]]


def test_owner_plan_page_has_files_and_member_status(client, auth):
    """计划页合并了作业情况：作业带文件列表，成员带已交 / 未交，顶部有未交人数"""
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    _upload(client, auth, out["uploads"])
    s1, u1 = _login(client, "13800000011", "小明")
    s2, u2 = _login(client, "13800000012", "小红")
    _join(client, s1, code)
    _join(client, s2, code)
    sid = _submit(client, s1, aid)

    body = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    assert [f["name"] for f in body["assignments"][0]["files"]] == ["第 1 页.jpg"]
    assert all(f["url"] for f in body["assignments"][0]["files"])
    assert (body["plan"]["members"], body["plan"]["missing"], body["plan"]["submittedToday"]) == (2, 1, 1)
    rows = {m["userId"]: m for m in body["members"]}
    assert (rows[u1]["status"], rows[u1]["toReview"], rows[u1]["items"][0]["submissionId"]) == ("submitted", 1, sid)
    assert rows[u1]["items"][0]["score"]["wrong"] == 1
    assert (rows[u2]["status"], rows[u2]["items"][0]["status"], rows[u2]["items"][0]["viewed"]) == ("missing", "todo", False)

    # 退回重做算未交；再布置一份，交过第一份的也变成未交
    client.patch(f"/api/plans/submissions/{sid}", json={"status": "returned", "comment": "重做"}, headers=auth)
    body = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    assert body["plan"]["missing"] == 2 and {m["status"] for m in body["members"]} == {"missing"}
    _submit(client, s1, aid)
    r = client.post(f"/api/plans/{pid}/assignments", json={"files": [PDF], "title": "第二份"}, headers=auth)
    assert r.status_code == 201
    body = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    rows = {m["userId"]: m for m in body["members"]}
    assert rows[u1]["status"] == "missing" and [i["status"] for i in rows[u1]["items"]] == ["todo", "submitted"]

    # 退出的人：交过的还列着（待阅有入口），不算人数和未交；没交过的不列
    client.delete(f"/api/plans/{pid}/members/me", headers=s1)
    client.delete(f"/api/plans/{pid}/members/me", headers=s2)
    body = client.get(f"/api/plans/{pid}", headers=auth).get_json()
    assert [(m["userId"], m["left"]) for m in body["members"]] == [(u1, True)]
    assert (body["plan"]["members"], body["plan"]["missing"]) == (0, 0)

    # 成员看不到这些
    s3, _ = _login(client, "13800000013", "小刚")
    _join(client, s3, code)
    mine = client.get(f"/api/plans/{pid}", headers=s3).get_json()
    assert "members" not in mine and "missing" not in mine["plan"]


def test_member_plan_page_has_files_and_marks_viewed(client, auth):
    """成员的计划页合并了作业页：每份作业带文件列表和有没有电子版；打开计划页就算看过"""
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    _upload(client, auth, out["uploads"])
    student, uid = _login(client, "13800000021", "小明")
    _join(client, student, code)
    before = {m["userId"]: m for m in client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"]}
    assert before[uid]["items"][0]["viewed"] is False

    mine = client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"]
    assert [f["name"] for f in mine[0]["files"]] == ["第 1 页.jpg"]
    assert all(f["url"] for f in mine[0]["files"]) and mine[0]["digitized"] is False and mine[0]["status"] == "todo"
    assert client.get(f"/api/plans/{pid}", headers=student).status_code == 200  # 再打开一次不会重复记
    after = {m["userId"]: m for m in client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"]}
    assert after[uid]["items"][0]["viewed"] is True

    # 交了以后状态跟着变；带的是作业的文件，不是自己交的那几页
    _submit(client, student, aid)
    mine = client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"]
    assert mine[0]["status"] == "submitted" and len(mine[0]["files"]) == 1


def test_dissolve_still_works_without_tombstone_table(client, auth):
    """线上数据库账号建不了表：记号表还没手动建时，解散照常成功，只是退回到「不存在」的提示"""
    from app.models import PlanTombstone

    out = _create(client, auth)
    pid, code = out["plan"]["id"], out["invite"]["code"]
    stu, _ = _login(client, "13800000001", "王小明")
    _join(client, stu, code)
    PlanTombstone.__table__.drop(db.engine)
    try:
        assert client.delete(f"/api/plans/{pid}", headers=auth).status_code == 200
        assert Plan.query.count() == PlanMember.query.count() == 0
        assert client.get("/api/plans", headers=stu).get_json()["plans"] == []
        assert client.get(f"/api/plans/{pid}", headers=stu).get_json()["error"] == "not_found"
        assert client.get(f"/api/plans/invite/{code}").status_code == 404
    finally:
        PlanTombstone.__table__.create(db.engine)


def test_one_publish_is_one_assignment_with_all_files(client, auth):
    """一次布置几个文件（扫描件、PDF 混着）：算一份作业，同学整份交一次"""
    pdf2 = {**PDF, "clientId": "c3", "name": "物理一模.pdf"}
    out = _create(client, auth, files=[PDF, SCAN, pdf2], title="随便起的名字")
    pid, code = out["plan"]["id"], out["invite"]["code"]
    assert [a["title"] for a in out["assignments"]] == ["随便起的名字"]
    assert out["assignment"]["id"] == out["assignments"][0]["id"]
    assert sorted(u["clientId"] for u in out["uploads"]) == ["c1", "c2", "c3"]
    _upload(client, auth, out["uploads"])

    student, _ = _login(client, "13800000031", "小明")
    _join(client, student, code)
    mine = client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"]
    assert [(a["title"], [f["name"] for f in a["files"]], a["status"]) for a in mine] == [
        ("随便起的名字", ["第三单元练习.pdf", "第 1 页.jpg", "物理一模.pdf"], "todo"),
    ]
    _submit(client, student, mine[0]["id"])
    assert client.get(f"/api/plans/{pid}", headers=student).get_json()["assignments"][0]["status"] == "submitted"

    # 没起名字：不管几个文件都按布置日期起名，不用文件名
    r = client.post(f"/api/plans/{pid}/assignments", json={"files": [PDF]}, headers=auth).get_json()
    assert len(r["assignments"]) == 1 and "日作业" in r["assignment"]["title"]
    r = client.post(f"/api/plans/{pid}/assignments", json={"files": [PDF, pdf2]}, headers=auth).get_json()
    assert len(r["assignments"]) == 1 and "日作业" in r["assignment"]["title"]


def test_owner_adds_files_to_existing_assignment(client, auth):
    """创建人往已有的作业里加文件：进同一份作业，不会变成新作业；成员不能加；最多 30 个；没传上去的可以删掉"""
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    _upload(client, auth, out["uploads"])
    student, _ = _login(client, "13800000051", "小明")
    _join(client, student, code)

    assert client.post(f"/api/plans/assignments/{aid}/files", json={"files": [PDF]}, headers=student).status_code == 403
    assert client.post(f"/api/plans/assignments/{aid}/files", json={"files": []}, headers=auth).status_code == 400
    r = client.post(f"/api/plans/assignments/{aid}/files", json={"files": [PDF, {**SCAN, "clientId": "c9", "name": "第 2 页.jpg"}]}, headers=auth)
    assert r.status_code == 201, r.get_json()
    added = r.get_json()["uploads"]
    assert sorted(u["clientId"] for u in added) == ["c2", "c9"]
    _upload(client, auth, added)
    for h in (auth, student):
        rows = client.get(f"/api/plans/{pid}", headers=h).get_json()["assignments"]
        assert len(rows) == 1 and [f["name"] for f in rows[0]["files"]] == ["第 1 页.jpg", "第三单元练习.pdf", "第 2 页.jpg"]

    # 一份作业最多 30 个文件
    many = [{**SCAN, "clientId": f"m{i}"} for i in range(28)]
    assert client.post(f"/api/plans/assignments/{aid}/files", json={"files": many}, headers=auth).status_code == 400

    # 删掉一个文件：只有创建人能删，最后一个不能删
    fid = added[0]["id"]
    assert client.delete(f"/api/plans/files/{fid}", headers=student).status_code == 403
    assert client.delete(f"/api/plans/files/{fid}", headers=auth).status_code == 200
    assert client.delete(f"/api/plans/files/{added[1]['id']}", headers=auth).status_code == 200
    left = client.get(f"/api/plans/{pid}", headers=auth).get_json()["assignments"][0]["files"]
    assert [f["name"] for f in left] == ["第 1 页.jpg"]
    assert client.delete(f"/api/plans/files/{left[0]['id']}", headers=auth).status_code == 409

    # 删除了的作业不能再加
    assert client.delete(f"/api/plans/assignments/{aid}", headers=auth).status_code == 200
    assert client.post(f"/api/plans/assignments/{aid}/files", json={"files": [PDF]}, headers=auth).status_code == 404


def test_member_withdraws_own_submission(client, auth):
    out = _create(client, auth)
    pid, aid, code = out["plan"]["id"], out["assignment"]["id"], out["invite"]["code"]
    s1, u1 = _login(client, "13800000001", "王小明")
    s2, _ = _login(client, "13800000002", "李华")
    for s in (s1, s2):
        _join(client, s, code)
    url = f"/api/plans/assignments/{aid}/submission"
    mine = lambda h: client.get(f"/api/plans/{pid}", headers=h).get_json()["assignments"][0]["status"]  # noqa: E731

    assert client.delete(url, headers=auth).status_code == 403  # 老师没有自己的提交
    assert client.delete(url, headers=s1).status_code == 200  # 没交过：不报错
    sid1, sid2 = _submit(client, s1, aid), _submit(client, s2, aid)
    assert mine(s1) == "submitted" and PlanFile.query.filter_by(submission_id=sid1).count() == 1

    # 解绑：只撤自己那份，照片一起删，回到没交；别人的不动；可以再交
    assert client.delete(url, headers=s1).status_code == 200
    assert mine(s1) == "todo" and mine(s2) == "submitted"
    assert db.session.get(PlanSubmission, sid1) is None and PlanFile.query.filter_by(submission_id=sid1).count() == 0
    assert db.session.get(PlanSubmission, sid2) is not None and PlanFile.query.filter_by(submission_id=sid2).count() == 1
    row = next(m for m in client.get(f"/api/plans/{pid}", headers=auth).get_json()["members"] if m["userId"] == u1)
    assert (row["submitted"], row["items"][0]["status"], row["items"][0]["submissionId"]) == (0, "todo", None)
    sid1 = _submit(client, s1, aid)
    assert mine(s1) == "submitted"

    # 老师批阅过的不能撤
    client.patch(f"/api/plans/submissions/{sid1}", json={"status": "reviewed"}, headers=auth)
    assert client.delete(url, headers=s1).status_code == 409 and mine(s1) == "reviewed"

    # 老师删掉的作业：交过的人还看得到；最后一份也撤了，作业连文件一起没了
    assert client.delete(f"/api/plans/assignments/{aid}", headers=auth).status_code == 200
    assert client.delete(url, headers=s2).status_code == 200
    assert db.session.get(PlanAssignment, aid) is not None  # 王小明那份还在
    assert client.get(f"/api/plans/{pid}", headers=s2).get_json()["assignments"] == []


def test_auto_title_follows_files(client, auth):
    """以前没起名字的单文件作业名字就是文件名（这里用同名的标题模拟）：后来又加了文件，名字换成按布置日期的；别的名字不动"""
    from datetime import datetime

    stem = PDF["name"].rsplit(".", 1)[0]
    r = client.post("/api/plans", json={"name": "名字跟着文件走", "title": stem, "files": [PDF]}, headers=auth).get_json()
    pid, aid = r["plan"]["id"], r["assignment"]["id"]
    assert r["assignment"]["title"] == stem
    now = datetime.now()
    r = client.post(f"/api/plans/assignments/{aid}/files", json={"files": [{**PDF, "clientId": "more1"}]}, headers=auth)
    assert r.status_code == 201 and r.get_json()["assignment"]["title"] == f"{now.month}月{now.day}日作业"
    named = client.post(f"/api/plans/{pid}/assignments", json={"title": "周末卷子", "files": [PDF]}, headers=auth).get_json()["assignment"]
    r = client.post(f"/api/plans/assignments/{named['id']}/files", json={"files": [{**PDF, "clientId": "more2"}]}, headers=auth)
    assert r.get_json()["assignment"]["title"] == "周末卷子"


def test_dated_titles_numbered_and_rename_script(client, auth, app):
    """同一天没起名字布置几份：后面的带（2）（3）。存量脚本：名字等于文件名的旧作业改成按日期的名字，自己起的不动，可以重复跑"""
    import os
    import sys
    from datetime import datetime

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    from rename_plan_assignments import rename

    now = datetime.now()
    day = f"{now.month}月{now.day}日作业"
    stem = PDF["name"].rsplit(".", 1)[0]
    r = client.post("/api/plans", json={"name": "改名", "files": [PDF]}, headers=auth).get_json()
    pid = r["plan"]["id"]
    assert r["assignment"]["title"] == day
    post = lambda body: client.post(f"/api/plans/{pid}/assignments", json=body, headers=auth).get_json()["assignment"]
    assert post({"files": [PDF]})["title"] == f"{day}（2）"
    old1, old2, own = post({"title": stem, "files": [PDF]}), post({"title": stem, "files": [PDF]}), post({"title": "周末卷子", "files": [PDF]})
    with app.app_context():
        plan = [c for c in rename() if c["plan"] == pid]
        assert [(c["assignment"], c["new"]) for c in plan] == [(old1["id"], f"{day}（3）"), (old2["id"], f"{day}（4）")]
        assert db.session.get(PlanAssignment, old1["id"]).title == stem  # 不带 apply 不写库
        rename(apply=True)
        assert [db.session.get(PlanAssignment, i).title for i in (old1["id"], old2["id"], own["id"])] == [f"{day}（3）", f"{day}（4）", "周末卷子"]
        assert [c for c in rename(apply=True) if c["plan"] == pid] == []
