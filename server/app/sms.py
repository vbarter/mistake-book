"""短信验证码：阿里云号码认证服务的「短信认证」（个人实名可用，系统赠送签名 + 模板，验证码由阿里云生成和校验）。

SendSmsVerifyCode 发码、CheckSmsVerifyCode 核验，签名方式为阿里云 RPC 签名 V1（HMAC-SHA1），不依赖 SDK。
配置（.env）：ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE，
可选 ALIYUN_SMS_TEMPLATE_PARAM（默认 {"code":"##code##","min":"5"}，##code## 由阿里云替换成验证码）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)

ENDPOINT = "https://dypnsapi.aliyuncs.com/"
VERSION = "2017-05-25"
CODE_LENGTH = 6
VALID_SECONDS = 300
INTERVAL_SECONDS = 60


class SmsError(Exception):
    """发码 / 核验失败；message 是给用户看的中文"""


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def configured() -> bool:
    return all(_env(k) for k in ("ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET", "ALIYUN_SMS_SIGN_NAME", "ALIYUN_SMS_TEMPLATE_CODE"))


def _quote(s: str) -> str:
    # 阿里云 RPC 签名要求的编码：空格 %20、* %2A、~ 不编码
    return urllib.parse.quote(str(s), safe="~")


def _call(action: str, params: dict) -> dict:
    """调一次阿里云 RPC 接口，返回解析后的 JSON（HTTP 错误时也尽量解析出 Code / Message）"""
    common = {
        "Action": action,
        "Format": "JSON",
        "Version": VERSION,
        "AccessKeyId": _env("ALIYUN_ACCESS_KEY_ID"),
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": uuid.uuid4().hex,
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    all_params = {**common, **{k: str(v) for k, v in params.items()}}
    canonical = "&".join(f"{_quote(k)}={_quote(all_params[k])}" for k in sorted(all_params))
    to_sign = f"POST&{_quote('/')}&{_quote(canonical)}"
    key = (_env("ALIYUN_ACCESS_KEY_SECRET") + "&").encode()
    all_params["Signature"] = base64.b64encode(hmac.new(key, to_sign.encode(), hashlib.sha1).digest()).decode()
    body = urllib.parse.urlencode(all_params).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            raise SmsError("短信服务暂时不可用，请稍后再试") from e
    except Exception as e:  # noqa: BLE001
        log.warning("aliyun %s failed: %s", action, e)
        raise SmsError("短信服务暂时不可用，请稍后再试") from e


# 常见错误码 → 给用户看的话（其余统一提示稍后再试，原文写日志）
_FRIENDLY = {
    "biz.FREQUENCY": "发送太频繁了，请 1 分钟后再试",
    "isv.BUSINESS_LIMIT_CONTROL": "今天获取验证码的次数太多了，请稍后再试",
    "isv.MOBILE_NUMBER_ILLEGAL": "手机号格式不对",
    "isv.MOBILE_COUNT_OVER_LIMIT": "手机号格式不对",
    "isv.DAY_LIMIT_CONTROL": "今天获取验证码的次数太多了，请明天再试",
    "isv.AMOUNT_NOT_ENOUGH": "短信服务暂时不可用，请稍后再试",
}


def send_code(phone: str) -> None:
    """给手机号发 6 位数字验证码，5 分钟有效，同一号码 60 秒内只能发一次"""
    if not configured():
        raise SmsError("短信服务还没配置好，请稍后再试")
    r = _call(
        "SendSmsVerifyCode",
        {
            "PhoneNumber": phone,
            "SignName": _env("ALIYUN_SMS_SIGN_NAME"),
            "TemplateCode": _env("ALIYUN_SMS_TEMPLATE_CODE"),
            "TemplateParam": _env("ALIYUN_SMS_TEMPLATE_PARAM", '{"code":"##code##","min":"5"}'),
            "CodeType": 1,
            "CodeLength": CODE_LENGTH,
            "ValidTime": VALID_SECONDS,
            "Interval": INTERVAL_SECONDS,
            "DuplicatePolicy": 1,
        },
    )
    if r.get("Code") != "OK":
        log.warning("aliyun SendSmsVerifyCode %s: %s %s", phone[:3] + "****" + phone[-4:], r.get("Code"), r.get("Message"))
        raise SmsError(_FRIENDLY.get(str(r.get("Code")), "验证码发送失败，请稍后再试"))


def check_code(phone: str, code: str) -> bool:
    """核验验证码：只有 Model.VerifyResult == PASS 才算通过"""
    if not configured():
        raise SmsError("短信服务还没配置好，请稍后再试")
    r = _call("CheckSmsVerifyCode", {"PhoneNumber": phone, "VerifyCode": code})
    if r.get("Code") != "OK":
        log.warning("aliyun CheckSmsVerifyCode: %s %s", r.get("Code"), r.get("Message"))
        return False
    return str((r.get("Model") or {}).get("VerifyResult")) == "PASS"
