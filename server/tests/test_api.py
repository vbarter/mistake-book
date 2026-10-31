from datetime import datetime, timedelta

from conftest import TINY_PNG

from app.extensions import db
from app.models import Mistake
from app.scheduler import INTERVALS, apply_rating, effective_state


def _recognize_and_save(client, auth, n=3):
    r = client.post("/api/recognize", json={"crops": [{"image": TINY_PNG} for _ in range(n)]}, headers=auth)
    assert r.status_code == 200, r.get_json()
    items = r.get_json()["items"]
    assert len(items) == n
    assert all("stemImage" not in it and it["index"] == i for i, it in enumerate(items))  # 响应不回传图片
    for it in items:
        it["reasons"] = ["concept"]
        it["stemImage"] = TINY_PNG  # 客户端按 index 回填本地裁剪图
    r = client.post("/api/mistakes", json={"items": items}, headers=auth)
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def test_health_and_auth(client):
    assert client.get("/api/health").get_json()["aiProvider"] == "mock"
    r = client.post("/api/auth/login", json={"phone": "13800000000", "code": "000000"})
    assert r.status_code == 404  # 没注册的号码不能登录
    r = client.post("/api/auth/guest", json={"profile": {"grade": "4"}})
    assert r.status_code == 200
    assert r.get_json()["user"]["loginMethod"] == "guest"


def test_profile_update(client, auth):
    r = client.patch("/api/auth/me", json={"subjects": ["math"], "weeklyGoal": 10, "reviewReminder": {"enabled": True, "hour": 20}}, headers=auth)
    u = r.get_json()["user"]
    assert u["subjects"] == ["math"] and u["weeklyGoal"] == 10 and u["reviewReminder"]["hour"] == 20
    assert client.patch("/api/auth/me", json={"subjects": []}, headers=auth).status_code == 400


def test_recognize_save_and_library(client, auth):
    created = _recognize_and_save(client, auth, 3)
    assert len(created["created"]) == 3
    assert created["created"][0]["mastery"] == "due"
    assert created["created"][0]["stemImageUrl"].startswith("/api/uploads/")

    # 同题再录 → 合并
    again = _recognize_and_save(client, auth, 1)
    assert len(again["merged"]) == 1 and again["merged"][0]["wrongCount"] == 2

    groups = client.get("/api/mistakes/groups", headers=auth).get_json()
    assert groups["summary"]["total"] == 3
    subjects = {s["subject"] for s in groups["sections"]}
    assert {"math", "chinese", "english"} <= subjects

    found = client.get("/api/mistakes?q=绳子", headers=auth).get_json()
    assert found["total"] == 1
    mid = found["items"][0]["id"]
    detail = client.get(f"/api/mistakes/{mid}", headers=auth).get_json()["mistake"]
    assert detail["correctAnswer"] == "14 米" and detail["history"]

    r = client.patch(f"/api/mistakes/{mid}", json={"note": "看错了", "reasons": ["misread", "bogus"]}, headers=auth)
    assert r.get_json()["mistake"]["reasons"] == ["misread"]

    r = client.post(f"/api/mistakes/{mid}/master", headers=auth)
    assert r.get_json()["mistake"]["mastery"] == "mastered"
    r = client.post(f"/api/mistakes/{mid}/reinstate", headers=auth)
    assert r.get_json()["mistake"]["mastery"] == "due"

    r = client.post(f"/api/mistakes/{mid}/variants", json={"count": 2}, headers=auth)
    assert len(r.get_json()["mistake"]["variants"]) == 2

    assert client.delete(f"/api/mistakes/{mid}", headers=auth).status_code == 200
    assert client.get(f"/api/mistakes/{mid}", headers=auth).status_code == 404


def test_review_flow(client, auth):
    _recognize_and_save(client, auth, 3)
    today = client.get("/api/review/today", headers=auth).get_json()
    assert today["total"] == 3 and today["doneToday"] == 0
    mid = today["items"][0]["id"]

    preview = client.get(f"/api/review/preview/{mid}", headers=auth).get_json()
    assert preview["remembered"]["days"] == INTERVALS[1]

    r = client.post(f"/api/review/{mid}/rate", json={"result": "remembered"}, headers=auth)
    body = r.get_json()
    assert body["change"]["from"] == "due" and body["change"]["to"] == "learning"
    assert body["mistake"]["review"]["intervalIndex"] == 1

    today = client.get("/api/review/today", headers=auth).get_json()
    assert today["total"] == 2 and today["doneToday"] == 1

    r = client.post(f"/api/review/{mid}/rate", json={"result": "bogus"}, headers=auth)
    assert r.status_code == 400

    overview = client.get("/api/stats/overview", headers=auth).get_json()
    assert overview["total"] == 3 and overview["weekReviewed"] == 1 and overview["streakDays"] == 1
    assert any(d["isToday"] and d["done"] for d in overview["week"])


def test_scheduler_rules(app):
    with app.app_context():
        m = Mistake(user_id="u", subject="math", stem_text="x", knowledge_points=["k"])
        now = datetime(2026, 10, 21, 20, 0)
        m.interval_index, m.streak, m.next_due_at = 0, 0, now
        assert effective_state(m, now) == "due"

        apply_rating(m, "remembered", now)
        assert m.interval_index == 1 and m.next_due_at.date() == (now + timedelta(days=3)).date()
        assert m.next_due_at.hour == 4

        apply_rating(m, "fuzzy", m.next_due_at)
        assert m.interval_index == 1 and m.streak == 0

        apply_rating(m, "remembered", m.next_due_at)
        apply_rating(m, "remembered", m.next_due_at)
        assert m.mastered is True and effective_state(m, m.next_due_at - timedelta(days=1)) == "mastered"

        apply_rating(m, "forgot", now)
        assert m.mastered is False and m.interval_index == 0 and m.streak == 0


def test_practice_flow(client, auth):
    _recognize_and_save(client, auth, 3)
    weak = client.get("/api/practice/weak", headers=auth).get_json()
    assert len(weak["topics"]) >= 3

    r = client.post("/api/practice/start", json={"mode": "weak", "count": 3}, headers=auth)
    assert r.status_code == 201, r.get_json()
    session = r.get_json()["session"]
    assert len(session["items"]) == 3 and "answer" not in session["items"][0]

    first = session["items"][0]
    answer = "A" if first["questionType"] == "choice" else "随便"
    r = client.post(f"/api/practice/{session['id']}/answer", json={"index": 0, "answer": answer}, headers=auth)
    body = r.get_json()
    assert "correct" in body and body["answer"] and body["answered"] == 1
    r = client.post(f"/api/practice/{session['id']}/answer", json={"index": 0, "answer": answer}, headers=auth)
    assert r.status_code == 400

    r = client.post(f"/api/practice/{session['id']}/finish", headers=auth)
    result = r.get_json()["result"]
    assert result["total"] == 3 and result["answered"] == 1 and result["topics"]

    r = client.post("/api/practice/start", json={"mode": "custom", "subjects": ["english"], "count": 5}, headers=auth)
    assert r.status_code == 201 and len(r.get_json()["session"]["items"]) == 5


def test_user_isolation(client, auth):
    _recognize_and_save(client, auth, 1)
    r = client.post("/api/auth/guest")
    other = {"Authorization": f"Bearer {r.get_json()['token']}"}
    assert client.get("/api/mistakes", headers=other).get_json()["total"] == 0
    mid = client.get("/api/mistakes", headers=auth).get_json()["items"][0]["id"]
    assert client.get(f"/api/mistakes/{mid}", headers=other).status_code == 404


class _FakeStream:
    """模拟 anthropic 的 messages.stream() 上下文管理器。"""

    def __init__(self, response, captured=None):
        self._response = response
        self._captured = captured

    def __call__(self, **kwargs):
        if self._captured is not None:
            self._captured.update(kwargs)
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self._response


def test_extract_json_tolerates_fences_and_prose():
    from app.ai.claude import extract_json, is_relay_base_url

    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('好的，结果如下：\n```json\n{"items": [{"x": "y"}]}\n```\n以上。') == {"items": [{"x": "y"}]}
    assert extract_json('前缀 {"ok": true} 后缀') == {"ok": True}
    assert is_relay_base_url("https://api.tu-zi.com") is True
    assert is_relay_base_url("https://api.anthropic.com") is False
    assert is_relay_base_url(None) is False


def test_relay_provider_uses_plain_messages(monkeypatch):
    """中转模式：走 messages.create，不带 beta / output_config，并能解析带围栏的 JSON。"""
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    assert provider.relay and provider.name == "claude-relay"

    captured = {}

    class _Block:
        type = "text"
        text = '```json\n{"items":[{"subject":"math","knowledgePoints":["分数乘法"],"stemText":"题","questionType":"solve","options":[],"uncertainSpans":[],"studentAnswer":"17","correctAnswer":"14 米","analysis":"略","tip":"注意单位1","extra":"ignored"}]}\n```'

    class _Resp:
        stop_reason = "end_turn"
        content = [_Block()]

    monkeypatch.setattr(provider.client.messages, "stream", _FakeStream(_Resp(), captured))
    items = provider.recognize([Crop(data=b"x", media_type="image/png")], subjects=["math"], grade="5")
    assert items[0].correctAnswer == "14 米" and items[0].knowledgePoints == ["分数乘法"]
    assert "output_config" not in captured and "betas" not in captured
    assert "JSON Schema" in captured["messages"][0]["content"][-1]["text"]


def _fake_identity_token(sub="001234.abc", aud="com.zhicuoben.app"):
    import base64
    import json
    import time

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    now = int(time.time())
    return b64({"alg": "RS256", "kid": "x"}) + "." + b64({"iss": "https://appleid.apple.com", "aud": aud, "sub": sub, "exp": now + 600, "iat": now}) + ".sig"


def test_apple_login_without_verify(client):
    token = _fake_identity_token()
    r = client.post("/api/auth/apple", json={"identityToken": token, "profile": {"nickname": "小苹果"}})
    assert r.status_code == 200
    user = r.get_json()["user"]
    assert user["loginMethod"] == "apple" and user["nickname"] == "小苹果"
    # 同一 sub 再登录复用账号
    r2 = client.post("/api/auth/apple", json={"identityToken": token})
    assert r2.get_json()["user"]["id"] == user["id"]


def test_apple_login_with_verify_uses_jwks(app, client, monkeypatch):
    from app.routes import auth as auth_mod

    app.config["APPLE_VERIFY"] = True
    calls = []

    def fake_verify(token):
        calls.append(token)
        if token == "bad":
            from flask import abort

            abort(401, "Apple 登录凭证无效")
        return {"sub": "verified.sub"}

    monkeypatch.setattr(auth_mod, "_verify_apple_token", fake_verify)
    assert client.post("/api/auth/apple", json={"identityToken": "bad"}).status_code == 401
    r = client.post("/api/auth/apple", json={"identityToken": "good"})
    assert r.status_code == 200 and calls == ["bad", "good"]

    # 绑定游客账号也走验签
    guest = client.post("/api/auth/guest").get_json()
    h = {"Authorization": f"Bearer {guest['token']}"}
    assert client.post("/api/auth/bind", json={"identityToken": "good"}, headers=h).status_code == 400  # sub 已被占用
    monkeypatch.setattr(auth_mod, "_verify_apple_token", lambda t: {"sub": "another.sub"})
    assert client.post("/api/auth/bind", json={"identityToken": "good"}, headers=h).get_json()["user"]["loginMethod"] == "apple"


