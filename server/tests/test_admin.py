import pytest
from conftest import TINY_PNG

from app.routes import admin as admin_routes

IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
WECHAT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) MicroMessenger/8.0 miniProgram"


@pytest.fixture(autouse=True)
def _reset_lockout():
    admin_routes._fails.clear()
    yield
    admin_routes._fails.clear()


def _enable(app, password="s3cret-pass"):
    app.config["ADMIN_PASSWORD"] = password
    return password


def test_admin_closed_without_password(client):
    assert client.get("/admin").status_code == 404
    assert client.get("/admin/api/stats").status_code == 404


def test_admin_requires_login(app, client):
    _enable(app)
    r = client.get("/admin")
    assert r.status_code == 302 and r.headers["Location"].endswith("/admin/login")
    assert client.get("/admin/api/stats").status_code == 401
    assert client.get("/admin/login").status_code == 200


def test_admin_wrong_password_locks(app, client):
    _enable(app)
    for _ in range(5):
        assert client.post("/admin/login", json={"password": "nope"}).status_code == 400
    assert client.post("/admin/login", json={"password": "s3cret-pass"}).status_code == 429


def test_admin_stats_count_usage(app, client, auth):
    pw = _enable(app)
    client.get("/api/auth/me", headers={**auth, "User-Agent": IPHONE_UA})
    client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}, {"image": TINY_PNG}]}, headers={**auth, "User-Agent": IPHONE_UA})
    client.post("/api/auth/wechat", json={"code": "abc"}, headers={"User-Agent": WECHAT_UA})

    assert client.post("/admin/login", json={"password": pw}).status_code == 200
    assert client.get("/admin").status_code == 200
    s = client.get("/admin/api/stats?days=7").get_json()

    assert s["users"]["total"] == 2
    assert s["users"]["byMethod"]["phone"] == 1 and s["users"]["byMethod"]["wechat"] == 1
    assert s["users"]["new"]["today"] == 2
    assert s["active"]["today"] == 2
    assert s["platforms"]["ios"] == 1 and s["platforms"]["wechat"] == 1
    assert s["scans"]["total"] == 1 and s["scans"]["pages"] == 2 and s["scans"]["done"] == 1
    assert s["scans"]["successRate"] == 100 and s["scans"]["questions"] > 0
    assert len(s["daily"]) == 7 and s["daily"][-1]["scans"] == 1
    assert s["funnel"][0]["value"] == 2 and s["funnel"][1]["value"] == 1
    phone_user = next(u for u in s["userList"] if u["method"] == "phone")
    assert phone_user["phone"] == "138****0000" and phone_user["scans"] == 1 and phone_user["platform"] == "ios"


def test_admin_excludes_review_account(app, client):
    pw = _enable(app)
    app.config["REVIEW_PHONE"] = "13800138000"
    app.config["REVIEW_CODE"] = "246810"
    r = client.post("/api/auth/register", json={"phone": "13800138000", "code": "246810"})
    assert r.status_code == 200
    client.post("/admin/login", json={"password": pw})
    assert client.get("/admin/api/stats").get_json()["users"]["total"] == 0


def test_admin_logout(app, client):
    pw = _enable(app)
    client.post("/admin/login", json={"password": pw})
    assert client.get("/admin/api/stats").status_code == 200
    client.post("/admin/logout")
    assert client.get("/admin/api/stats").status_code == 401
