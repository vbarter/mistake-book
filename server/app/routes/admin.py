"""管理后台：https://book.openmindai.cn/admin ，看有多少人在用、用到什么程度。

密码在服务器 .env 的 ADMIN_PASSWORD 里；没配置时整个后台不开放（404）。
登录后发一个签名 cookie（7 天有效，只在 /admin 下发送）；同一 IP 连续输错 5 次锁 15 分钟。
只统计有账号的人（手机号 / Apple / 微信，一个账号一个人），游客只单独计数；不含审核账号（REVIEW_PHONE）。
"""
from __future__ import annotations

import hmac
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, make_response, redirect, request, send_file
from itsdangerous import BadSignature, URLSafeTimedSerializer

from ..extensions import db
from ..models import UsageEvent, User

bp = Blueprint("admin", __name__)

PAGES = Path(__file__).resolve().parent.parent / "admin"
COOKIE = "zcb_admin"
COOKIE_MAX_AGE = 7 * 24 * 3600
MAX_FAILS, LOCK_SECONDS = 5, 15 * 60
_fails: dict[str, tuple[int, float]] = {}

# 用户主动做的事算「活跃」；scan_done / scan_fail 是服务器后台任务写的
ACTIVE_KINDS = ("open", "signup", "login", "scan", "grade", "pdf", "book")
PLATFORMS = ("ios", "android", "wechat", "web")


def _password() -> str:
    return (current_app.config.get("ADMIN_PASSWORD") or "").strip()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="zcb-admin")


def _logged_in() -> bool:
    raw = request.cookies.get(COOKIE)
    if not raw:
        return False
    try:
        _serializer().loads(raw, max_age=COOKIE_MAX_AGE)
        return True
    except BadSignature:
        return False


def _client_ip() -> str:
    return request.headers.get("X-Real-IP") or request.remote_addr or "?"


@bp.before_request
def _gate():
    if not _password():
        abort(404)
    if request.endpoint in ("admin.login_page", "admin.login"):
        return None
    if not _logged_in():
        if request.path.startswith("/admin/api/"):
            abort(401, "请先登录管理后台")
        return redirect("/admin/login")
    return None


@bp.get("/admin/login")
def login_page():
    if _logged_in():
        return redirect("/admin")
    return send_file(PAGES / "login.html")


@bp.post("/admin/login")
def login():
    ip = _client_ip()
    fails, locked_until = _fails.get(ip, (0, 0.0))
    if locked_until > time.time():
        abort(429, f"输错次数太多，请 {int((locked_until - time.time()) // 60) + 1} 分钟后再试")
    data = request.get_json(silent=True) or request.form
    if not hmac.compare_digest(str(data.get("password", "")).encode(), _password().encode()):
        fails += 1
        _fails[ip] = (fails, time.time() + LOCK_SECONDS if fails >= MAX_FAILS else 0.0)
        abort(400, "密码不对")
    _fails.pop(ip, None)
    resp = make_response(jsonify({"ok": True}))
    secure = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
    resp.set_cookie(COOKIE, _serializer().dumps("admin"), max_age=COOKIE_MAX_AGE, path="/admin", httponly=True, secure=secure, samesite="Strict")
    return resp


@bp.post("/admin/logout")
def logout():
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(COOKIE, path="/admin")
    return resp


@bp.get("/admin")
def dashboard():
    resp = make_response(send_file(PAGES / "index.html"))
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _method(u: User) -> str:
    return "apple" if u.apple_sub else "wechat" if u.wx_openid else "phone" if u.phone else "guest"


def _identities(u: User) -> list[dict]:
    """这个人是谁：手机号、Apple（有邮箱显示邮箱，否则 ID 尾号）、微信（openid 尾号）。一个账号可能绑了几种。"""
    out = []
    if u.phone:
        out.append({"kind": "phone", "value": u.phone})
    if u.apple_sub:
        out.append({"kind": "apple", "value": u.apple_email or f"ID …{u.apple_sub[-6:]}"})
    if u.wx_openid:
        out.append({"kind": "wechat", "value": f"openid …{u.wx_openid[-6:]}"})
    return out


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