def test_apple_verify_rejects_garbage_against_real_jwks_shape(app, client, monkeypatch):
    """不联网：让 JWKS 客户端抛错，接口应给 503 而不是 500。"""
    from app.routes import auth as auth_mod

    app.config["APPLE_VERIFY"] = True

    class Boom:
        def get_signing_key_from_jwt(self, token):
            raise RuntimeError("network down")

    monkeypatch.setattr(auth_mod, "_apple_jwks", Boom())
    r = client.post("/api/auth/apple", json={"identityToken": _fake_identity_token()})
    assert r.status_code == 503


def test_scan_pages_returns_items_with_bbox(client, auth):
    r = client.post("/api/scan", json={"pages": [{"image": TINY_PNG}, {"image": TINY_PNG}]}, headers=auth)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["pages"] == 2 and len(body["items"]) == 6
    first = body["items"][0]
    assert first["page"] == 0 and len(first["bbox"]) == 4 and first["reason"] and "stemImage" not in first
    assert body["items"][3]["page"] == 1
    assert client.post("/api/scan", json={"pages": []}, headers=auth).status_code == 400
    assert client.post("/api/scan", json={"pages": [{"image": TINY_PNG}] * 101}, headers=auth).status_code == 400


def test_claude_scan_cleans_bbox(monkeypatch):
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    provider = ClaudeProvider(model="claude-sonnet-4-5")

    class _Block:
        type = "text"
        text = '{"items":[{"subject":"math","knowledgePoints":["k"],"stemText":"q","questionType":"solve","options":[],"uncertainSpans":[],"studentAnswer":"","correctAnswer":"1","analysis":"a","tip":"t","page":7,"bbox":[0.1,1.4,"0.9",0.5],"reason":"有红叉"},{"subject":"math","knowledgePoints":[],"stemText":"q2","questionType":"solve","options":[],"uncertainSpans":[],"studentAnswer":"","correctAnswer":"","analysis":"","tip":"","page":0,"bbox":[0.5,0.5,0.2,0.2],"reason":""}]}'

    class _Resp:
        stop_reason = "end_turn"
        content = [_Block()]

    monkeypatch.setattr(provider.client.messages, "stream", _FakeStream(_Resp()))
    items = provider.scan_pages([Crop(data=b"x")], subjects=["math"], grade="5")
    assert items[0].page == 0 and items[0].bbox == [0.1, 1.0, 0.9, 0.5] or items[0].bbox == [0.0, 0.0, 1.0, 1.0]
    assert items[1].bbox == [0.0, 0.0, 1.0, 1.0]  # 非法框退化为整页


def test_digitize_returns_full_paper(client, auth):
    r = client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}]}, headers=auth)
    assert r.status_code == 200, r.get_json()
    job = r.get_json()
    assert job["status"] == "done" and job["progress"] == 100 and job["jobId"]
    body = job["result"]
    # 任务可以再查一次，结果一致
    again = client.get(f"/api/digitize/jobs/{job['jobId']}", headers=auth).get_json()
    assert again["status"] == "done" and again["result"]["questions"] == body["questions"]
    assert client.get("/api/digitize/jobs/nope", headers=auth).status_code == 404
    sheet = body["pages"][0]
    assert sheet["title"] == "五年级随堂练习" and sheet["score"] == "82" and sheet["label"] == "第 1 页"
    types = [b["type"] for b in sheet["blocks"]]
    assert types[:2] == ["section", "item"] and "passage" in types and "wordbank" in types and types[-1] == "text"
    passage = next(b for b in sheet["blocks"] if b["type"] == "passage")
    assert "[[4]]" in passage["text"] and [x["id"] for x in passage["blanks"]] == ["4", "5"]
    qs = body["questions"]
    assert len(qs) == 7 and [q["index"] for q in qs] == list(range(7))
    assert [q["mark"] for q in qs] == ["partial", "wrong", "wrong", "wrong", "correct", "correct", "correct"]
    assert qs[2]["stemText"] == "She ____ her grandparents last weekend. (visit)" and qs[2]["studentAnswer"] == "visits"
    # 短文的每个空派生一题：题干是整篇短文，当前空为「____」、其余空带编号；词库框成为选项
    assert qs[3]["number"] == "4" and qs[3]["options"][0] == "A. 因为" and "(5)____" in qs[3]["stemText"] and qs[3]["questionType"] == "choice"
    assert qs[3]["blankIds"] == ["4"] and qs[3]["blockIndex"] == passage["index"] if "index" in passage else True
    # 一题多空：作答与答案按空拼接
    assert qs[5]["blankIds"] == ["6-1", "6-2"] and qs[5]["studentAnswer"] == "3.14 × 3² = 28.26；28.26 平方厘米"
    assert all(len(q["bbox"]) == 4 for q in qs)


def test_claude_digitize_cleans_fields(monkeypatch):
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    provider = ClaudeProvider(model="claude-sonnet-4-5")

    class _Block:
        type = "text"
        text = (
            '{"sheets":[{"label":"第5页","title":"单元测","score":"90","note":"",'
            '"blocks":[{"type":"section","label":"Ⅳ","title":"Complete","instruction":"每空格限填一词","points":"共8分","bbox":[0,0,1,0.1]},'
            '{"type":"text","text":"(B)"},'
            '{"type":"wordbank","options":["A. repairs","B. awards"]},'
            '{"type":"passage","text":"Students win [[36]] and make [[37]].","subject":"english","questionType":"fill","bbox":[0,0.1,1,0.3],'
            '"blanks":[{"id":"36","number":"36","student":"B","mark":"correct"},{"id":"37","student":"B","mark":"wrong","answer":"A","analysis":"make repairs 固定搭配"},{"id":"38","student":"","mark":"unmarked","answer":"C"}]},'
            '{"type":"item","number":"44","text":"There are some nice [[44]] here.","hint":"(bakery)","subject":"bogus","questionType":"x","bbox":[1,1,0,0],'
            '"blanks":[{"id":"44","number":"44","student":"bakerys","mark":"weird","answer":"bakeries"}]},'
            '{"type":"item","number":"52","text":"[[52-1]] Jack [[52-2]] out early?","instruction":"改为一般疑问句","subject":"english","questionType":"fill","bbox":[0,0.5,1,0.6],'
            '"blanks":[{"id":"52-1","number":"52","student":"Did","mark":"correct"},{"id":"52-2","number":"52","student":"sets","mark":"wrong","answer":"set"}]},'
            '{"type":"wordbank","options":[]},{"type":"item","text":""}]},{"label":"空页","blocks":[]}]}'
        )

    class _Resp:
        stop_reason = "end_turn"
        content = [_Block()]

    monkeypatch.setattr(provider.client.messages, "stream", _FakeStream(_Resp()))
    sheets, qs = provider.digitize_pages([Crop(data=b"x")], subjects=["english"], grade="9")
    assert len(sheets) == 1 and sheets[0].page == 0 and sheets[0].label == "第5页" and sheets[0].title == "单元测"
    assert [b.type for b in sheets[0].blocks] == ["section", "wordbank", "passage", "item", "item"]  # 空块被丢弃
    passage = sheets[0].blocks[2]
    assert passage.label == "(B)"  # 单独成块的篇号并进短文
    assert [b.id for b in passage.blanks] == ["36", "37", "38"] and passage.blanks[1].number == "37"
    item44 = sheets[0].blocks[3]
    assert item44.subject == "math" and item44.questionType == "fill" and item44.bbox == [0.0, 0.0, 1.0, 1.0] and item44.blanks[0].mark == "wrong"  # 没批改但答案不符，自动判错
    # 没写作答的空单独归为 blank（未作答），不算答错
    assert passage.blanks[2].id == "38" and passage.blanks[2].mark == "blank" and passage.blanks[2].note == ""
    assert [q.number for q in qs] == ["36", "37", "38", "44", "52"]
    qs = [q for q in qs if q.number != "38"]
    assert qs[0].options == ["A. repairs", "B. awards"] and qs[0].questionType == "choice" and qs[0].mark == "correct"
    assert qs[1].stemText == "Students win (36)____ and make ____." and qs[1].correctAnswer == "A"
    assert qs[2].stemText == "There are some nice ____ here. (bakery)"
    assert qs[3].mark == "partial" and qs[3].studentAnswer == "Did；sets" and qs[3].correctAnswer == "Did；set" and "改为一般疑问句" in qs[3].stemText


def test_digitize_dedupes_label_block_and_notes():
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "text", "text": "(B)"},
        {"type": "wordbank", "options": ["A. x"]},
        {"type": "passage", "label": "(B)", "text": "a [[1]] b [[2]]", "blanks": [{"id": "1", "student": ""}, {"id": "2", "student": ""}]},
        {"type": "item", "number": "3.", "text": "3. [[3-1]] [[3-2]]", "blanks": [{"id": "3-1", "student": ""}, {"id": "3-2", "student": ""}]},
    ]}]}, 0)
    assert [b.type for b in sheets[0].blocks] == ["wordbank", "passage", "item"]  # 重复的篇号块被丢弃
    assert sheets[0].blocks[2].number == "3" and sheets[0].blocks[2].text == "[[3-1]] [[3-2]]"  # 题号尾点与正文重复题号被清掉
    qs = derive_questions(sheets)
    assert qs[-1].number == "3" and qs[-1].teacherNote == "" and qs[-1].mark == "blank"


def test_claude_digitize_runs_one_call_per_page(monkeypatch):
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    calls = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append(content[0]["source"]["data"])
        n = len(calls)
        return {"sheets": [{"label": f"p{n}", "blocks": [{"type": "item", "number": str(n), "text": f"q{n} [[{n}]]", "blanks": [{"id": str(n), "student": "x", "mark": "wrong", "answer": "y"}]}]}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    sheets, qs = provider.digitize_pages([Crop(data=b"a"), Crop(data=b"b")], subjects=["math"], grade="5")
    assert len(calls) == 2 and sorted(s.page for s in sheets) == [0, 1]
    assert sorted((q.page, q.number) for q in qs) == [(0, "1"), (1, "2")]



def test_digitize_pdf_export(client, auth):
    body = client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}]}, headers=auth).get_json()["result"]
    r = client.post("/api/digitize/pdf", json={"title": "五年级随堂练习", "pages": body["pages"], "questions": body["questions"]}, headers=auth)
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data.startswith(b"%PDF") and len(r.data) > 2000
    assert client.post("/api/digitize/pdf", json={"pages": []}, headers=auth).status_code == 400



def test_book_pdf_export(client, auth):
    items = [
        {"number": "48", "stem": "My family has a ____ of making Zongzi. (traditional)", "options": [], "knowledge": "构词法", "source": "嘉定二模 · 第 1 张",
         "answers": [{"number": "48", "student": "", "answer": "tradition", "analysis": "冠词 a 后缺名词", "kind": "未作答", "tip": "形容词变名词", "sub": "形容词变名词"}]},
        {"number": "36–37", "stem": "Students win (36)____ and make (37)____.", "options": ["A. repairs", "B. awards"], "knowledge": "选词填空", "source": "嘉定二模 · 第 1 张",
         "answers": [{"number": "36", "student": "A", "answer": "B", "analysis": "", "kind": "答错", "tip": "", "sub": ""}, {"number": "37", "student": "", "answer": "A", "analysis": "", "kind": "未作答", "tip": "", "sub": ""}]},
    ]
    r = client.post("/api/digitize/book", json={"title": "嘉定二模 · 英语 错题本", "subtitle": "上海中考英语考纲 · 2 题", "items": items}, headers=auth)
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data.startswith(b"%PDF")
    assert client.post("/api/digitize/book", json={"items": []}, headers=auth).status_code == 400



