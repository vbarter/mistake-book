"""智能聊天：/api/kb/token 给 App 发访问试卷知识库的短期票。"""
import jwt


def _login(client, phone="13900000001"):
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    r = client.post("/api/auth/register", json={"phone": phone, "code": r.get_json()["devCode"]})
    return {"Authorization": f"Bearer {r.get_json()['token']}"}, r.get_json()["user"]


def test_needs_login(client):
    assert client.post("/api/kb/token").status_code == 401


def test_disabled_without_config(app, client):
    app.config.update(KB_JWT_SECRET="", KB_PUBLIC_URL="")
    headers, _ = _login(client)
    r = client.post("/api/kb/token", headers=headers)
    assert r.status_code == 503 and r.get_json()["error"] == "kb_disabled"
    # 只配了一半也不开放
    app.config.update(KB_JWT_SECRET="s" * 40)
    assert client.post("/api/kb/token", headers=headers).status_code == 503


def test_token_is_short_lived_and_signed_with_kb_secret(app, client):
    secret = "kb-secret-" + "x" * 32
    app.config.update(KB_JWT_SECRET=secret, KB_PUBLIC_URL="https://kb.example.com/kb/", KB_TOKEN_TTL=600, KB_JWT_AUDIENCE="edu-kb", KB_JWT_ISSUER="")
    headers, user = _login(client)
    body = client.post("/api/kb/token", headers=headers).get_json()
    assert body["base"] == "https://kb.example.com/kb" and body["expiresIn"] == 600
    claims = jwt.decode(body["token"], secret, algorithms=["HS256"], audience="edu-kb")
    assert claims["sub"] == f"zcb:{user['id']}" and claims["exp"] - claims["iat"] == 600
    # 主站的登录密钥验不过这张票：两边密钥分开
    try:
        jwt.decode(body["token"], app.config["JWT_SECRET_KEY"], algorithms=["HS256"], audience="edu-kb")
        raise AssertionError("不该用主站密钥验过")
    except jwt.InvalidSignatureError:
        pass
    # 两个用户拿到的是各自的票
    other, user2 = _login(client, "13900000002")
    claims2 = jwt.decode(client.post("/api/kb/token", headers=other).get_json()["token"], secret, algorithms=["HS256"], audience="edu-kb")
    assert claims2["sub"] == f"zcb:{user2['id']}" != claims["sub"]