def _bucket(n: int, edges: list[tuple[int, int | None, str]]) -> str:
    for lo, hi, label in edges:
        if n >= lo and (hi is None or n <= hi):
            return label
    return edges[-1][2]


@bp.get("/admin/api/stats")
def stats():
    days = max(7, min(180, request.args.get("days", 30, type=int)))
    now = datetime.now()
    today = now.date()
    start_day = today - timedelta(days=days - 1)
    start = datetime.combine(start_day, datetime.min.time())

    review_phone = current_app.config.get("REVIEW_PHONE") or ""
    everyone = [u for u in User.query.all() if not (review_phone and u.phone == review_phone)]
    users = [u for u in everyone if _method(u) != "guest"]
    guests = len(everyone) - len(users)
    user_ids = {u.id for u in users}

    # 窗口内的事件 + 每个用户历史上是否扫过、扫了几次（总量不大，直接取出来在内存里算）
    midnight = datetime.combine(today, datetime.min.time())
    since30 = midnight - timedelta(days=29)
    recent = [e for e in UsageEvent.query.filter(UsageEvent.created_at >= min(start, since30)).all() if e.user_id in user_ids]
    events = [e for e in recent if e.created_at >= start]
    first_event = db.session.query(db.func.min(UsageEvent.created_at)).scalar()

    def day_of(dt: datetime) -> date:
        return dt.date()

    def active_since(since: datetime) -> set[str]:
        return {e.user_id for e in recent if e.kind in ACTIVE_KINDS and e.created_at >= since}

    active = {
        "today": len(active_since(midnight)),
        "d7": len(active_since(midnight - timedelta(days=6))),
        "d30": len(active_since(since30)),
    }

    # 每日：新用户、活跃用户、扫描次数、扫描照片数
    daily_new = Counter(day_of(u.created_at) for u in users if u.created_at and u.created_at >= start)
    daily_active: dict[date, set[str]] = defaultdict(set)
    daily_scans, daily_pages = Counter(), Counter()
    for e in events:
        d = day_of(e.created_at)
        if e.kind in ACTIVE_KINDS:
            daily_active[d].add(e.user_id)
        if e.kind == "scan":
            daily_scans[d] += 1
            daily_pages[d] += e.pages or 0
    daily = []
    for i in range(days):
        d = start_day + timedelta(days=i)
        daily.append({"date": d.isoformat(), "newUsers": daily_new[d], "active": len(daily_active[d]), "scans": daily_scans[d], "pages": daily_pages[d]})

    # 各端活跃人数（窗口内在这一端出现过）
    per_platform: dict[str, set[str]] = defaultdict(set)
    for e in events:
        if e.kind in ACTIVE_KINDS and e.platform:
            per_platform[e.platform].add(e.user_id)
    platforms = {p: len(per_platform.get(p, set())) for p in PLATFORMS}

    # 扫描质量
    scans = [e for e in events if e.kind == "scan"]
    done = [e for e in events if e.kind == "scan_done"]
    failed = [e for e in events if e.kind == "scan_fail"]
    scan_pages = sum(e.pages or 0 for e in scans)
    finished = len(done) + len(failed)
    scan_stats = {
        "total": len(scans),
        "users": len({e.user_id for e in scans}),
        "pages": scan_pages,
        "avgPages": round(scan_pages / len(scans), 1) if scans else 0,
        "done": len(done),
        "failed": len(failed),
        "successRate": round(100 * len(done) / finished) if finished else None,
        "questions": sum(e.questions or 0 for e in done),
        "wrong": sum(e.wrong or 0 for e in done),
        "grades": sum(1 for e in events if e.kind == "grade"),
        "pdfs": sum(1 for e in events if e.kind == "pdf"),
        "books": sum(1 for e in events if e.kind == "book"),
    }

    # 使用深度：窗口内每人扫了几次、活跃了几天
    scans_by_user = Counter(e.user_id for e in scans)
    days_by_user: dict[str, set[date]] = defaultdict(set)
    for e in events:
        if e.kind in ACTIVE_KINDS:
            days_by_user[e.user_id].add(day_of(e.created_at))
    active_users = list(days_by_user)
    scan_edges = [(0, 0, "没扫过"), (1, 1, "1 次"), (2, 5, "2–5 次"), (6, 20, "6–20 次"), (21, None, "20 次以上")]
    day_edges = [(1, 1, "1 天"), (2, 3, "2–3 天"), (4, 7, "4–7 天"), (8, 14, "8–14 天"), (15, None, "15 天以上")]
    scan_depth = Counter(_bucket(scans_by_user.get(uid, 0), scan_edges) for uid in active_users)
    day_depth = Counter(_bucket(len(days_by_user[uid]), day_edges) for uid in active_users)

    # 漏斗（窗口内）：活跃 → 扫过 1 次 → 扫过 3 次以上 → 活跃 3 天以上
    funnel = [
        {"label": "打开过 App", "value": len(active_users)},
        {"label": "扫过试卷", "value": sum(1 for uid in active_users if scans_by_user.get(uid, 0) >= 1)},
        {"label": "扫过 3 次以上", "value": sum(1 for uid in active_users if scans_by_user.get(uid, 0) >= 3)},
        {"label": "活跃 3 天以上", "value": sum(1 for uid in active_users if len(days_by_user[uid]) >= 3)},
    ]

    # 留存：窗口内注册的人，第 2 天 / 第 7 天还来不来（只算已经过了那一天的人）
    def retention(offset: int) -> dict:
        cohort = [u for u in users if u.created_at and u.created_at >= start and day_of(u.created_at) + timedelta(days=offset) <= today]
        back = sum(1 for u in cohort if day_of(u.created_at) + timedelta(days=offset) in days_by_user.get(u.id, set()))
        return {"cohort": len(cohort), "back": back, "rate": round(100 * back / len(cohort)) if cohort else None}

    by_method = Counter(_method(u) for u in users)
    grades = Counter(u.grade or "?" for u in users)
    new_since = lambda d: sum(1 for u in users if u.created_at and u.created_at >= midnight - timedelta(days=d - 1))  # noqa: E731

    # 用户列表：最近活跃在前；扫描次数等按窗口内统计
    pages_by_user = Counter()
    exports_by_user = Counter()
    for e in events:
        if e.kind == "scan":
            pages_by_user[e.user_id] += e.pages or 0
        elif e.kind in ("pdf", "book"):
            exports_by_user[e.user_id] += 1
    ordered = sorted(users, key=lambda u: (u.last_active_at or u.created_at or datetime.min), reverse=True)
    user_rows = [
        {
            "id": u.id,
            "name": u.apple_name or u.nickname,
            "nickname": u.nickname,
            "identities": _identities(u),
            "method": _method(u),
            "grade": u.grade,
            "createdAt": _iso(u.created_at),
            "lastActiveAt": _iso(u.last_active_at),
            "platform": u.last_platform,
            "activeDays": len(days_by_user.get(u.id, set())),
            "scans": scans_by_user.get(u.id, 0),
            "pages": pages_by_user.get(u.id, 0),
            "exports": exports_by_user.get(u.id, 0),
        }
        for u in ordered[:200]
    ]

    return jsonify(
        {
            "generatedAt": _iso(now),
            "days": days,
            "trackingSince": _iso(first_event),
            "users": {
                "total": len(users),
                "guests": guests,
                "byMethod": {m: by_method.get(m, 0) for m in ("phone", "apple", "wechat")},
                "new": {"today": new_since(1), "d7": new_since(7), "d30": new_since(30)},
            },
            "active": active,
            "platforms": platforms,
            "daily": daily,
            "scans": scan_stats,
            "depth": {
                "scans": [{"label": label, "value": scan_depth.get(label, 0)} for _, _, label in scan_edges],
                "days": [{"label": label, "value": day_depth.get(label, 0)} for _, _, label in day_edges],
            },
            "funnel": funnel,
            "retention": {"d1": retention(1), "d7": retention(7)},
            "grades": [{"grade": g, "value": grades.get(g, 0)} for g in [str(i) for i in range(1, 13)]],
            "userList": user_rows,
        }
    )