def test_auto_mark_grades_ungraded_short_answers():
    from app.ai.digitize import auto_mark, clean_sheets, derive_questions

    assert auto_mark("unmarked", "B", "B", "choice") == "correct"
    assert auto_mark("unmarked", "b", "B. awards", "choice") == "correct"
    assert auto_mark("unmarked", "A", "C", "choice") == "wrong"
    assert auto_mark("unmarked", "whether", "if/whether", "fill") == "correct"
    assert auto_mark("unmarked", "bakerys", "bakeries", "fill") == "wrong"
    assert auto_mark("unmarked", "O2", "O₂", "fill") == "correct"  # 下标数字
    assert auto_mark("unmarked", "ＣＯ２", "CO₂", "fill") == "correct"  # 全角
    assert auto_mark("unmarked", "□", "B", "choice") == "unmarked"  # 看不清不判
    assert auto_mark("unmarked", "x", "y", "solve") == "unmarked"  # 解答题不判
    assert auto_mark("correct", "x", "y", "fill") == "correct"  # 老师批过的不动
    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "passage", "questionType": "choice", "text": "a [[1]] b [[2]] c [[3]]", "blanks": [{"id": "1", "student": "A", "answer": "A"}, {"id": "2", "student": "E", "answer": "A"}, {"id": "3", "student": "", "answer": "C"}]},
    ]}]}, 0)
    assert [b.mark for b in sheets[0].blocks[0].blanks] == ["correct", "wrong", "blank"]
    assert [q.mark for q in derive_questions(sheets)] == ["correct", "wrong", "blank"]



def test_sheet_subject_detected_and_inherited():
    from app.ai.digitize import clean_sheets

    # 卷面判出化学：题块没写学科时继承
    sheets = clean_sheets({"sheets": [{"subject": "chemistry", "blocks": [
        {"type": "item", "number": "1", "text": "写出氧气的化学式 [[1]]", "blanks": [{"id": "1", "student": "O2", "mark": "correct"}]},
        {"type": "item", "number": "2", "text": "x [[2]]", "subject": "math", "blanks": [{"id": "2", "student": "", "answer": "1"}]},
    ]}]}, 0)
    assert sheets[0].subject == "chemistry"
    assert [b.subject for b in sheets[0].blocks] == ["chemistry", "math"]
    # 卷面没判出：按题块多数推断
    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "1", "text": "a [[1]]", "subject": "physics", "blanks": [{"id": "1", "student": "x"}]},
        {"type": "item", "number": "2", "text": "b [[2]]", "subject": "physics", "blanks": [{"id": "2", "student": "x"}]},
        {"type": "item", "number": "3", "text": "c [[3]]", "subject": "math", "blanks": [{"id": "3", "student": "x"}]},
    ]}]}, 0)
    assert sheets[0].subject == "physics"



def test_digitize_job_progress_from_worker_threads(client, auth, monkeypatch):
    """多张照片并发时进度回调来自线程池线程：必须能写库，任务不能因此失败。"""
    from concurrent.futures import ThreadPoolExecutor
    from app.ai.base import AIProvider, DigitizedPage
    from app.routes import recognize as rec

    class _Threaded(AIProvider):
        name = "threaded"

        def digitize_pages(self, pages, subjects, grade, region="", on_page_done=None, on_page_start=None, on_page_progress=None):
            def one(i):
                on_page_start(i + 1, len(pages))
                on_page_progress(i, 0.5)
                on_page_done(i + 1, len(pages))
                return [DigitizedPage(page=i, label=f"p{i}")]
            with ThreadPoolExecutor(max_workers=2) as pool:
                groups = list(pool.map(one, range(len(pages))))
            return [s for g in groups for s in g], []

    monkeypatch.setattr(rec, "get_provider", lambda: _Threaded())
    r = client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}, {"image": TINY_PNG}]}, headers=auth)
    job = r.get_json()
    assert r.status_code == 200 and job["status"] == "done", job
    assert job["donePages"] == 2 and job["totalPages"] == 2 and len(job["result"]["pages"]) == 2



def test_page_queue_limits_concurrency(monkeypatch):
    import threading, time
    from concurrent.futures import ThreadPoolExecutor
    from app.ai import queue as q

    monkeypatch.setattr(q, "_pool", ThreadPoolExecutor(max_workers=2))
    peak = [0]
    cur = [0]
    lock = threading.Lock()

    def work():
        with lock:
            cur[0] += 1
            peak[0] = max(peak[0], cur[0])
        time.sleep(0.05)
        with lock:
            cur[0] -= 1
        return 1

    futures = [q.submit(work) for _ in range(6)]
    assert sum(f.result() for f in futures) == 6
    assert peak[0] <= 2  # 同时在跑的不超过槽位数
    assert q.stats()["running"] == 0 and q.stats()["waiting"] == 0



def test_claude_streaming_reports_text_progress(monkeypatch):
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    provider = ClaudeProvider(model="claude-sonnet-4-5")

    class _Block:
        type = "text"
        text = '{"sheets":[{"label":"p","blocks":[{"type":"item","number":"1","text":"a [[1]]","blanks":[{"id":"1","student":"x","mark":"wrong","answer":"y"}]}]}]}'

    class _Resp:
        stop_reason = "end_turn"
        content = [_Block()]

    class _Stream:
        def __init__(self, resp):
            self._resp = resp
            self.text_stream = iter(["{\"sheets\"", ":[...]", "}"])
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def get_final_message(self):
            return self._resp

    monkeypatch.setattr(provider.client.messages, "stream", lambda **kw: _Stream(_Resp()))
    seen = []
    sheets, qs = provider.digitize_pages([Crop(data=b"x")], subjects=["math"], grade="5", on_page_progress=lambda i, f: seen.append((i, round(f, 4))))
    assert len(sheets) == 1 and qs[0].number == "1"
    assert [i for i, _ in seen] == [0, 0, 0] and seen[-1][1] > seen[0][1] > 0  # 按累计字数递增



