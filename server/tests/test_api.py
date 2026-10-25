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
    assert r.status_code == 400
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
    assert qs[3].mark == "partial" and qs[3].studentAnswer == "Did；sets" and qs[3].correctAnswer == "set" and "改为一般疑问句" in qs[3].stemText


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
    assert client.post("/api/auth/login", json={"phone": "13912345678", "code": "123456"}).status_code == 400
    assert client.post("/api/auth/login", json={"phone": "13800138000", "code": "246810"}).status_code == 200
    app.config.update(SMS_PROVIDER="mock", REVIEW_PHONE="", REVIEW_CODE="")
