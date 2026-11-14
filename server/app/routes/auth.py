"""登录：手机验证码 / Apple 登录；资料；删除账号。"""
from __future__ import annotations

import base64
import json
import logging
import re
import time

import jwt
from werkzeug.security import check_password_hash, generate_password_hash
from flask import Blueprint, abort, current_app, jsonify, request
from flask_jwt_extended import create_access_token
from jwt import PyJWKClient

from ..auth_utils import current_user, login_required
from ..constants import GRADES, SUBJECTS
from ..extensions import db
from ..models import User
from ..usage import track
from .. import sms

bp = Blueprint("auth", __name__)
log = logging.getLogger(__name__)

# 开发期验证码存内存；生产应换成 Redis + 短信服务
_codes: dict[str, tuple[str, float]] = {}
PHONE_RE = re.compile(r"^1\d{10}$")


def _is_review(phone: str) -> bool:
    """App Store 审核账号：手机号和验证码都在 .env 里配好才生效"""
    cfg = current_app.config
    return bool(cfg.get("REVIEW_PHONE") and cfg.get("REVIEW_CODE") and phone == cfg["REVIEW_PHONE"])


def _verify_code(phone: str, code: str) -> None:
    """核验手机验证码：审核账号用固定码；阿里云模式交给阿里云核验；mock 模式比对内存里的固定码。不通过就 400。"""
    if not code:
        abort(400, "请输入验证码")
    if _is_review(phone):
        if code != current_app.config["REVIEW_CODE"]:
            abort(400, "验证码不对或已过期")
        return
    provider = current_app.config["SMS_PROVIDER"]
    if provider == "aliyun":
        try:
            ok = sms.check_code(phone, code)
        except sms.SmsError as e:
            abort(503, str(e))
        if not ok:
            abort(400, "验证码不对或已过期")
        return
    if provider != "mock":
        abort(400, "验证码不对或已过期")
    saved = _codes.get(phone)
    if not saved or saved[0] != code or saved[1] < time.time():
        abort(400, "验证码不对或已过期")
    _codes.pop(phone, None)


def _issue(user: User, kind: str = "login", method: str | None = None):
    track(user, kind, method=method)
    token = create_access_token(identity=user.id)
    return jsonify({"token": token, "user": user.to_dict()})


@bp.post("/auth/code")
def send_code():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    if not PHONE_RE.match(phone):
        abort(400, "请输入 11 位手机号")
    # 发码前先看用途，避免白发短信：注册时号码已注册 / 登录时号码没注册，直接提示（老版本客户端不传 purpose，不检查）
    purpose = str(data.get("purpose", "")).strip()
    exists = User.query.filter_by(phone=phone).first() is not None
    if purpose == "register" and exists:
        abort(409, "这个手机号已经注册过了，请直接登录")
    if purpose in ("login", "reset") and not exists:
        abort(404, "这个手机号还没注册，请先注册")
    if purpose == "bind" and exists and not data.get("allowMerge"):
        abort(409, "这个手机号已绑定其他账号")  # 老版本客户端：不支持合并账号
    if _is_review(phone):
        # 审核账号不发短信、不回显验证码：审核员按提交审核时填的验证码登录
        return jsonify({"ok": True, "expiresIn": 300, "registered": exists})
    provider = current_app.config["SMS_PROVIDER"]
    if provider == "aliyun":
        try:
            sms.send_code(phone)
        except sms.SmsError as e:
            abort(503 if "暂时不可用" in str(e) or "没配置" in str(e) else 429, str(e))
        return jsonify({"ok": True, "expiresIn": sms.VALID_SECONDS, "registered": exists})
    if provider != "mock":
        # 没接真实短信服务：不能让固定验证码在线上生效（否则谁都能登别人的手机号账号）
        abort(503, "手机号登录暂未开放，请使用 Apple 登录")
    code = current_app.config["DEV_SMS_CODE"]
    _codes[phone] = (code, time.time() + 300)
    payload = {"ok": True, "expiresIn": 300, "registered": exists}
    if current_app.config["SMS_PROVIDER"] == "mock":
        payload["devCode"] = code  # mock 模式回显，方便联调
    return jsonify(payload)


@bp.post("/auth/register")
def register_with_phone():
    """手机号注册：验证码通过后建账号（带上称呼、年级、学科）；号码已注册时提示去登录"""
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    code = str(data.get("code", "")).strip()
    if not PHONE_RE.match(phone):
        abort(400, "请输入 11 位手机号")
    if User.query.filter_by(phone=phone).first() is not None:
        abort(409, "这个手机号已经注册过了，请直接登录")
    password = str(data.get("password", ""))
    if "password" in data:
        _check_password_rule(password)
    _verify_code(phone, code)
    user = User(phone=phone)
    if password:
        user.password_hash = generate_password_hash(password)
    _apply_profile(user, data.get("profile") or {})
    db.session.add(user)
    db.session.commit()
    return _issue(user, "signup", "phone")