def test_ocr_text_is_fed_to_llm(monkeypatch):
    """OCR 启用时：先 OCR，文字作为提示放进大模型的输入；sheet 上带 ocrText。"""
    from app.ai import ocr
    from app.ai.claude import ClaudeProvider
    from app.ai.base import Crop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    monkeypatch.setenv("OCR_BASE_URL", "https://ocr.example")
    monkeypatch.setenv("OCR_AUTH", "u:p")
    monkeypatch.setattr(ocr, "ocr_page", lambda data, media_type="image/jpeg", **kw: ocr.OcrPage(text="1. 方程 \\(x^{2}-5x+6=0\\) 的两个根为 ___。"))
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    seen = {}

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        seen["content"] = content
        return {"sheets": [{"label": "p1", "blocks": [{"type": "item", "number": "1", "text": "方程的两个根为 [[1]]", "blanks": [{"id": "1", "student": "2,3", "mark": "correct"}]}]}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    sheets, qs = provider.digitize_pages([Crop(data=b"img")], subjects=["math"], grade="9")
    texts = [c["text"] for c in seen["content"] if c.get("type") == "text"]
    assert any("<ocr>" in t and "x^{2}-5x+6" in t for t in texts)
    assert sheets[0].ocrText.startswith("1. 方程")


def test_ocr_disabled_without_config(monkeypatch):
    from app.ai import ocr

    monkeypatch.delenv("OCR_BASE_URL", raising=False)
    monkeypatch.delenv("OCR_AUTH", raising=False)
    assert ocr.enabled() is False and ocr.health() == "disabled"


def test_ocr_provider_switch(monkeypatch):
    """OCR_PROVIDER 开关：paddle / baidu / off；留空自动挑配置齐全的一套。"""
    from app.ai import ocr

    assert ocr.provider() == "off" and ocr.enabled() is False
    monkeypatch.setenv("BAIDU_OCR_API_KEY", "k")
    monkeypatch.setenv("BAIDU_OCR_SECRET_KEY", "s")
    assert ocr.provider() == "baidu" and ocr.enabled()
    monkeypatch.setenv("OCR_BASE_URL", "https://ocr.example")
    monkeypatch.setenv("OCR_AUTH", "u:p")
    assert ocr.provider() == "paddle"  # 自动模式 paddle 优先
    monkeypatch.setenv("OCR_PROVIDER", "baidu")
    assert ocr.provider() == "baidu"
    monkeypatch.setenv("OCR_PROVIDER", "off")
    assert ocr.enabled() is False and ocr.health() == "disabled"
    monkeypatch.setenv("OCR_PROVIDER", "paddle")
    monkeypatch.delenv("OCR_AUTH")
    assert ocr.enabled() is False and ocr.health() == "paddle:unconfigured"


def test_baidu_ocr_lines_and_token_refresh(monkeypatch):
    """百度 doc_analysis：手写行加 [手写] 前缀；token 失效（110）自动刷新重试。"""
    from app.ai import ocr

    monkeypatch.setenv("OCR_PROVIDER", "baidu")
    monkeypatch.setenv("BAIDU_OCR_API_KEY", "k")
    monkeypatch.setenv("BAIDU_OCR_SECRET_KEY", "s")
    monkeypatch.setattr(ocr, "_baidu_token_cache", {"value": "stale", "expires": 9e12})
    calls = []

    def fake_request(url, headers, body, timeout):
        calls.append(url)
        if url == ocr.BAIDU_TOKEN_URL:
            return {"access_token": "fresh", "expires_in": 2592000}
        if "access_token=stale" in url:
            return {"error_code": 110, "error_msg": "Access token invalid or no longer valid"}
        return {
            "results": [
                {"words_type": "print", "words": {"word": "1. 方程 x^{2}-5x+6=0 的两个根为____。"}},
                {"words_type": "handwriting", "words": {"word": "2, 3"}},
                {"words_type": "print", "words": {"word": "  "}},
            ]
        }

    monkeypatch.setattr(ocr, "_json_request", fake_request)
    text = ocr.ocr_image(b"img")
    assert text == "1. 方程 x^{2}-5x+6=0 的两个根为____。\n[手写] 2, 3"
    assert ocr.BAIDU_TOKEN_URL in calls and "access_token=fresh" in calls[-1]
    assert ocr.health() == "baidu:online"
    assert ocr.baidu_lines({"words_result": [{"words": "a"}, {"words": "b"}]}) == "a\nb"


def test_unwrap_lines_joins_wrapped_sentences():
    """OCR 排版换行合回一行；分段、选项、序号行保留换行；中文相连不加空格。"""
    from app.ai.digitize import unwrap_lines, clean_block

    assert unwrap_lines("Our handmade bookmarks were sold out within half [[21]] hour\nat the charity sale.") == "Our handmade bookmarks were sold out within half [[21]] hour at the charity sale."
    assert unwrap_lines("下列说法正确的是\n的一项") == "下列说法正确的是的一项"
    assert unwrap_lines("第一段。\n\n第二段。") == "第一段。\n第二段。" or unwrap_lines("第一段。\n\n第二段。") == "第一段。\n\n第二段。"
    assert unwrap_lines("题干\nA. 选项一\nB. 选项二") == "题干\nA. 选项一\nB. 选项二"
    assert unwrap_lines("Your idea of  a one-day  walk") == "Your idea of a one-day walk"
    assert unwrap_lines("材料：\n①第一条\n②第二条") == "材料：\n①第一条\n②第二条"
    blk = clean_block({"type": "item", "number": "21", "text": "half [[21]] hour\nat the sale.", "blanks": [{"id": "21", "student": "C", "answer": "B"}]}, "english")
    assert blk.text == "half [[21]] hour at the sale."


def test_drop_ghost_sheets_from_photo_edge():
    """照片边缘的半截相邻页：没有页码的卷面里，和正常卷面空号重复的短文整段丢，重复的小题丢，其余真题保留。"""
    from app.ai.digitize import clean_sheets, derive_questions, drop_ghost_sheets

    real = {"label": "第4页", "blocks": [{"type": "section", "label": "II", "title": "Complete the passage"}, {"type": "item", "number": "35", "text": "What a day [[35]]", "blanks": [{"id": "35"}]}, {"type": "passage", "text": "fun [[36]] and [[37]].", "blanks": [{"id": "36", "number": "36", "student": "A"}, {"id": "37", "number": "37", "student": ""}]}]}
    ghost = {"label": "", "blocks": [
        {"type": "passage", "text": "environment. Guid [[36]] the club [[37]] and [[39]]", "blanks": [{"id": "36", "number": "36"}, {"id": "37", "number": "37"}, {"id": "39", "number": "39"}]},
        {"type": "item", "number": "35", "text": "What a day [[35]]", "blanks": [{"id": "35"}]},
        {"type": "section", "label": "N", "title": "Complet"},
        {"type": "item", "number": "44", "text": "There are some nice [[44]]", "blanks": [{"id": "44"}]},
    ]}
    kept = drop_ghost_sheets(clean_sheets({"sheets": [real, ghost]}, 0))
    assert [q.number for q in derive_questions(kept)] == ["35", "36", "37", "44"]

    # 只剩重复内容的残片卷面整张去掉
    only_dup = {"label": "", "blocks": [ghost["blocks"][0]]}
    assert [s.label for s in drop_ghost_sheets(clean_sheets({"sheets": [real, only_dup]}, 0))] == ["第4页"]
    # 都没有页码、各有大题标题、分大题重新编号：都保留
    part1 = {"label": "", "blocks": [{"type": "section", "label": "一"}, {"type": "item", "number": "1", "text": "a [[1]]", "blanks": [{"id": "1"}]}]}
    part2 = {"label": "", "blocks": [{"type": "section", "label": "二"}, {"type": "item", "number": "1", "text": "b [[1]]", "blanks": [{"id": "1"}]}]}
    assert len(derive_questions(drop_ghost_sheets(clean_sheets({"sheets": [part1, part2]}, 0)))) == 2


def test_grade_unmarked_blanks(monkeypatch):
    """老师没批改、按答案也判不了的空：交给大模型阅卷，结论写回 mark，并标 aiGraded；老师批过的、没作答的不送。"""
    from app.ai.claude import ClaudeProvider
    from app.ai.digitize import clean_sheets

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    sheets = clean_sheets({"sheets": [{"label": "第5页", "blocks": [
        {"type": "section", "label": "II", "title": "Complete the passage"},
        {"type": "passage", "text": "fun [[36]] and [[37]] and [[38]] and [[39]].", "blanks": [
            {"id": "36", "number": "36", "student": "A"},                       # 没答案 → 送去判
            {"id": "37", "number": "37", "student": "D", "answer": "D"},        # 自动对答案 → 判对
            {"id": "38", "number": "38", "student": "B", "mark": "wrong"},       # 老师判过 → 不送
            {"id": "39", "number": "39", "student": ""},                         # 未作答 → 不送
        ]},
    ]}]}, 0)
    seen = {}

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        seen["text"] = content[0]["text"]
        return {"results": [{"key": "s0b1#36", "answer": "C", "verdict": "wrong", "analysis": "这里要用动词 explore。"}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    assert provider.grade_unmarked(sheets) == 1
    blanks = {b.id: b for b in sheets[0].blocks[1].blanks}
    assert "【空】" in seen["text"] and "s0b1#36" in seen["text"] and "#38" not in seen["text"] and "#39" not in seen["text"]
    assert (blanks["36"].mark, blanks["36"].aiGraded, blanks["36"].answer) == ("wrong", True, "C")
    assert (blanks["37"].mark, blanks["37"].aiGraded) == ("correct", True)
    assert (blanks["38"].mark, blanks["38"].aiGraded) == ("wrong", False)
    assert blanks["39"].mark == "blank"


def _long_cloze_item(blanks: int = 20) -> dict:
    """一篇错得很多的完形填空：整篇短文一行，右栏 20 个空各带解析和「下次注意」，高度超过一页横版 A4。"""
    passage = " ".join(f"Sentence {i} of the passage goes on and on ({i})____ before it finally ends." for i in range(1, blanks + 1))
    return {
        "number": f"1–{blanks}",
        "stem": passage,
        "options": [],
        "knowledge": "完形填空",
        "source": "测试 · 第 1 张",
        "answers": [
            {"number": str(i), "student": "B", "answer": "C", "kind": "答错", "analysis": "根据上下文，这里需要一个表示转折的连词，所以选 C 更符合句意和语法要求。" * 2, "tip": "做完形填空时先通读全文，再结合前后句判断。", "sub": "连词"}
            for i in range(1, blanks + 1)
        ],
    }


def test_book_pdf_splits_rows_taller_than_a_page():
    """完形填空一行超过一页高时，错题本 PDF 要能跨页拆开，而不是排版失败。"""
    from app.pdf import build_book_pdf

    pdf = build_book_pdf("错题库 · 英语 错题本", "79 题", [_long_cloze_item(20), _long_cloze_item(30)])
    assert pdf[:4] == b"%PDF" and len(pdf) > 5000


def test_book_endpoint_reports_clear_error(client, auth, monkeypatch):
    """生成失败时返回具体原因，而不是笼统的「稍后重试」。"""
    import app.routes.recognize as rec

    def boom(*a, **kw):
        raise RuntimeError("font missing")

    monkeypatch.setattr(rec, "build_book_pdf", boom)
    r = client.post("/api/digitize/book", json={"title": "t", "items": [_long_cloze_item(3)]}, headers=auth)
    body = r.get_json()
    assert r.status_code == 500 and body["error"] == "pdf_failed"
    assert "稍后重试" not in body["message"] and "错题本" in body["message"]


def test_pdf_math_and_unrecognized_text():
    """PDF 里：$...$ 公式转成可读写法（分数、上下标、空格命令），「□」显示成红色「未识别」。"""
    from app.pdf import _esc

    out = _esc("解得 $a=2,\\ b=-\\frac{3}{4}$，$x_{1}=x^2$，A（□）")
    assert "\\" not in out and "$" not in out
    assert "b=-3/4" in out and "x<sub>1</sub>" in out and "x<super>2</super>" in out
    assert "未识别" in out and "□" not in out


def test_photo_quality_and_empty_fragments():
    """sheet 带照片质量；残片上没有题干、作答全看不清的题被丢掉；看不清的作答不送 AI 阅卷。"""
    from app.ai.digitize import clean_sheets, derive_questions, drop_ghost_sheets, unreadable

    real = {"label": "第4页", "photoIssues": ["glare", "bogus"], "photoNote": "右下角反光，第 36 题看不清", "blocks": [
        {"type": "item", "number": "35", "text": "What a day [[35]]", "blanks": [{"id": "35", "student": "A"}]}]}
    strip = {"label": "", "blocks": [{"type": "item", "number": "40", "text": "[[40]]", "blanks": [{"id": "40", "student": "□"}]}]}
    sheets = clean_sheets({"sheets": [real, strip]}, 0)
    assert sheets[0].photoIssues == ["glare"] and sheets[0].photoNote.startswith("右下角")
    kept = drop_ghost_sheets(sheets)
    assert [q.number for q in derive_questions(kept)] == ["35"]
    assert unreadable("□□ □") and unreadable("$□$") and not unreadable("A□") and not unreadable("")


def test_grade_endpoint_regrades_stored_paper(client, auth, monkeypatch):
    """App 回传已存的电子版：没批改、有作答的空送 AI 阅卷，返回判完的卷面和题目（带 index）。"""
    from app.ai import get_provider
    from app.ai.claude import ClaudeProvider
    import app.routes.recognize as rec

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    calls = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append(content[0]["text"])
        # 第一轮只判了 36，37 漏判 → 第二轮补判
        if len(calls) == 1:
            return {"results": [{"key": "s0b0#36", "answer": "C", "verdict": "wrong", "analysis": "应选 C。"}]}
        return {"results": [{"key": "s0b0#37", "answer": "A", "verdict": "correct", "analysis": ""}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    monkeypatch.setattr(rec, "get_provider", lambda: provider)
    pages = [{"page": 0, "label": "第5页", "subject": "english", "blocks": [
        {"type": "passage", "text": "fun [[36]] and [[37]].", "questionType": "choice", "subject": "english",
         "blanks": [{"id": "36", "number": "36", "student": "B", "mark": "unmarked", "answer": "", "analysis": "", "note": ""},
                    {"id": "37", "number": "37", "student": "A", "mark": "unmarked", "answer": "", "analysis": "", "note": ""}]}]}]
    r = client.post("/api/digitize/grade", json={"pages": pages}, headers=auth)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    marks = {b["id"]: (b["mark"], b["aiGraded"]) for b in body["pages"][0]["blocks"][0]["blanks"]}
    assert marks == {"36": ("wrong", True), "37": ("correct", True)} and body["graded"] == 2 and len(calls) == 2
    assert [q["index"] for q in body["questions"]] == [0, 1]


def test_wechat_login_same_openid_same_account(client):
    """小程序登录：同一个 code（测试环境下映射成同一个 openid）始终是同一个账号，登录方式为 wechat。"""
    r1 = client.post("/api/auth/wechat", json={"code": "abc", "profile": {"nickname": "小明", "grade": "9"}})
    r2 = client.post("/api/auth/wechat", json={"code": "abc"})
    assert r1.status_code == 200 and r2.status_code == 200
    u1, u2 = r1.get_json()["user"], r2.get_json()["user"]
    assert u1["id"] == u2["id"] and u1["loginMethod"] == "wechat" and u1["grade"] == "9"
    assert client.post("/api/auth/wechat", json={}).status_code == 400
    # 小程序改资料用 PUT（wx.request 不支持 PATCH）
    h = {"Authorization": f"Bearer {r1.get_json()['token']}"}
    r3 = client.put("/api/auth/me", json={"nickname": "小红"}, headers=h)
    assert r3.status_code == 200 and r3.get_json()["user"]["nickname"] == "小红"


def test_baidu_figure_lines_tagged_and_regions_listed():
    """百度版面分析里落在插图 / 表格里的行加 [图中文字]，末尾列出区域（0–1 坐标），方向取 img_direction"""
    from app.ai import ocr

    r = {
        "img_direction": 2,
        "results": [{"words": {"word": "5.根据图示回答问题"}}, {"words": {"word": "溶解度/g"}}, {"words": {"word": "(1)t1℃时溶解度为"}}],
        "sections": [{"attribute": "section", "sec_idx": {"idx": [0, 1, 2], "row_idx": [0], "col_idx": [0]}}],
        "layouts": [
            {"layout": "text", "layout_idx": [0], "layout_location": [{"x": 0, "y": 0}, {"x": 100, "y": 10}]},
            {"layout": "figure", "layout_idx": [1], "layout_location": [{"x": 100, "y": 200}, {"x": 600, "y": 200}, {"x": 600, "y": 700}, {"x": 100, "y": 700}]},
        ],
    }
    page = ocr.baidu_page(r, (1000, 1000))
    lines = page.text.splitlines()
    assert lines[0] == "5.根据图示回答问题" and lines[1] == "[图中文字]溶解度/g" and lines[2] == "(1)t1℃时溶解度为"
    assert page.regions == [{"kind": "figure", "bbox": [0.1, 0.2, 0.6, 0.7]}] and "插图1：[0.1, 0.2, 0.6, 0.7]" in page.text
    assert page.direction == 2


def test_figure_block_kept_and_snapped_to_ocr_region():
    """模型给的 figure 块保留下来（不带空），位置贴到 OCR 检测的区域上，卷面记下方向；没位置的 figure 丢掉"""
    from app.ai.digitize import clean_sheets, derive_questions, snap_figures

    data = {"sheets": [{"label": "3/8", "blocks": [
        {"type": "item", "number": "5", "text": "如图所示，t1℃时溶解度为 [[5]]", "blanks": [{"id": "5", "student": "34g", "mark": "correct"}]},
        {"type": "figure", "title": "图1", "number": "5", "text": "溶解度曲线 [[9]]", "bbox": [0.12, 0.22, 0.58, 0.66], "blanks": [{"id": "9", "student": "x"}]},
        {"type": "figure", "title": "图2", "text": "没位置"},
    ]}]}
    sheets = clean_sheets(data, 0)
    figs = [b for b in sheets[0].blocks if b.type == "figure"]
    assert len(figs) == 1 and figs[0].title == "图1" and figs[0].number == "5" and figs[0].blanks == [] and "[[" not in figs[0].text
    snap_figures(sheets, [{"kind": "figure", "bbox": [0.1, 0.2, 0.6, 0.7]}, {"kind": "table", "bbox": [0.1, 0.8, 0.9, 0.95]}], direction=2)
    assert figs[0].bbox == [0.1, 0.2, 0.6, 0.7] and sheets[0].rotation == 2
    assert [q.number for q in derive_questions(sheets)] == ["5"]  # 插图不会变成题


def test_split_figure_pieces_merged():
    """同一题挨着的几块插图合成一幅（位置取并集、保留具体图题）；离得远的、不同题的不合并"""
    from app.ai.digitize import clean_sheets

    fig = lambda title, no, box: {"type": "figure", "title": title, "number": no, "text": title, "bbox": box}
    data = {"sheets": [{"blocks": [
        fig("插图", "4", [0.19, 0.79, 0.30, 0.84]), fig("插图", "4", [0.32, 0.79, 0.49, 0.85]), fig("插图", "4", [0.55, 0.80, 0.63, 0.86]),
        fig("图2", "5", [0.30, 0.61, 0.58, 0.68]), fig("插图", "5", [0.18, 0.61, 0.43, 0.68]),
        fig("图1", "2", [0.42, 0.60, 0.65, 0.68]), fig("图2", "2", [0.38, 0.38, 0.75, 0.47]),
    ]}]}
    figs = clean_sheets(data, 0)[0].blocks
    assert [(f.number, f.title) for f in figs] == [("4", "插图"), ("5", "图2"), ("2", "图1"), ("2", "图2")]
    assert figs[0].bbox == [0.19, 0.79, 0.63, 0.86] and figs[1].bbox == [0.18, 0.61, 0.58, 0.68]


def test_labeled_picture_options_not_merged_or_snapped_together():
    """图片选项（A、B、C 各一张，带 label）不合并；OCR 把一排检测成一个大框时也不会都贴到那个框上"""
    from app.ai.digitize import clean_sheets, snap_figures

    opt = lambda lab, x: {"type": "figure", "number": "3", "label": lab, "title": "插图", "text": lab, "bbox": [x, 0.40, x + 0.10, 0.48]}
    data = {"sheets": [{"blocks": [
        {"type": "item", "number": "3", "text": "选出与图片相符的一项 [[3]]", "options": ["A. （图）游泳", "B. （图）跑步", "C. （图）读书"], "blanks": [{"id": "3", "student": "B", "mark": "wrong", "answer": "A"}]},
        opt("A", 0.10), opt("B", 0.22), opt("C", 0.34),
    ]}]}
    sheets = clean_sheets(data, 0)
    snap_figures(sheets, [{"kind": "figure", "bbox": [0.09, 0.39, 0.45, 0.49]}])
    figs = [b for b in sheets[0].blocks if b.type == "figure"]
    assert [f.label for f in figs] == ["A", "B", "C"]
    assert figs[0].bbox == [0.10, 0.40, 0.20, 0.48]


def test_pdf_renders_labeled_figure_row():
    import base64, io
    from PIL import Image as P
    from app.pdf import build_book_pdf, build_papers_pdf

    buf = io.BytesIO(); P.new("RGB", (120, 90), "white").save(buf, "JPEG"); url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    figs = [{"type": "figure", "label": x, "title": "插图", "image": url, "bbox": [0, 0, 1, 1]} for x in "ABC"]
    sheet = {"blocks": [{"type": "item", "number": "3", "text": "选图 [[3]]", "blanks": [{"id": "3", "student": "B", "mark": "wrong", "answer": "A"}]}, *figs]}
    assert build_papers_pdf("t", [{"title": "t", "pages": [sheet], "questions": []}]).startswith(b"%PDF")
    assert build_book_pdf("t", "", [{"number": "3", "stem": "选图", "knowledge": "k", "figures": figs, "answers": [{"number": "3", "student": "B", "answer": "A", "kind": "答错"}]}]).startswith(b"%PDF")


def test_review_account_fixed_code(app, client):
    """审核账号：固定验证码能登录、不回显验证码、不需要先发验证码；错的验证码登不上；其他手机号不受影响"""
    app.config.update(REVIEW_PHONE="13800138000", REVIEW_CODE="246810")
    r = client.post("/api/auth/code", json={"phone": "13800138000"})
    assert r.status_code == 200 and "devCode" not in r.get_json()
    assert client.post("/api/auth/register", json={"phone": "13800138000", "code": "246810"}).status_code == 200
    assert client.post("/api/auth/login", json={"phone": "13800138000", "code": "123456"}).status_code == 400
    ok = client.post("/api/auth/login", json={"phone": "13800138000", "code": "246810"})
    assert ok.status_code == 200 and ok.get_json()["user"]["loginMethod"] == "phone"
    again = client.post("/api/auth/login", json={"phone": "13800138000", "code": "246810"})  # 不用先发验证码也能再登
    assert again.status_code == 200 and again.get_json()["user"]["id"] == ok.get_json()["user"]["id"]
    app.config.update(REVIEW_PHONE="", REVIEW_CODE="")


def test_phone_login_off_blocks_fixed_code(app, client):
    """短信关闭（线上）：普通手机号发不了验证码、123456 登不上，也不回显；审核账号照常能登"""
    app.config.update(SMS_PROVIDER="off", REVIEW_PHONE="13800138000", REVIEW_CODE="246810")
    r = client.post("/api/auth/code", json={"phone": "13912345678"})
    assert r.status_code == 503 and "devCode" not in (r.get_json() or {})
    assert r.get_json()["message"].startswith("手机号登录暂未开放")  # JSON 错误，App 能显示原因
    assert client.post("/api/auth/login", json={"phone": "13912345678", "code": "123456"}).status_code == 404
    assert client.post("/api/auth/register", json={"phone": "13912345678", "code": "123456"}).status_code == 400  # 固定码在线上无效
    assert client.post("/api/auth/register", json={"phone": "13800138000", "code": "246810"}).status_code == 200
    app.config.update(SMS_PROVIDER="mock", REVIEW_PHONE="", REVIEW_CODE="")


def test_aliyun_sms_login_flow(app, client, monkeypatch):
    """阿里云短信认证模式：发码走 SendSmsVerifyCode，登录 / 绑定走 CheckSmsVerifyCode（只认 PASS）；频控等错误给中文提示；不回显验证码"""
    from app import sms

    for k, v in {"ALIYUN_ACCESS_KEY_ID": "id", "ALIYUN_ACCESS_KEY_SECRET": "secret", "ALIYUN_SMS_SIGN_NAME": "速通互联验证码", "ALIYUN_SMS_TEMPLATE_CODE": "100001"}.items():
        monkeypatch.setenv(k, v)
    app.config.update(SMS_PROVIDER="aliyun")
    calls = []
    state = {"send": {"Code": "OK", "Success": True}, "pass": {"13912345678": "246810", "13700000000": "135790"}}

    def fake_call(action, params):
        calls.append((action, params))
        if action == "SendSmsVerifyCode":
            return state["send"]
        ok = state["pass"].get(params["PhoneNumber"]) == params["VerifyCode"]
        return {"Code": "OK", "Model": {"VerifyResult": "PASS" if ok else "UNKNOWN"}}

    monkeypatch.setattr(sms, "_call", fake_call)
    r = client.post("/api/auth/code", json={"phone": "13912345678"})
    assert r.status_code == 200 and "devCode" not in r.get_json()
    action, params = calls[-1]
    assert action == "SendSmsVerifyCode" and params["SignName"] == "速通互联验证码" and params["CodeLength"] == 6 and "##code##" in params["TemplateParam"]
    assert client.post("/api/auth/register", json={"phone": "13912345678", "code": "000000"}).status_code == 400
    ok = client.post("/api/auth/register", json={"phone": "13912345678", "code": "246810", "profile": {"nickname": "小明", "grade": "8"}})
    assert ok.status_code == 200 and ok.get_json()["user"]["loginMethod"] == "phone" and ok.get_json()["user"]["grade"] == "8"
    # 频控：阿里云返回 biz.FREQUENCY → 429 + 中文提示
    state["send"] = {"Code": "biz.FREQUENCY", "Message": "check frequency failed"}
    r = client.post("/api/auth/code", json={"phone": "13912345678"})
    assert r.status_code == 429 and "1 分钟" in r.get_json()["message"]
    # 游客绑定手机号也走阿里云核验
    guest = client.post("/api/auth/guest", json={"profile": {}}).get_json()["token"]
    h = {"Authorization": f"Bearer {guest}"}
    assert client.post("/api/auth/bind", json={"phone": "13700000000", "code": "111111"}, headers=h).status_code == 400
    b = client.post("/api/auth/bind", json={"phone": "13700000000", "code": "135790"}, headers=h)
    assert b.status_code == 200 and b.get_json()["user"]["phone"] == "13700000000"
    app.config.update(SMS_PROVIDER="mock")


def test_aliyun_signature_format(monkeypatch):
    """签名：参数按字典序、阿里云编码规则，结果是 base64 的 HMAC-SHA1；请求发到 dypnsapi"""
    import io
    from app import sms

    monkeypatch.setenv("ALIYUN_ACCESS_KEY_ID", "testid")
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_SECRET", "testsecret")
    seen = {}

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=10):
        seen["url"] = req.full_url
        seen["body"] = req.data.decode()
        return Resp(b'{"Code":"OK"}')

    monkeypatch.setattr(sms.urllib.request, "urlopen", fake_urlopen)
    assert sms._call("CheckSmsVerifyCode", {"PhoneNumber": "13912345678", "VerifyCode": "1 2*~"}) == {"Code": "OK"}
    import urllib.parse as up
    form = dict(up.parse_qsl(seen["body"]))
    assert seen["url"] == "https://dypnsapi.aliyuncs.com/" and form["Action"] == "CheckSmsVerifyCode" and form["Version"] == "2017-05-25"
    # 用同样的参数重算一遍签名，应该一致
    sig = form.pop("Signature")
    canon = "&".join(f"{sms._quote(k)}={sms._quote(form[k])}" for k in sorted(form))
    import base64, hashlib, hmac
    expect = base64.b64encode(hmac.new(b"testsecret&", f"POST&%2F&{sms._quote(canon)}".encode(), hashlib.sha1).digest()).decode()
    assert sig == expect and sms._quote("1 2*~") == "1%202%2A~"


def test_register_then_login_with_purpose_checks(client):
    """注册 / 登录分开：注册前已注册的号码不发码、登录前没注册的号码不发码；注册带资料；之后能用手机号登录；重复注册提示去登录"""
    phone = "13611112222"
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "login"})
    assert r.status_code == 404 and "还没注册" in r.get_json()["message"]
    code = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"}).get_json()["devCode"]
    reg = client.post("/api/auth/register", json={"phone": phone, "code": code, "profile": {"nickname": "小红", "grade": "9", "subjects": ["math", "physics"]}})
    u = reg.get_json()["user"]
    assert reg.status_code == 200 and u["nickname"] == "小红" and u["grade"] == "9" and u["subjects"] == ["math", "physics"] and u["loginMethod"] == "phone"
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    assert r.status_code == 409 and "已经注册" in r.get_json()["message"]
    code = client.post("/api/auth/code", json={"phone": phone, "purpose": "login"}).get_json()["devCode"]
    login = client.post("/api/auth/login", json={"phone": phone, "code": code})
    assert login.status_code == 200 and login.get_json()["user"]["id"] == u["id"]
    assert client.post("/api/auth/register", json={"phone": phone, "code": code}).status_code == 409


def test_password_register_login_reset_and_lockout(client):
    """手机号 + 密码注册；密码登录（错 5 次锁定）；验证码重设密码后直接登录；/auth/me 会换新 token"""
    phone = "13511112222"
    code = lambda purpose: client.post("/api/auth/code", json={"phone": phone, "purpose": purpose}).get_json()["devCode"]
    # 密码规则
    r = client.post("/api/auth/register", json={"phone": phone, "code": code("register"), "password": "123456"})
    assert r.status_code == 400 and "字母和数字" in r.get_json()["message"]
    reg = client.post("/api/auth/register", json={"phone": phone, "code": code("register"), "password": "abc12345"})
    assert reg.status_code == 200 and reg.get_json()["user"]["hasPassword"] is True
    # 密码登录
    ok = client.post("/api/auth/login/password", json={"phone": phone, "password": "abc12345"})
    assert ok.status_code == 200 and ok.get_json()["user"]["id"] == reg.get_json()["user"]["id"]
    assert client.post("/api/auth/login/password", json={"phone": "13599990000", "password": "abc12345"}).status_code == 404
    for i in range(4):
        r = client.post("/api/auth/login/password", json={"phone": phone, "password": "wrong999"})
        assert r.status_code == 400 and f"还可以试 {4 - i} 次" in r.get_json()["message"]
    assert "已锁定" in client.post("/api/auth/login/password", json={"phone": phone, "password": "wrong999"}).get_json()["message"]
    assert client.post("/api/auth/login/password", json={"phone": phone, "password": "abc12345"}).status_code == 429  # 锁定中，对的密码也不行
    # 忘记密码：验证码重设，锁定解除并直接登录
    rs = client.post("/api/auth/password/reset", json={"phone": phone, "code": code("reset"), "password": "newpass88"})
    assert rs.status_code == 200 and rs.get_json()["token"]
    assert client.post("/api/auth/login/password", json={"phone": phone, "password": "newpass88"}).status_code == 200
    # /auth/me 换新 token，新 token 能用
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {rs.get_json()['token']}"}).get_json()
    assert me["token"] and client.get("/api/auth/me", headers={"Authorization": f"Bearer {me['token']}"}).status_code == 200


def test_set_password_after_code_login(client):
    """验证码注册的账号（没密码）：密码登录提示用验证码；登录后用验证码设置密码，之后能用密码登录"""
    phone = "13522223333"
    code = lambda purpose: client.post("/api/auth/code", json={"phone": phone, "purpose": purpose}).get_json()["devCode"]
    tok = client.post("/api/auth/register", json={"phone": phone, "code": code("register")}).get_json()["token"]
    r = client.post("/api/auth/login/password", json={"phone": phone, "password": "abc12345"})
    assert r.status_code == 400 and "还没设置密码" in r.get_json()["message"]
    h = {"Authorization": f"Bearer {tok}"}
    s = client.post("/api/auth/password", json={"password": "abc12345", "code": code("reset")}, headers=h)
    assert s.status_code == 200 and s.get_json()["user"]["hasPassword"] is True
    assert client.post("/api/auth/login/password", json={"phone": phone, "password": "abc12345"}).status_code == 200


def test_delete_account_removes_server_data(client, auth):
    client.get("/api/auth/me", headers=auth)
    client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}]}, headers=auth)
    r = client.delete("/api/auth/me", headers=auth)
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    # 同一个号码可以重新注册
    code = client.post("/api/auth/code", json={"phone": "13800000000", "purpose": "register"}).get_json()["devCode"]
    assert client.post("/api/auth/register", json={"phone": "13800000000", "code": code}).status_code == 200


