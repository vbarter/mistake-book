"""登录：手机验证码 / Apple 登录；资料；删除账号。"""
from __future__ import annotations

import base64
import json
import re
import time

from flask import Blueprint, abort, current_app, jsonify, request
from flask_jwt_extended import create_access_token

from ..auth_utils import current_user, login_required
from ..constants import GRADES, SUBJECTS
from ..extensions import db
from ..models import User

bp = Blueprint("auth", __name__)

# 开发期验证码存内存；生产应换成 Redis + 短信服务
_codes: dict[str, tuple[str, float]] = {}
PHONE_RE = re.compile(r"^1\d{10}$")


def _issue(user: User):
    token = create_access_token(identity=user.id)
    return jsonify({"token": token, "user": user.to_dict()})


@bp.post("/auth/code")
def send_code():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    if not PHONE_RE.match(phone):
        abort(400, "请输入 11 位手机号")
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
    if not saved or saved[0] != code or saved[1] < time.time():
        abort(400, "验证码不对或已过期")
    _codes.pop(phone, None)
    user = User.query.filter_by(phone=phone).first()
    if user is None:
        user = User(phone=phone)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        db.session.commit()
    return _issue(user)


def _decode_identity_token(token: str) -> dict:
    """开发期只解码 payload；APPLE_VERIFY=1 时需接入 Apple 公钥校验签名。"""
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
    if current_app.config["APPLE_VERIFY"]:
        abort(501, "生产环境需接入 Apple 公钥验签（见 README）")
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


@bp.patch("/auth/me")
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