PASSWORD_MIN, PASSWORD_MAX = 6, 32
_pw_fails: dict[str, tuple[int, float]] = {}  # 手机号 → (连续输错次数, 锁定到期时间)
PW_MAX_FAILS, PW_LOCK_SECONDS = 5, 15 * 60


def _check_password_rule(password: str) -> None:
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        abort(400, f"密码要 {PASSWORD_MIN}–{PASSWORD_MAX} 位")
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        abort(400, "密码要同时包含字母和数字")


@bp.post("/auth/login/password")
def login_with_password():
    """手机号 + 密码登录；同一号码连续输错 5 次锁 15 分钟（可以改用验证码登录）"""
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    password = str(data.get("password", ""))
    if not PHONE_RE.match(phone):
        abort(400, "请输入 11 位手机号")
    fails, locked_until = _pw_fails.get(phone, (0, 0.0))
    if locked_until > time.time():
        abort(429, f"密码输错次数太多，请 {int((locked_until - time.time()) // 60) + 1} 分钟后再试，或用验证码登录")
    user = User.query.filter_by(phone=phone).first()
    if user is None:
        abort(404, "这个手机号还没注册，请先注册")
    if not user.password_hash:
        abort(400, "这个账号还没设置密码，请用验证码登录")
    if not check_password_hash(user.password_hash, password):
        fails += 1
        _pw_fails[phone] = (fails, time.time() + PW_LOCK_SECONDS if fails >= PW_MAX_FAILS else 0.0)
        left = PW_MAX_FAILS - fails
        abort(400, "手机号或密码不对" + (f"，还可以试 {left} 次" if left > 0 else "，已锁定 15 分钟"))
    _pw_fails.pop(phone, None)
    return _issue(user, "login", "password")


@bp.post("/auth/password/reset")
def reset_password():
    """忘记密码：手机号 + 验证码 + 新密码，重设后直接登录"""
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    code = str(data.get("code", "")).strip()
    password = str(data.get("password", ""))
    user = User.query.filter_by(phone=phone).first()
    if user is None:
        abort(404, "这个手机号还没注册，请先注册")
    _check_password_rule(password)
    _verify_code(phone, code)
    user.password_hash = generate_password_hash(password)
    db.session.commit()
    _pw_fails.pop(phone, None)
    return _issue(user, "login", "password")


@bp.post("/auth/password")
@login_required
def set_password():
    """已登录用户设置 / 修改登录密码：用绑定手机号收到的验证码确认（Apple 账号没绑手机号时不能设）"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    if not user.phone:
        abort(400, "请先绑定手机号再设置密码")
    password = str(data.get("password", ""))
    _check_password_rule(password)
    _verify_code(user.phone, str(data.get("code", "")).strip())
    user.password_hash = generate_password_hash(password)
    db.session.commit()
    _pw_fails.pop(user.phone, None)
    return jsonify({"user": user.to_dict()})


@bp.post("/auth/login")
def login_with_phone():
    """手机号登录：只登录已注册的号码（注册走 /auth/register）"""
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    code = str(data.get("code", "")).strip()
    user = User.query.filter_by(phone=phone).first()
    if user is None:
        abort(404, "这个手机号还没注册，请先注册")
    _verify_code(phone, code)
    return _issue(user, "login", "phone")


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
    kind = "login"
    if user is None:
        user = User(apple_sub=sub)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        kind = "signup"
    _remember_apple_identity(user, claims, data.get("profile") or {})
    db.session.commit()
    return _issue(user, kind, "apple")


def _remember_apple_identity(user: User, claims: dict, profile: dict) -> None:
    """记下 Apple 给的姓名（只在首次授权时有）和邮箱，管理后台用来认人。"""
    name = str(profile.get("nickname") or "").strip()[:64]
    if name and not user.apple_name:
        user.apple_name = name
    email = str(claims.get("email") or "").strip()[:128]
    if email:
        user.apple_email = email


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
    kind = "login"
    if user is None:
        user = User(wx_openid=openid)
        _apply_profile(user, data.get("profile") or {})
        db.session.add(user)
        db.session.commit()
        kind = "signup"
    return _issue(user, kind, "wechat")


@bp.post("/auth/guest")
def login_as_guest():
    """先用后登：创建匿名本地账号，后续可绑定手机 / Apple。"""
    data = request.get_json(silent=True) or {}
    user = User()
    _apply_profile(user, data.get("profile") or {})
    db.session.add(user)
    db.session.commit()
    return _issue(user, "signup", "guest")


@bp.post("/auth/bind")
@login_required
def bind_account():
    """把当前账号绑定到手机号（验证码）或 Apple。
    手机号已经是另一个账号的（比如在 App 里用这个手机号注册过）：带 merge=true 时把当前账号合并进那个账号，
    两边的试卷都保留，返回那个账号的新 token；不带 merge 时 409（error = phone_taken）。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    if data.get("phone"):
        phone, code = str(data["phone"]).strip(), str(data.get("code", "")).strip()
        if not PHONE_RE.match(phone):
            abort(400, "请输入 11 位手机号")
        _verify_code(phone, code)
        return _bind_phone(user, phone, bool(data.get("merge")))
    elif data.get("identityToken"):
        claims = _decode_identity_token(str(data["identityToken"]))
        if User.query.filter(User.apple_sub == claims.get("sub"), User.id != user.id).first():
            abort(400, "该 Apple ID 已绑定其他账号")
        user.apple_sub = claims.get("sub")
        _remember_apple_identity(user, claims, data.get("profile") or {})
    else:
        abort(400, "缺少绑定信息")
    db.session.commit()
    return jsonify({"user": user.to_dict()})