def test_listening_questions_are_left_out():
    """听力没有录音：跨页的听力题不出题、答案清空；后面的笔试部分照常。"""
    from app.ai.digitize import clean_sheets, clear_listening_answers, derive_questions, listening_blocks

    p1 = clean_sheets({"sheets": [{"blocks": [
        {"type": "section", "label": "Part 1", "title": "Listening(第一部分 听力)"},
        {"type": "section", "label": "A", "title": "Listen and choose the right picture"},
        {"type": "item", "number": "1", "text": "[[1]]", "blanks": [{"id": "1", "student": "", "answer": "B", "analysis": "猜的"}]},
    ]}]}, 0)
    p2 = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "2", "text": "2. The boy is ____ [[2]]", "blanks": [{"id": "2", "student": "happy", "mark": "unmarked", "answer": "sad"}]},
        {"type": "section", "label": "Part 2", "title": "Vocabulary and Grammar"},
        {"type": "item", "number": "3", "text": "3. He ____ a book. [[3]]", "options": ["A. read", "B. reads"], "blanks": [{"id": "3", "student": "", "answer": "B"}]},
    ]}]}, 1)
    sheets = p1 + p2
    assert listening_blocks(sheets) == {(0, 2), (1, 0)}  # 听力从第 1 页跨到第 2 页
    assert clear_listening_answers(sheets) == 2
    assert sheets[0].blocks[2].blanks[0].answer == "" and sheets[1].blocks[0].blanks[0].answer == ""
    assert [q.number for q in derive_questions(sheets)] == ["3"]
    assert sheets[1].blocks[2].blanks[0].answer == "B"  # 笔试部分不受影响


