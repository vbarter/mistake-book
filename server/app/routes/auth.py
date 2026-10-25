"""登录：手机验证码 / Apple 登录；资料；删除账号。"""
from __future__ import annotations

import base64
import json
import logging
import re
import time

import jwt
from flask import Blueprint, abort, current_app, jsonify, request
from flask_jwt_extended import create_access_token
from jwt import PyJWKClient

from ..auth_utils import current_user, login_required
from ..constants import GRADES, SUBJECTS
from ..extensions import db
from ..models import User

bp = Blueprint("auth", __name__)
log = logging.getLogger(__name__)

# 开发期验证码存内存；生产应换成 Redis + 短信服务
_codes: dict[str, tuple[str, float]] = {}
PHONE_RE = re.compile(r"^1\d{10}$")


def _is_review(phone: str) -> bool:
    """App Store 审核账号：手机号和验证码都在 .env 里配好才生效"""
    cfg = current_app.config
    return bool(cfg.get("REVIEW_PHONE") and cfg.get("REVIEW_CODE") and phone == cfg["REVIEW_PHONE"])


def _issue(user: User):
    token = create_access_token(identity=user.id)
    return jsonify({"token": token, "user": user.to_dict()})


@bp.post("/auth/code")
def send_code():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    if not PHONE_RE.match(phone):
        abort(400, "请输入 11 位手机号")
    if _is_review(phone):
        # 审核账号不发短信、不回显验证码：审核员按提交审核时填的验证码登录
        return jsonify({"ok": True, "expiresIn": 300})
    code = current_app.config["DEV_SMS_CODE"]
    _codes[phone] = (code, time.time() + 300)
    payload = {"ok": True, "expiresIn": 300}
    if current_app.config["SMS_PROVIDER"] == "mock":
        payload["devCode"] = code  # mock 模式回显，方便联调
    return jsonify(payload)


@bp.post("/auth/login")
def login_with_phone():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    code = str(data.get("code", "")).strip()
    saved = _codes.get(phone)
    if _is_review(phone):
        if code != current_app.config["REVIEW_CODE"]:
            abort(400, "验证码不对或已过期")
    elif not saved or saved[0] != code or saved[1] < time.time():
        abort(400, "验证码不对或已过期")
    _codes.pop(phone, None)
    user = User.query.filter_by(phone=phone).first()
    if user is None:
        user = User(phone=phone)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        db.session.commit()
    return _issue(user)


APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_apple_jwks: PyJWKClient | None = None


def _verify_apple_token(token: str) -> dict:
    """用 Apple 公钥（JWKS）校验 identityToken 的签名、签发者、受众（Bundle ID）与有效期。"""
    global _apple_jwks
    if _apple_jwks is None:
        _apple_jwks = PyJWKClient(APPLE_JWKS_URL, cache_keys=True, lifespan=3600)
    try:
        signing_key = _apple_jwks.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=current_app.config["APPLE_BUNDLE_ID"],
            issuer=APPLE_ISSUER,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        abort(401, "Apple 登录凭证已过期，请重新登录")
    except jwt.PyJWTError as e:
        log.warning("apple identity token rejected: %s", e)
        abort(401, "Apple 登录凭证无效")
    except Exception as e:  # noqa: BLE001  取公钥失败等
        log.warning("apple jwks error: %s", e)
        abort(503, "暂时无法验证 Apple 登录，请稍后再试")


def _decode_identity_token(token: str) -> dict:
    """APPLE_VERIFY=1（生产）走公钥验签；=0 仅解码 payload，供本地联调。"""
    if current_app.config["APPLE_VERIFY"]:
        return _verify_apple_token(token)
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:  # noqa: BLE001
        abort(400, "Apple 登录凭证无效")


@bp.post("/auth/apple")
def login_with_apple():
    data = request.get_json(silent=True) or {}
    token = str(data.get("identityToken", ""))
    if not token:
        abort(400, "缺少 identityToken")
    claims = _decode_identity_token(token)
    sub = claims.get("sub")
    if not sub:
        abort(400, "Apple 登录凭证无效")
    user = User.query.filter_by(apple_sub=sub).first()
    if user is None:
        user = User(apple_sub=sub)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        db.session.commit()
    return _issue(user)


