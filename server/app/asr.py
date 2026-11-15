"""语音识别：腾讯云「一句话识别」SentenceRecognition（60 秒以内的短语音，同步返回文字）。

小程序按住话筒录一段 mp3，传到 POST /api/asr，这里转给腾讯云，拿回文字。
密钥：ASR_SECRET_ID / ASR_SECRET_KEY；不配就复用 COS_SECRET_ID / COS_SECRET_KEY（同一个腾讯云账号，
子账号要有 QcloudASRFullAccess 之类的语音识别权限，控制台里还要先开通「语音识别」）。
ASR_ENGINE 识别引擎，默认 16k_zh（普通话）。只用标准库，按腾讯云 API 3.0 的 TC3-HMAC-SHA256 签名。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

log = logging.getLogger(__name__)

HOST = "asr.tencentcloudapi.com"
SERVICE = "asr"
VERSION = "2019-06-14"
MAX_BYTES = 3 * 1024 * 1024  # 腾讯云一句话识别的音频上限 3MB
FORMATS = ("mp3", "wav", "m4a", "aac", "pcm", "silk", "amr")


class ASRError(Exception):
    pass


def _creds() -> tuple[str, str]:
    sid = (os.getenv("ASR_SECRET_ID") or os.getenv("COS_SECRET_ID") or "").strip()
    key = (os.getenv("ASR_SECRET_KEY") or os.getenv("COS_SECRET_KEY") or "").strip()
    return sid, key


def configured() -> bool:
    sid, key = _creds()
    return bool(sid and key)


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def sign_headers(action: str, payload: str, sid: str, key: str, ts: int | None = None) -> dict[str, str]:
    """腾讯云 API 3.0 签名（TC3-HMAC-SHA256），返回要带的请求头。"""
    ts = int(ts if ts is not None else time.time())
    date = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
    ctype = "application/json; charset=utf-8"
    canonical = "\n".join([
        "POST", "/", "",
        f"content-type:{ctype}\nhost:{HOST}\n",
        "content-type;host",
        hashlib.sha256(payload.encode("utf-8")).hexdigest(),
    ])
    scope = f"{date}/{SERVICE}/tc3_request"
    to_sign = "\n".join(["TC3-HMAC-SHA256", str(ts), scope, hashlib.sha256(canonical.encode("utf-8")).hexdigest()])
    secret = _hmac(_hmac(_hmac(("TC3" + key).encode("utf-8"), date), SERVICE), "tc3_request")
    signature = hmac.new(secret, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "Authorization": f"TC3-HMAC-SHA256 Credential={sid}/{scope}, SignedHeaders=content-type;host, Signature={signature}",
        "Content-Type": ctype,
        "Host": HOST,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(ts),
        "X-TC-Version": VERSION,
    }


def recognize(audio_b64: str, size: int, fmt: str = "mp3") -> str:
    """识别一段短语音（base64），返回文字；没说话返回空串。失败抛 ASRError。"""
    sid, key = _creds()
    if not (sid and key):
        raise ASRError("语音识别还没配置")
    body = {
        "EngSerViceType": os.getenv("ASR_ENGINE", "16k_zh").strip() or "16k_zh",
        "SourceType": 1,
        "VoiceFormat": fmt,
        "Data": audio_b64,
        "DataLen": size,
        "FilterDirty": 0,
        "FilterModal": 1,  # 去掉“嗯、啊”这类语气词
        "ConvertNumMode": 1,  # “十三课”转成“13课”
    }
    payload = json.dumps(body, separators=(",", ":"))
    req = urllib.request.Request(f"https://{HOST}", data=payload.encode("utf-8"), headers=sign_headers("SentenceRecognition", payload, sid, key), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log.warning("腾讯云语音识别请求失败：%s", e)
        raise ASRError("语音识别服务连不上，稍后再试") from e
    res = data.get("Response") or {}
    err = res.get("Error")
    if err:
        log.warning("腾讯云语音识别报错：%s %s", err.get("Code"), err.get("Message"))
        raise ASRError("语音识别失败，再说一次试试")
    return str(res.get("Result") or "").strip()