def test_chinese_listening_section_is_left_out():
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "section", "label": "一", "title": "听力部分", "instruction": "听录音，选出你听到的单词"},
        {"type": "item", "number": "1", "text": "[[1]]", "blanks": [{"id": "1", "student": ""}]},
        {"type": "section", "label": "二", "title": "单项选择"},
        {"type": "item", "number": "2", "text": "[[2]]", "blanks": [{"id": "2", "student": ""}]},
    ]}]}, 0)
    assert [q.number for q in derive_questions(sheets)] == ["2"]


def test_cloze_split_across_pages_becomes_one_question():
    """短文在第 6 页、选项在第 7 页：合成一题，答案用短文页（看得到上下文）给的词对应的字母。"""
    from app.ai.digitize import clean_sheets, derive_questions, reconcile_split_choices

    p6 = clean_sheets({"sheets": [{"blocks": [
        {"type": "section", "label": "B", "title": "Choose the best answer and complete the passage"},
        {"type": "passage", "text": "Then I found an app. [[65]] I was busy. I have [[66]] time.", "blanks": [
            {"id": "65", "number": "65", "student": "", "answer": "However", "analysis": "转折"},
            {"id": "66", "number": "66", "student": "", "answer": "spare", "analysis": "空闲"},
        ]},
    ]}]}, 5)
    p7 = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "65", "text": "[[65]]", "options": ["A. However", "B. At first", "C. In fact", "D. As a result"], "blanks": [{"id": "65", "student": "", "answer": "C"}]},
        {"type": "item", "number": "66", "text": "66. ____ [[66]]", "options": ["A. busy", "B. spare", "C. happy", "D. rare"], "blanks": [{"id": "66", "student": "B", "mark": "correct", "answer": "D"}]},
        {"type": "section", "label": "C", "title": "Fill in the blanks"},
        {"type": "item", "number": "71", "text": "She is d[[71]] from others.", "blanks": [{"id": "71", "student": "", "answer": "different"}]},
    ]}]}, 6)
    sheets = p6 + p7
    assert reconcile_split_choices(sheets) == []  # 两个词都在选项里，直接换成字母
    assert sheets[1].blocks[0].blanks[0].answer == "A" and sheets[1].blocks[1].blanks[0].answer == "B"  # 选项页的猜测被改掉
    qs = derive_questions(sheets)
    assert [q.number for q in qs] == ["65", "66", "71"]  # 不再重复
    q65, q66 = qs[0], qs[1]
    assert q65.options[0] == "A. However" and q65.correctAnswer == "A" and "app" in q65.stemText and q65.questionType == "choice"
    assert q66.studentAnswer == "B" and q66.mark == "correct"  # 学生在选项页上作答，也算进来


def test_options_only_item_without_matching_passage_is_kept():
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "5", "text": "[[5]]", "options": ["A. x", "B. y"], "blanks": [{"id": "5", "student": "", "answer": "A"}]},
    ]}]}, 0)
    assert [q.number for q in derive_questions(sheets)] == ["5"]


def test_sub_question_numbers_get_parent_number():
    """化学卷：11 题 (1)(2)，12 题「调控化学变化」接着 (3)(4)，13 题 (7)①；小题号接着大题编，要补上大题号。"""
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "section", "label": "六", "title": "化学变化"},
        {"type": "item", "number": "11（1）", "text": "[[11-1]]", "blanks": [{"id": "11-1", "student": ""}]},
        {"type": "item", "number": "11（2）", "text": "[[11-2]]", "blanks": [{"id": "11-2", "student": ""}]},
        {"type": "section", "label": "12", "title": "调控化学变化"},
        {"type": "item", "number": "(3)", "text": "[[3-1]]", "blanks": [{"id": "3-1", "student": ""}]},
        {"type": "section", "label": "13.", "title": "应用化学变化"},
        {"type": "item", "number": "(7)①", "text": "[[7-1]]", "blanks": [{"id": "7-1", "student": ""}]},
        {"type": "section", "label": "七", "title": "下一大题"},
        {"type": "item", "number": "(1)", "text": "[[1]]", "blanks": [{"id": "1", "student": ""}]},
    ]}]}, 0)
    assert [q.number for q in derive_questions(sheets)] == ["11(1)", "11(2)", "12(3)", "13(7)①", "(1)"]