def _wx_openid(code: str) -> str:
    """小程序 wx.login 拿到的 code 换 openid（jscode2session）。WX_APPID / WX_SECRET 在 .env 里配置。"""
    import os
    import urllib.parse
    import urllib.request

    appid, secret = os.getenv("WX_APPID", "").strip(), os.getenv("WX_SECRET", "").strip()
    if current_app.config.get("TESTING") and not appid:
        return f"test-{code}"  # 测试：不连微信
    if not (appid and secret):
        abort(503, "微信登录还没配置（服务器缺少 WX_APPID / WX_SECRET）")
    query = urllib.parse.urlencode({"appid": appid, "secret": secret, "js_code": code, "grant_type": "authorization_code"})
    try:
        with urllib.request.urlopen(f"https://api.weixin.qq.com/sns/jscode2session?{query}", timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.warning("jscode2session failed: %s", e)
        abort(502, "连接微信服务器失败，请稍后再试")
    openid = data.get("openid")
    if not openid:
        log.warning("jscode2session error: %s", {k: v for k, v in data.items() if k != "session_key"})
        abort(400, "微信登录失败：" + str(data.get("errmsg") or "code 无效"))
    return str(openid)


@bp.post("/auth/wechat")
def login_with_wechat():
    """微信小程序一键登录：同一个微信（openid）始终对应同一个账号。"""
    data = request.get_json(silent=True) or {}
    code = str(data.get("code", "")).strip()
    if not code:
        abort(400, "缺少 code")
    openid = _wx_openid(code)
    user = User.query.filter_by(wx_openid=openid).first()
    if user is None:
        user = User(wx_openid=openid)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        db.session.commit()
    return _issue(user)


@bp.post("/auth/guest")
def login_as_guest():
    """先用后登：创建匿名本地账号，后续可绑定手机 / Apple。"""
    data = request.get_json(silent=True) or {}
    user = User()
    _apply_profile(user, data.get("profile") or {})
    db.session.add(user)
    db.session.commit()
    return _issue(user)


@bp.post("/auth/bind")
@login_required
def bind_account():
    """把游客账号绑定到手机号（验证码）或 Apple。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    if data.get("phone"):
        phone, code = str(data["phone"]).strip(), str(data.get("code", "")).strip()
        saved = _codes.get(phone)
        if not saved or saved[0] != code or saved[1] < time.time():
            abort(400, "验证码不对或已过期")
        if User.query.filter(User.phone == phone, User.id != user.id).first():
            abort(400, "该手机号已绑定其他账号")
        user.phone = phone
    elif data.get("identityToken"):
        claims = _decode_identity_token(str(data["identityToken"]))
        if User.query.filter(User.apple_sub == claims.get("sub"), User.id != user.id).first():
            abort(400, "该 Apple ID 已绑定其他账号")
        user.apple_sub = claims.get("sub")
    else:
        abort(400, "缺少绑定信息")
    db.session.commit()
    return jsonify({"user": user.to_dict()})


def _apply_profile(user: User, data: dict) -> None:
    if "nickname" in data:
        nickname = str(data["nickname"]).strip()[:16]
        user.nickname = nickname or "小同学"
    if "grade" in data and str(data["grade"]) in GRADES:
        user.grade = str(data["grade"])
    if "subjects" in data:
        subjects = [s for s in data["subjects"] if s in SUBJECTS]
        if not subjects:
            abort(400, "至少保留一个学科")
        user.subjects = subjects
    if "weeklyGoal" in data:
        goal = int(data["weeklyGoal"])
        if goal not in (5, 10, 20):
            abort(400, "周目标只能是 5 / 10 / 20")
        user.weekly_goal = goal
    if "reviewReminder" in data and isinstance(data["reviewReminder"], dict):
        r = data["reviewReminder"]
        user.reminder_enabled = bool(r.get("enabled", user.reminder_enabled))
        user.reminder_hour = int(r.get("hour", user.reminder_hour)) % 24
        user.reminder_minute = int(r.get("minute", user.reminder_minute)) % 60


@bp.get("/auth/me")
@login_required
def me():
    return jsonify({"user": current_user().to_dict()})


@bp.route("/auth/me", methods=["PATCH", "PUT"])  # 小程序 wx.request 不支持 PATCH，用 PUT
@login_required
def update_me():
    user = current_user()
    _apply_profile(user, request.get_json(silent=True) or {})
    db.session.commit()
    return jsonify({"user": user.to_dict()})


@bp.delete("/auth/me")
@login_required
def delete_me():
    user = current_user()
    db.session.delete(user)
    db.session.commit()
    return jsonify({"ok": True})