@bp.post("/auth/bind/wechat-phone")
@login_required
def bind_wechat_phone():
    """小程序「手机号快速验证」（button open-type=getPhoneNumber 给的 code）换手机号后绑定；规则同 /auth/bind"""
    data = request.get_json(silent=True) or {}
    code = str(data.get("code", "")).strip()
    if not code:
        abort(400, "缺少 code")
    return _bind_phone(current_user(), _wx_phone(code), bool(data.get("merge")))


def _bind_phone(user: User, phone: str, merge: bool):
    if user.phone == phone:
        return jsonify({"user": user.to_dict()})
    if user.phone:
        abort(400, "这个账号已经绑定了手机号 " + user.phone[:3] + "****" + user.phone[-4:])
    other = User.query.filter(User.phone == phone, User.id != user.id).first()
    if other is None:
        user.phone = phone
        db.session.commit()
        return jsonify({"user": user.to_dict()})
    if not merge:
        return jsonify({"error": "phone_taken", "message": "这个手机号已经有账号了，合并后两边的试卷都会保留"}), 409
    if user.wx_openid and other.wx_openid and user.wx_openid != other.wx_openid:
        abort(409, "这个手机号已经绑定了另一个微信，不能合并")
    if user.apple_sub and other.apple_sub and user.apple_sub != other.apple_sub:
        abort(409, "这个手机号已经绑定了另一个 Apple ID，不能合并")
    merge_accounts(user, other)
    db.session.commit()
    return _issue(other, "login", "merge")


def merge_accounts(source: User, target: User) -> None:
    """把 source 合并进 target：试卷、云同步数据、导出、扫描 / 擦除任务、使用记录都搬过去，登录方式（微信 / Apple）也挪过去，
    然后删掉 source。资料（称呼、年级、学科、密码）以 target 为准。调用方负责 commit。"""
    from ..models import DigitizeJob, EraseJob, ExportJob, Mistake, PracticeSession, ReviewLog, UsageEvent
    from .sync import merge_user_sync

    log.info("merge account %s -> %s", source.id, target.id)
    merge_user_sync(source.id, target.id)
    from .plans import merge_user_plans

    merge_user_plans(source.id, target.id)
    from .homework import merge_user_homework

    merge_user_homework(source.id, target.id)
    for model in (Mistake, ReviewLog, PracticeSession, DigitizeJob, ExportJob, EraseJob, UsageEvent):
        model.query.filter_by(user_id=source.id).update({"user_id": target.id}, synchronize_session=False)
    openid, apple_sub, apple_name, apple_email = source.wx_openid, source.apple_sub, source.apple_name, source.apple_email
    source.wx_openid = source.apple_sub = None
    db.session.flush()  # 先腾出唯一键，再挂到 target 上
    if openid and not target.wx_openid:
        target.wx_openid = openid
    if apple_sub and not target.apple_sub:
        target.apple_sub = apple_sub
        target.apple_name = target.apple_name or apple_name
        target.apple_email = target.apple_email or apple_email
    if not target.grade and source.grade:
        target.grade = source.grade
    db.session.expire(source, ["mistakes"])
    db.session.delete(source)


_wx_token: dict = {"value": "", "expires": 0.0}