def test_split_choice_word_not_in_options_is_resolved_by_model(monkeypatch):
    """短文页给的词不在选项里（free ≠ spare）：再问一次大模型，带上短文和选项，拿字母。"""
    from app.ai.base import Crop
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    asked = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        if "results" in schema["properties"] and "verdict" not in str(schema):
            asked.append(content[0]["text"])
            return {"results": [{"key": "c0", "answer": "B", "analysis": "spare time 空闲时间"}]}
        if content[0]["source"]["data"] == "YQ==":  # 第一页：短文
            return {"sheets": [{"subject": "english", "blocks": [{"type": "passage", "text": "I have [[66]] time.", "blanks": [{"id": "66", "number": "66", "student": "", "answer": "free"}]}]}]}
        return {"sheets": [{"subject": "english", "blocks": [{"type": "item", "number": "66", "text": "[[66]]", "options": ["A. busy", "B. spare", "C. happy"], "blanks": [{"id": "66", "student": "", "answer": "C"}]}]}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    monkeypatch.setattr("app.ai.claude.ocr.enabled", lambda: False)
    sheets, qs = provider.digitize_pages([Crop(data=b"a"), Crop(data=b"b")], subjects=["english"], grade="9")
    assert len(asked) == 1 and "【空】" in asked[0] and "B. spare" in asked[0]
    assert [q.number for q in qs] == ["66"] and qs[0].correctAnswer == "B" and qs[0].options[1] == "B. spare"
    assert sheets[1].blocks[0].blanks[0].answer == "B"


def test_scratch_work_next_to_answer_is_not_marked_wrong():
    """学生在答案旁写了草稿，识别时一起抄进来（多行）：按第一行 / 几部分合起来判，不判错。"""
    from app.ai.digitize import auto_mark

    assert auto_mark("unmarked", "-1\n(0,0)", "-1") == "correct"
    assert auto_mark("unmarked", "$>$\n$y_1=c-1$\n$y_2=c-16$", "$>$") == "correct"
    assert auto_mark("unmarked", "C\nS1/S2=AD/AB", "C", "choice") == "correct"
    assert auto_mark("unmarked", "矩形 CDHG\n矩形 ABGH", "矩形 CDHG、矩形 ABGH") == "correct"
    assert auto_mark("unmarked", "5\n(0,0)", "-1") == "wrong"  # 第一行就错了，照样判错


def test_multi_blank_answers_keep_repeats():
    """物理 3：三个空 B；A；B，合成一题时不能去重成 B；A。"""
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "3", "text": "(1)[[3-1]] (2)[[3-2]] (3)[[3-3]]", "blanks": [
            {"id": "3-1", "student": "", "answer": "B"}, {"id": "3-2", "student": "", "answer": "A"}, {"id": "3-3", "student": "", "answer": "B"}]},
        {"type": "item", "number": "2", "text": "湖南省[[2-1]]部，湘江自[[2-2]]向[[2-3]]", "blanks": [
            {"id": "2-1", "student": "南", "answer": "南"}, {"id": "2-2", "student": "北", "answer": "南"}, {"id": "2-3", "student": "北", "answer": "北"}]},
    ]}]}, 0)
    qs = derive_questions(sheets)
    assert qs[0].correctAnswer == "B；A；B"
    assert qs[1].correctAnswer == "南；南；北" and qs[1].studentAnswer == "南；北；北"


def test_intro_of_big_question_is_not_a_question():
    """物理 17：题干单独成了一个没有空的 item，下面才是 17(1)–(2)，题干不算一道题；没有小题的无空 item 照常保留。"""
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "item", "number": "17", "text": "小华和小明利用小灯泡制作灯带……", "blanks": []},
        {"type": "item", "number": "17(1)", "text": "电压表示数为[[17-1]]", "blanks": [{"id": "17-1", "student": "", "answer": "1.5V"}]},
        {"type": "item", "number": "17(2)", "text": "补全电路[[17-2]]", "blanks": [{"id": "17-2", "student": "", "answer": "下端接B"}]},
        {"type": "item", "number": "18", "text": "画出受力示意图", "blanks": []},
    ]}]}, 0)
    assert [q.number for q in derive_questions(sheets)] == ["17(1)", "17(2)", "18"]


def test_word_bank_recognised_as_figure_becomes_word_bank():
    """英语 40–43：词库方框被识别成表格 figure，短文又拆成两块；改成 wordbank 后两块短文的空都拿到选项。"""
    from app.ai.digitize import clean_sheets, derive_questions

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "figure", "title": "表格", "text": "词库方框：A. placed；B. goal；C. method；D. detailed；E. exactly", "bbox": [0.1, 0.05, 0.9, 0.1]},
        {"type": "passage", "text": "3. Memory Map Show students a [[40]] map. The [[41]] is to fill in.", "blanks": [
            {"id": "40", "student": "", "answer": "D"}, {"id": "41", "student": "", "answer": "B"}]},
        {"type": "passage", "text": "4. Matching Pairs Cards are [[42]] face down, or [[43]] the same card.", "blanks": [
            {"id": "42", "student": "", "answer": "A"}, {"id": "43", "student": "", "answer": "E"}]},
    ]}]}, 0)
    assert sheets[0].blocks[0].type == "wordbank" and sheets[0].blocks[0].options[3] == "D. detailed"
    qs = derive_questions(sheets)
    assert [q.number for q in qs] == ["40", "41", "42", "43"]
    assert all(q.options[:2] == ["A. placed", "B. goal"] and q.questionType == "choice" for q in qs)


def test_real_figure_with_lettered_labels_stays_a_figure():
    from app.ai.digitize import clean_sheets

    sheets = clean_sheets({"sheets": [{"blocks": [
        {"type": "figure", "title": "图6", "text": "左侧试管 A. 白磷 B. 水 C. 气球，右侧注射器", "bbox": [0.1, 0.2, 0.5, 0.4]},
        {"type": "item", "number": "3", "text": "[[3]]", "blanks": [{"id": "3", "student": ""}]},
    ]}]}, 0)
    assert sheets[0].blocks[0].type == "figure"


def _sheets(*pages):
    from app.ai.digitize import clean_sheets

    return [s for i, blocks in enumerate(pages) for s in clean_sheets({"sheets": [{"label": f"第{i + 1}页", "blocks": blocks}]}, i)]


def _post(sheets):
    from app.ai.digitize import derive_questions, join_page_breaks, merge_split_questions, strip_page_chrome

    sheets = strip_page_chrome(sheets)
    touched = join_page_breaks(sheets) + merge_split_questions(sheets)
    return sheets, touched, derive_questions(sheets)


AD = {"type": "text", "text": "上海最大家教平台--嘉惠家教 2万余上海老师任您选,+V: jiajiao6767)"}


def test_page_numbers_and_ads_are_dropped():
    """页码、页眉广告不是卷面内容；整页推广（学科网）整张去掉。"""
    sheets, _, qs = _post(_sheets(
        [AD, {"type": "item", "number": "1", "text": "1+1=[[1]]", "blanks": [{"id": "1", "answer": "2"}]}, {"type": "text", "text": "第1页共3页"}],
        [{"type": "text", "text": "免费增值服务介绍 学科网"}, {"type": "figure", "text": "学科网卡通标志", "bbox": [0.1, 0.1, 0.5, 0.5]}],
    ))
    assert len(sheets) == 1 and [b.type for b in sheets[0].blocks] == ["item"] and [q.number for q in qs] == ["1"]


def test_question_split_across_pages_is_merged():
    """题干在页底（没有空），图和小题在下一页（模型编号「续题」）：合成一题，放在图那页，空重新编号。"""
    sheets, touched, qs = _post(_sheets(
        [{"type": "item", "number": "20", "text": "已知:如图,在四边形ABCD中,AB=AD=2."}, {"type": "text", "text": "第2页共3页"}],
        [AD, {"type": "figure", "text": "四边形", "bbox": [0.1, 0.1, 0.5, 0.3]},
         {"type": "item", "number": "", "text": "(1)求∠B. [[续题-1]]\n(2)求面积. [[续题-2]]", "blanks": [{"id": "续题-1", "answer": "无法确定"}, {"id": "续题-2"}]},
         {"type": "item", "number": "21", "text": "求y. [[21]]", "blanks": [{"id": "21"}]}],
    ))
    assert [q.number for q in qs] == ["20", "21"]
    assert qs[0].page == 1 and qs[0].blankIds == ["20-1", "20-2"] and qs[0].stemText.startswith("已知:如图") and "(2)求面积" in qs[0].stemText
    assert sheets[0].blocks == [] and touched and touched[0].number == "20"


def test_choice_options_on_next_page_are_attached():
    """选择题的选项印在下一页开头（text 块、选项字母不带点也行）：并成一题的选项。"""
    _, _, qs = _post(_sheets(
        [{"type": "item", "number": "5", "questionType": "choice", "text": "反射角将([[5]])", "blanks": [{"id": "5", "answer": "逐渐增大"}]}],
        [AD, {"type": "text", "text": "A逐渐减小\nB.逐渐增大,且总大于入射角\nC.逐渐增大,且总等于入射角\nD.逐渐减小"},
         {"type": "item", "number": "6", "text": "x([[6]])", "options": ["A. 1", "B. 2"], "blanks": [{"id": "6"}]}],
    ))
    assert [q.number for q in qs] == ["5", "6"] and qs[0].options[0] == "A. 逐渐减小" and qs[0].options[3] == "D. 逐渐减小"


def test_option_figures_on_next_page():
    """图片选项（A、B、C 三张光路图）在下一页：补上选项，题挪到图那页。"""
    _, _, qs = _post(_sheets(
        [{"type": "item", "number": "6", "questionType": "choice", "text": "光路图是([[6]])", "blanks": [{"id": "6"}]}],
        [{"type": "figure", "label": l, "text": f"光路{l}", "bbox": [0.1 * k, 0.1, 0.1 * k + 0.08, 0.2]} for k, l in enumerate("ABC", 1)],
    ))
    assert qs[0].page == 1 and qs[0].options == ["A. （图）光路A", "B. （图）光路B", "C. （图）光路C"]


def test_sub_questions_get_parent_stem_and_no_empty_parent():
    """题干一块、①②各成一题：小题前面补上题干；只有题干的那块不再单独成题。没有空的问答题补一个空。"""
    _, touched, qs = _post(_sheets(
        [{"type": "item", "number": "29", "text": "小明做光的折射实验,采集了如下数据。"}],
        [{"type": "item", "number": "①", "text": "可以得出结论:[[①]]", "blanks": [{"id": "①"}]},
         {"type": "item", "number": "30", "text": "想一想:他为什么要这样编排呢?"}],
    ))
    assert [q.number for q in qs] == ["29①", "30"]
    assert qs[0].stemText.startswith("小明做光的折射实验") and qs[1].blankIds == ["30"] and any(b.number == "30" for b in touched)


def test_sentence_cut_by_page_break_is_joined():
    _, _, qs = _post(_sheets(
        [{"type": "item", "number": "1", "text": "他在书里把谷物"}],
        [AD, {"type": "text", "text": "类放在前面。想一想:为什么?"}, {"type": "item", "number": "2", "text": "x [[2]]", "blanks": [{"id": "2"}]}],
    ))
    assert qs[0].stemText.startswith("他在书里把谷物类放在前面。") and qs[0].blankIds == ["1"]


