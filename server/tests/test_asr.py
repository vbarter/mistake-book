"""语音输入：/api/asr 转腾讯云一句话识别（网络请求打桩）。"""
import base64
import json

import pytest

from app import asr


def _login(client, phone="13900000001"):
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    r = client.post("/api/auth/register", json={"phone": phone, "code": r.get_json()["devCode"]})
    return {"Authorization": f"Bearer {r.get_json()['token']}"}


AUDIO = base64.b64encode(b"ID3fake-mp3-bytes").decode()


@pytest.fixture()
def creds(monkeypatch):
    monkeypatch.setenv("ASR_SECRET_ID", "AKIDtest")
    monkeypatch.setenv("ASR_SECRET_KEY", "secret")


class _Resp:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_needs_login(client):
    assert client.post("/api/asr", json={"audio": AUDIO}).status_code == 401


def test_not_configured(client, monkeypatch):
    for k in ("ASR_SECRET_ID", "ASR_SECRET_KEY", "COS_SECRET_ID", "COS_SECRET_KEY"):
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/asr", json={"audio": AUDIO}, headers=_login(client))
    assert r.status_code == 503
    assert "语音识别" in r.get_json()["message"]


def test_recognize(client, creds, monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen["headers"] = dict(req.header_items())
        seen["body"] = json.loads(req.data)
        return _Resp({"Response": {"Result": "背U6单词，写周记。", "AudioDuration": 2100, "RequestId": "x"}})

    monkeypatch.setattr(asr.urllib.request, "urlopen", fake_urlopen)
    r = client.post("/api/asr", json={"audio": "data:audio/mpeg;base64," + AUDIO, "format": "mp3"}, headers=_login(client))
    assert r.status_code == 200
    assert r.get_json() == {"text": "背U6单词，写周记。"}
    assert seen["body"]["EngSerViceType"] == "16k_zh"
    assert seen["body"]["VoiceFormat"] == "mp3"
    assert seen["body"]["DataLen"] == len(base64.b64decode(AUDIO))
    assert seen["headers"]["X-tc-action"] == "SentenceRecognition"
    assert seen["headers"]["Authorization"].startswith("TC3-HMAC-SHA256 Credential=AKIDtest/")


def test_tencent_error(client, creds, monkeypatch):
    monkeypatch.setattr(asr.urllib.request, "urlopen", lambda req, timeout: _Resp({"Response": {"Error": {"Code": "AuthFailure.SecretIdNotFound", "Message": "x"}}}))
    r = client.post("/api/asr", json={"audio": AUDIO}, headers=_login(client))
    assert r.status_code == 502


def test_bad_input(client, creds):
    h = _login(client)
    assert client.post("/api/asr", json={"audio": "!!!"}, headers=h).status_code == 400
    assert client.post("/api/asr", json={"audio": AUDIO, "format": "exe"}, headers=h).status_code == 400
    big = base64.b64encode(b"0" * (asr.MAX_BYTES + 1)).decode()
    assert client.post("/api/asr", json={"audio": big}, headers=h).status_code == 413


def test_signature_stable():
    a = asr.sign_headers("SentenceRecognition", '{"a":1}', "AKID", "key", ts=1700000000)
    b = asr.sign_headers("SentenceRecognition", '{"a":1}', "AKID", "key", ts=1700000000)
    assert a == b
    assert "AKID/2023-11-14/asr/tc3_request" in a["Authorization"]
