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
    for it in items:
        it["reasons"] = ["concept"]
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