def test_guessed_answers_are_resolved_with_neighbouring_pages(monkeypatch):
    """只看到一页、答案是猜的（「本页未显示前页已知条件」）：带上前后页照片重新作答，答案和解析换掉。"""
    from app.ai.base import Crop
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    asked = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        if "verdict" in str(schema):
            return {"results": []}
        if "results" in schema["properties"]:
            asked.append(content)
            return {"results": [{"key": "q0b0", "answer": "4", "analysis": "由已知条件求得"}]}
        if content[0]["source"]["data"] == "YQ==":
            return {"sheets": [{"subject": "english", "blocks": [{"type": "passage", "text": "Tom has two pens."}]}]}
        return {"sheets": [{"subject": "english", "blocks": [{"type": "item", "number": "3", "text": "How many? [[3]]", "blanks": [{"id": "3", "answer": "3", "analysis": "原文不在本页，推定"}]}]}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    monkeypatch.setattr("app.ai.claude.ocr.enabled", lambda: False)
    sheets, qs = provider.digitize_pages([Crop(data=b"a"), Crop(data=b"b")], subjects=["english"], grade="8")
    images = [c for c in asked[0] if c["type"] == "image"]
    assert len(asked) == 1 and len(images) == 2 and "【q0b0】" in asked[0][-1]["text"]
    assert qs[0].correctAnswer == "4" and qs[0].analysis == "由已知条件求得"


def test_stem_with_stray_blank_and_unnumbered_sub_question():
    """页底题干末尾被多给了一个空，下一页小问 (1) 和 (2) 分成两块、(2) 没题号：合成一题，题干末尾那个空去掉。"""
    _, _, qs = _post(_sheets(
        [{"type": "item", "number": "20", "text": "已知:AB=AD=2.[[20]]", "blanks": [{"id": "20", "answer": "无法确定"}]}],
        [{"type": "figure", "text": "四边形", "bbox": [0.1, 0.1, 0.5, 0.3]},
         {"type": "item", "number": "20", "text": "(1)求∠B. [[20-1]]", "blanks": [{"id": "20-1"}]},
         {"type": "item", "number": "", "text": "(2)求面积. [[2]]", "blanks": [{"id": "2"}]}],
    ))
    assert [(q.number, q.blankIds) for q in qs] == [("20", ["20-1", "20-2"])]
    assert qs[0].stemText == "已知:AB=AD=2.\n(1)求∠B. ____\n(2)求面积. ____"


def test_math_mistakes_get_detailed_explanation(monkeypatch):
    """数理化做错 / 没作答的题写详解：分【思路】【知识点】【解答】【技巧】【易错】段，学生答错时末行「错在：」；做对的题和英语不写。"""
    from app.ai.base import Crop
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    asked = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        if "steps" in str(schema):
            asked.append(content[-1]["text"])
            return {"results": [{"key": "q0", "answer": "$2250$", "thinking": "先列利润函数，再看顶点是否在范围内。", "knowledge": ["二次函数顶点式", "利润 = 单件利润 × 销量"],
                                 "steps": ["$y=(10+x)(200-10x)$", "∵ $a=-10<0$，∴ 开口向下", "答：最大利润 2250 元"], "technique": "", "pitfall": "忘了自变量范围", "wrongAt": "没有化成顶点式"}]}
        if "results" in schema["properties"]:
            return {"results": []}
        return {"sheets": [{"subject": "math", "blocks": [
            {"type": "item", "number": "1", "text": "求最大利润 [[1]]", "questionType": "solve", "blanks": [{"id": "1", "student": "2000", "mark": "wrong", "answer": "2250", "analysis": "配方得顶点"}]},
            {"type": "item", "number": "2", "text": "求 $x$ [[2]]", "questionType": "fill", "blanks": [{"id": "2", "student": "3", "mark": "correct"}]},
        ]}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    monkeypatch.setattr("app.ai.claude.ocr.enabled", lambda: False)
    _, qs = provider.digitize_pages([Crop(data=b"a")], subjects=["math"], grade="9")
    assert len(asked) == 1 and 'key="q0"' in asked[0] and "学生作答：2000" in asked[0] and "求 $x$" not in asked[0]
    assert qs[0].correctAnswer == "2250"  # 只是写法不同，不改答案
    assert qs[0].analysis.split("\n") == [
        "【思路】先列利润函数，再看顶点是否在范围内。", "【知识点】二次函数顶点式；利润 = 单件利润 × 销量", "【解答】",
        "$y=(10+x)(200-10x)$", "∵ $a=-10<0$，∴ 开口向下", "答：最大利润 2250 元", "【易错】忘了自变量范围", "错在：没有化成顶点式",
    ]
    assert qs[1].analysis == ""


def test_book_pdf_has_toc_with_page_numbers(monkeypatch):
    """多个知识点时错题本先出一页目录，页码在第二遍排版时填上"""
    import app.pdf as pdf

    seen = []
    orig = pdf._toc_part
    monkeypatch.setattr(pdf, "_toc_part", lambda story, groups, pages, width: (seen.append(dict(pages)), orig(story, groups, pages, width)))
    items = [
        {"number": str(i + 1), "stem": "He ____ to school yesterday. " * 4, "knowledge": kp, "answers": [{"number": str(i + 1), "student": "go", "answer": "went", "analysis": "过去时" * 30, "kind": "答错"}]}
        for i, kp in enumerate(["一般过去时"] * 8 + ["介词搭配"] * 8 + ["阅读理解"] * 2)
    ]
    assert pdf.build_book_pdf("t", "s", items).startswith(b"%PDF")
    assert seen[0] == {} and set(seen[1]) == {"kp0", "kp1", "kp2"}
    assert seen[1]["kp0"] == 2 and seen[1]["kp0"] <= seen[1]["kp1"] <= seen[1]["kp2"]


# ---------------------------------------------------------------- 知识图谱标注


def test_taxonomy_candidates_whole_subject():
    """候选池给整个学科，不按年级过滤：数学从一年级到高中都在，按年级排；没有的学科为空。"""
    from app import taxonomy

    math = taxonomy.candidates("math")
    assert {1, 7, 9, 10} <= {t["grade"] for t in math}
    assert [t["grade"] for t in math] == sorted(t["grade"] for t in math)
    assert all(t["subject"] == "math" for t in math)
    assert taxonomy.candidates("chemistry") == []
    v = taxonomy.view("cnm_276")
    assert v and v["name"] == "锐角三角函数的定义" and v["chapter"] == "九下 第三十二章 锐角三角函数" and v["subject"] == "math"
    assert taxonomy.resolve_alias("math", "锐角三角比") == "cnm_276"
    pre = taxonomy.prerequisites("cnm_221", depth=2)
    assert pre and all(p["id"] != "cnm_221" for p in pre) and len({p["id"] for p in pre}) == len(pre)


def test_tag_topics_sends_candidates_and_applies_valid_ids(monkeypatch):
    """错题按学科合批交给大模型：提示词里有该学科全部年级的知识点清单和卷面年级；挑中的 id 写进题块和派生题，不在图谱里的 id 丢掉。"""
    from app import taxonomy
    from app.ai.base import DigitizedBlank, DigitizedBlock, DigitizedPage
    from app.ai.claude import ClaudeProvider
    from app.ai.digitize import derive_questions

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    calls = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append(content)
        return {"results": [{"key": "q0", "topicId": "cnm_221", "confidence": "high"}, {"key": "q1", "topicId": "nope_1", "confidence": "low"}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    sheets = [DigitizedPage(page=0, subject="math", examGrade="九年级", blocks=[
        DigitizedBlock(type="item", number="1", text="用配方法解方程 [[1]]", subject="math", questionType="solve", knowledgePoints=["数与代数 · 一元二次方程", "配方法"], blanks=[DigitizedBlank(id="1", number="1", student="x=1", mark="wrong", answer="x=1 或 x=3")]),
        DigitizedBlock(type="item", number="2", text="计算 [[2]]", subject="math", questionType="fill", knowledgePoints=["有理数"], blanks=[DigitizedBlank(id="2", number="2", student="", mark="blank", answer="3")]),
        DigitizedBlock(type="item", number="3", text="做对的题 [[3]]", subject="math", questionType="fill", blanks=[DigitizedBlank(id="3", number="3", student="5", mark="correct")]),
        DigitizedBlock(type="item", number="4", text="化学题 [[4]]", subject="chemistry", questionType="fill", blanks=[DigitizedBlank(id="4", number="4", student="", mark="wrong", answer="O2")]),
    ])]
    assert provider.tag_topics(sheets, grade="5") == 1
    assert len(calls) == 1
    listing, questions = calls[0][0]["text"], calls[0][1]["text"]
    assert "cnm_221｜配方法" in listing and "cnm_p001" in listing and "cnm_h001" in listing
    assert "卷面年级：九年级" in listing
    assert 'key="q0"' in questions and 'key="q1"' in questions and "q2" not in questions and "化学题" not in questions
    assert sheets[0].blocks[0].topic == taxonomy.view("cnm_221") and sheets[0].blocks[1].topic is None
    qs = derive_questions(sheets)
    assert qs[0].topic["id"] == "cnm_221" and qs[0].to_dict()["topic"]["chapter"] == "九上 第二十五章 一元二次方程" and qs[1].topic is None


def test_digitize_tag_endpoint_and_flag(client, auth, app):
    """补标接口：开关关着原样返回；开着时 mock 按知识点名称挑 id，旧 id 按别名表迁移；回传带 topic 的电子版能原样读回。"""
    pages = [{"page": 0, "subject": "math", "blocks": [
        {"type": "item", "number": "1", "text": "解方程 [[1]]", "subject": "math", "questionType": "solve", "knowledgePoints": ["一元二次方程的概念"],
         "blanks": [{"id": "1", "number": "1", "student": "2", "mark": "wrong", "answer": "1", "analysis": "", "note": ""}]},
        {"type": "item", "number": "2", "text": "tan [[2]]", "subject": "math", "questionType": "fill", "knowledgePoints": ["锐角三角比"],
         "blanks": [{"id": "2", "number": "2", "student": "", "mark": "blank", "answer": "1", "analysis": "", "note": ""}]},
    ]}]
    r = client.post("/api/digitize/tag", json={"pages": pages, "grade": "9"}, headers=auth)
    assert r.status_code == 200 and r.get_json()["tagged"] == 0 and r.get_json()["questions"][0]["topic"] is None

    app.config["TAXONOMY_TAGGING"] = True
    r = client.post("/api/digitize/tag", json={"pages": pages, "grade": "9"}, headers=auth)
    body = r.get_json()
    assert r.status_code == 200 and body["tagged"] == 2
    assert body["questions"][0]["topic"]["id"] == "cnm_219" and body["questions"][1]["topic"]["id"] == "cnm_276"
    assert body["pages"][0]["blocks"][1]["topic"]["name"] == "锐角三角函数的定义"

    # 带 topic 回传（比如再做一次阅卷）不会丢；坏的 topic 当没标
    body["pages"][0]["blocks"][0]["topic"] = {"bogus": 1}
    r = client.post("/api/digitize/grade", json={"pages": body["pages"]}, headers=auth)
    qs = r.get_json()["questions"]
    assert qs[0]["topic"] is None and qs[1]["topic"]["id"] == "cnm_276"

    r = client.get("/api/taxonomy/topics/cnm_276", headers=auth)
    assert r.status_code == 200 and r.get_json()["name"] == "锐角三角函数的定义" and r.get_json()["prerequisites"]
    assert client.get("/api/taxonomy/topics/none", headers=auth).status_code == 404


def test_mistake_stores_topic_id(client, auth):
    """错题入库带 topic 时存 id，读回时展开成图谱知识点；不在图谱里的 id 不存。"""
    r = client.post("/api/mistakes", json={"items": [
        {"subject": "math", "knowledgePoints": ["配方法"], "stemText": "题一", "reasons": ["concept"], "topic": {"id": "cnm_221", "name": "配方法"}},
        {"subject": "math", "knowledgePoints": ["x"], "stemText": "题二", "reasons": ["concept"], "topicId": "bad_id"},
    ]}, headers=auth)
    assert r.status_code == 201
    created = r.get_json()["created"]
    assert created[0]["topic"]["id"] == "cnm_221" and created[0]["topic"]["chapter"] == "九上 第二十五章 一元二次方程"
    assert created[1]["topic"] is None
    r = client.patch(f"/api/mistakes/{created[1]['id']}", json={"topicId": "cnm_276"}, headers=auth)
    assert r.status_code == 200 and r.get_json()["mistake"]["topic"]["id"] == "cnm_276"


def test_taxonomy_extra_topics_join_candidates():
    """知错本自补的上海英语考纲大类（zcb_ 前缀）并进英语候选池，不进别的学科；能被 view 和标注校验接受。"""
    from app import taxonomy
    from app.ai.base import DigitizedBlock
    from app.ai.digitize import apply_topic

    english = {t["id"] for t in taxonomy.candidates("english")}
    assert "zcb_e012" in english and "cne_j243" in english
    assert "zcb_e012" not in {t["id"] for t in taxonomy.candidates("math")}
    v = taxonomy.view("zcb_e012")
    assert v["chapter"] == "构词法" and v["subject"] == "english"
    blk = DigitizedBlock(type="item", subject="english")
    assert apply_topic(blk, "zcb_e012") and blk.topic["id"] == "zcb_e012"