def _wx_access_token() -> str:
    """小程序接口调用凭证（client_credential），进程内缓存，提前 5 分钟刷新"""
    import os
    import urllib.parse
    import urllib.request

    if _wx_token["value"] and _wx_token["expires"] > time.time():
        return _wx_token["value"]
    appid, secret = os.getenv("WX_APPID", "").strip(), os.getenv("WX_SECRET", "").strip()
    if not (appid and secret):
        abort(503, "微信登录还没配置（服务器缺少 WX_APPID / WX_SECRET）")
    query = urllib.parse.urlencode({"grant_type": "client_credential", "appid": appid, "secret": secret})
    try:
        with urllib.request.urlopen(f"https://api.weixin.qq.com/cgi-bin/token?{query}", timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.warning("wx token failed: %s", e)
        abort(502, "连接微信服务器失败，请稍后再试")
    if not data.get("access_token"):
        log.warning("wx token error: %s", data)
        abort(502, "微信接口调用失败：" + str(data.get("errmsg") or "未知错误"))
    _wx_token.update(value=data["access_token"], expires=time.time() + int(data.get("expires_in") or 7200) - 300)
    return _wx_token["value"]


def _wx_phone(code: str) -> str:
    """getPhoneNumber 的 code 换手机号（getuserphonenumber）。需要小程序是企业 / 个体户主体"""
    import os
    import urllib.request

    if current_app.config.get("TESTING") and not os.getenv("WX_APPID", "").strip():
        return code if PHONE_RE.match(code) else abort(400, "手机号获取失败")  # 测试：code 就是手机号
    token = _wx_access_token()
    req = urllib.request.Request(
        f"https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token={token}",
        data=json.dumps({"code": code}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.warning("getuserphonenumber failed: %s", e)
        abort(502, "连接微信服务器失败，请稍后再试")
    if data.get("errcode") in (40001, 42001):
        _wx_token["value"] = ""
    phone = str((data.get("phone_info") or {}).get("purePhoneNumber") or "")
    if not PHONE_RE.match(phone):
        log.warning("getuserphonenumber error: %s", {k: v for k, v in data.items() if k != "phone_info"})
        abort(400, "手机号获取失败：" + str(data.get("errmsg") or "请改用验证码"))
    return phone


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
    """当前用户；同时给一个新 token（App 每次打开都调，常用就一直保持登录，直到主动退出）"""
    user = current_user()
    track(user, "open")
    return jsonify({"user": user.to_dict(), "token": create_access_token(identity=user.id)})


@bp.route("/auth/me", methods=["PATCH", "PUT"])  # 小程序 wx.request 不支持 PATCH，用 PUT
@login_required
def update_me():
    user = current_user()
    _apply_profile(user, request.get_json(silent=True) or {})
    db.session.commit()
    return jsonify({"user": user.to_dict()})


@bp.post("/auth/avatar/upload-url")
@login_required
def avatar_upload_url():
    """换头像第一步：要一个上传地址。客户端把缩好的 JPG 直接 PUT 上去，再调 POST /auth/avatar 确认"""
    from .. import avatars, storage

    user = current_user()
    version = avatars.new_version()
    url = storage.get_storage().presign(avatars.avatar_key(user.id, version), "PUT")
    return jsonify({"version": version, "method": "PUT", "url": url, "headers": {"Content-Type": "image/jpeg"}})


@bp.post("/auth/avatar")
@login_required
def avatar_confirm():
    """换头像第二步：图片传上去了，把它设成当前头像"""
    from .. import avatars, storage

    user = current_user()
    version = str((request.get_json(silent=True) or {}).get("version") or "")
    if not version.isalnum() or len(version) > 16:
        abort(400, "头像没传上去，请重试")
    key = avatars.avatar_key(user.id, version)
    store = storage.get_storage()
    size = store.exists(key)
    if not size:
        abort(400, "头像没传上去，请重试")
    if size > avatars.MAX_AVATAR_BYTES:
        store.delete([key])
        abort(413, "图片太大了，换一张小一点的")
    avatars.set_avatar(user.id, version)
    return jsonify({"user": user.to_dict()})


@bp.delete("/auth/me")
@login_required
def delete_me():
    """注销账号：账号和服务器上跟这个人有关的记录全部删掉，包括云同步的试卷和对象存储里的照片（App Store 要求 App 内能注销）。本机的试卷照片在设备上，不受影响。"""
    from ..models import DigitizeJob, PracticeSession, ReviewLog, UsageEvent

    from .erase import delete_user_erase_jobs
    from .exports import delete_user_exports
    from .sync import delete_user_sync

    user = current_user()
    delete_user_exports(user.id)
    delete_user_sync(user.id, drop_counter=True)
    delete_user_erase_jobs(user.id)
    from .plans import delete_user_plans

    delete_user_plans(user.id)
    from .homework import delete_user_homework

    delete_user_homework(user.id)
    from ..avatars import delete_avatar

    delete_avatar(user.id)
    for model in (ReviewLog, PracticeSession, DigitizeJob, UsageEvent):
        model.query.filter_by(user_id=user.id).delete(synchronize_session=False)
    db.session.delete(user)
    db.session.commit()
    return jsonify({"ok": True})
