"""今天作业计划（待办）：录入作业 → 确认清单 → 每项设提醒时间 → 到点自动开始计时 → 一项一项做完、拍完成照片。

- 一个人一天一份清单（homework_items 按 user_id + day），day 按北京时间算。
- 提醒时间是「HH:MM」。到点自动开始计时不靠定时任务：每次读清单、改清单时用 advance() 按当前时间把该开始的项推成计时中，
  开始时间记成提醒时间（或上一项做完的时间），所以孩子晚点打开 App，看到的已用时间也是从提醒时间算起的。
- 同一时间只有一项在计时。到点时如果另一项还在计时（或暂停中），这一项不打断，等那一项做完再接着开始（清单上显示「已过」）。
- 「接着上一项」（chain）：上一项做完就开始。
- 完成照片走对象存储签名链接直传，key 为 hw/<itemId>/<photoId>.jpg。

界面稿见项目文件 screenshots/homework-today/，产品设计文档「今天作业计划（待办事项）产品设计」。
"""
from __future__ import annotations

import base64
import logging
import secrets
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from flask import Blueprint, abort, current_app, jsonify, request

from .. import storage
from ..ai import AIError, get_provider
from ..ai.base import Crop
from ..auth_utils import current_user, login_required
from ..extensions import db
from ..homework_parse import HOMEWORK_SUBJECTS, MAX_ITEMS, MAX_TITLE, estimate, guess_subject, normalize, same_homework
from ..models import HomeworkItem, Plan, PlanAssignment, PlanMember, PlanSubmission

bp = Blueprint("homework", __name__)
log = logging.getLogger(__name__)

MAX_IMAGES = 6
MAX_PHOTOS = 9
SNOOZE_MINUTES = 10
STATUSES = ("todo", "running", "paused", "done")


# --------------------------------------------------------------------------- 时间


def _tz() -> ZoneInfo:
    return ZoneInfo(current_app.config.get("HOMEWORK_TZ") or "Asia/Shanghai")


def now_local() -> datetime:
    """北京时间的「现在」，不带时区（库里的时间都按这个存）。测试里可以用 HOMEWORK_NOW 固定"""
    fixed = current_app.config.get("HOMEWORK_NOW")
    if fixed:
        return fixed() if callable(fixed) else fixed
    return datetime.now(_tz()).replace(tzinfo=None)


def _today() -> str:
    return now_local().date().isoformat()


def _day_arg(value) -> str:
    if not value:
        return _today()
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        abort(400, "日期格式不对")


def _hhmm(value) -> str | None:
    """「18:45」/「18:5」→「18:45」/「18:05」；空 → None；不合法 → 400"""
    if value in (None, ""):
        return None
    try:
        h, m = str(value).split(":")
        h, m = int(h), int(m)
    except ValueError:
        abort(400, "提醒时间格式不对")
    if not (0 <= h <= 23 and 0 <= m <= 59):
        abort(400, "提醒时间格式不对")
    return f"{h:02d}:{m:02d}"


def _at(day: str, hhmm: str) -> datetime:
    h, m = hhmm.split(":")
    return datetime.fromisoformat(day).replace(hour=int(h), minute=int(m))


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


# --------------------------------------------------------------------------- 计时推进


def _items(user_id: str, day: str) -> list[HomeworkItem]:
    return HomeworkItem.query.filter_by(user_id=user_id, day=day).order_by(HomeworkItem.position, HomeworkItem.created_at).all()


def _used(item: HomeworkItem, now: datetime) -> int:
    """已用秒数：之前几段 + 正在计的这一段"""
    used = item.elapsed or 0
    if item.status == "running" and item.started_at:
        used += max(0, int((now - item.started_at).total_seconds()))
    return used


def _due(items: list[HomeworkItem], i: int) -> datetime | None:
    """这一项什么时候该自动开始：提醒时间；「接着上一项」的是上一项做完的时间"""
    item = items[i]
    if item.chain:
        prev = items[i - 1] if i > 0 else None
        if prev is not None and prev.status == "done" and prev.finished_at:
            return prev.finished_at
        return None
    return _at(item.day, item.remind_at) if item.remind_at else None


def _start(item: HomeworkItem, at: datetime, auto: bool) -> None:
    item.status, item.started_at, item.auto_started = "running", at, auto
    item.first_started_at = item.first_started_at or at


def advance(items: list[HomeworkItem], now: datetime) -> bool:
    """按当前时间推进：没有项在计时 / 暂停时，最早到点的那一项自动开始。返回有没有改动（调用方负责 commit）。

    开始时间 = max(提醒时间, 最近一项做完的时间)：到点时上一项还没做完的，从上一项做完那一刻算起。"""
    if not items or items[0].day != now.date().isoformat():
        return False  # 只推进今天的清单；昨天没做完的不再自动开始
    if any(it.status in ("running", "paused") for it in items):
        return False
    last_done = max((it.finished_at for it in items if it.status == "done" and it.finished_at), default=None)
    best: tuple[datetime, int] | None = None
    for i, it in enumerate(items):
        if it.status != "todo":
            continue
        due = _due(items, i)
        if due is None or due > now:
            continue
        if best is None or due < best[0]:
            best = (due, i)
    if best is None:
        return False
    due, i = best
    _start(items[i], max(due, last_done) if last_done else due, auto=True)
    return True


# --------------------------------------------------------------------------- 输出


def _photo_view(item: HomeworkItem, store) -> list[dict]:
    out = []
    for p in item.photos or []:
        if p.get("uploaded"):
            out.append({"id": p["id"], "url": store.presign(_photo_key(item.id, p["id"]), "GET")})
    return out


def _photo_key(item_id: str, photo_id: str) -> str:
    return f"hw/{item_id}/{photo_id}.jpg"


def _view(item: HomeworkItem, now: datetime, items: list[HomeworkItem], store=None) -> dict:
    i = items.index(item) if item in items else -1
    due = _due(items, i) if i >= 0 else None
    return {
        "id": item.id,
        "day": item.day,
        "title": item.title,
        "subject": item.subject or "other",
        "position": item.position or 0,
        "source": item.source,
        "planAssignmentId": item.plan_assignment_id,
        "remindAt": item.remind_at,
        "chain": bool(item.chain),
        "est": item.est_minutes or 20,
        "status": item.status,
        "used": _used(item, now),
        "startedAt": _iso(item.started_at),
        "firstStartedAt": _iso(item.first_started_at),
        "autoStarted": bool(item.auto_started),
        "finishedAt": _iso(item.finished_at),
        # 提醒时间已经过了、还没开始（另一项在计时，等它做完再接着开始）
        "late": item.status == "todo" and due is not None and due <= now,
        "photos": _photo_view(item, store) if store is not None and item.photos else [],
        "photoCount": sum(1 for p in item.photos or [] if p.get("uploaded")),
    }


def _summary(items: list[HomeworkItem], now: datetime) -> dict:
    done = [it for it in items if it.status == "done"]
    left = [it for it in items if it.status != "done"]
    running = next((it for it in items if it.status in ("running", "paused")), None)
    upcoming = None
    if running is None:
        for i, it in enumerate(items):
            if it.status != "todo":
                continue
            due = _due(items, i)
            if due is not None and due > now and (upcoming is None or due < upcoming[0]):
                upcoming = (due, it)
    starts = [it.first_started_at for it in items if it.first_started_at]
    return {
        "total": len(items),
        "done": len(done),
        "left": len(left),
        "used": sum(_used(it, now) for it in items),
        "est": sum(it.est_minutes or 0 for it in items),
        "currentId": running.id if running else None,
        "nextId": upcoming[1].id if upcoming else None,
        "nextAt": upcoming[1].remind_at if upcoming and not upcoming[1].chain else None,
        "startedAt": _iso(min(starts)) if starts else None,
        "finishedAt": _iso(max(it.finished_at for it in done)) if items and len(done) == len(items) else None,
        "allDone": bool(items) and len(done) == len(items),
    }


def _day_payload(user_id: str, day: str) -> dict:
    now = now_local()
    items = _items(user_id, day)
    if advance(items, now):
        db.session.commit()
    store = storage.get_storage() if any(it.photos for it in items) else None
    return {"day": day, "today": _today(), "now": _iso(now), "items": [_view(it, now, items, store) for it in items], "summary": _summary(items, now)}


def _own(item_id: str) -> HomeworkItem:
    item = db.session.get(HomeworkItem, item_id)
    if item is None or item.user_id != current_user().id:
        abort(404, "这一项不存在或已删除")
    return item


# --------------------------------------------------------------------------- 学习计划里今天要交的作业


def plan_due(user_id: str, day: str) -> list[dict]:
    """我加入的学习计划里，今天到明天截止、还没交（或被退回）的作业"""
    start = datetime.fromisoformat(day)
    end = start + timedelta(days=2)
    joined = [m.plan_id for m in PlanMember.query.filter_by(user_id=user_id, removed=False).all()]
    if not joined:
        return []
    plans = {p.id: p for p in Plan.query.filter(Plan.id.in_(joined)).all()}
    out = []
    for a in PlanAssignment.query.filter(PlanAssignment.plan_id.in_(list(plans)), PlanAssignment.revoked.is_(False)).all():
        try:
            due = datetime.fromisoformat(str(a.due_at or "").replace("Z", "+00:00"))
        except ValueError:
            continue
        if due.tzinfo is not None:
            due = due.astimezone(_tz()).replace(tzinfo=None)
        if not (start <= due < end):
            continue
        sub = PlanSubmission.query.filter_by(assignment_id=a.id, user_id=user_id).first()
        if sub is not None and sub.status != "returned":
            continue
        plan = plans[a.plan_id]
        out.append({"assignmentId": a.id, "planId": plan.id, "title": a.title, "planName": plan.name, "subject": plan.subject if plan.subject in HOMEWORK_SUBJECTS else None, "dueAt": a.due_at})
    out.sort(key=lambda x: x["dueAt"] or "")
    return out


def _teacher_names(plan_ids: list[str]) -> dict[str, str]:
    from ..models import User

    plans = Plan.query.filter(Plan.id.in_(plan_ids)).all() if plan_ids else []
    users = {u.id: u for u in User.query.filter(User.id.in_([p.owner_id for p in plans])).all()} if plans else {}
    return {p.id: (users[p.owner_id].nickname if p.owner_id in users else "") or "老师" for p in plans}


# --------------------------------------------------------------------------- 接口


@bp.get("/homework")
@login_required
def get_day():
    """某一天的清单（默认今天），读的时候顺带按时间推进自动开始"""
    return jsonify(_day_payload(current_user().id, _day_arg(request.args.get("day"))))


@bp.post("/homework/parse")
@login_required
def parse():
    """把文字、照片拆成一项一项作业，按学科分好、估好用时；顺带对一下学习计划里今天要交的作业。不落库，确认后再 POST /homework/items"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "")[:4000]
    raw_images = data.get("images") or []
    if not isinstance(raw_images, list) or len(raw_images) > MAX_IMAGES:
        abort(400, f"一次最多 {MAX_IMAGES} 张照片")
    if not text.strip() and not raw_images:
        abort(400, "说一句、拍一张，或者打几个字")
    images = []
    for raw in raw_images:
        try:
            header, b64 = str(raw).split(",", 1)
            blob = base64.b64decode(b64)
        except Exception:  # noqa: BLE001
            abort(400, "图片解码失败")
        media = "image/png" if "image/png" in header else "image/webp" if "image/webp" in header else "image/jpeg"
        images.append(Crop(data=blob, media_type=media))
    try:
        items = get_provider().parse_homework(text, images)
    except AIError as e:
        abort(502, str(e))
    items = normalize(items, text)
    day = _day_arg(data.get("day"))
    due = plan_due(user.id, day)
    already = {it.plan_assignment_id for it in _items(user.id, day) if it.plan_assignment_id}
    teachers = _teacher_names(list({d["planId"] for d in due}))
    for d in due:
        d["teacher"] = teachers.get(d["planId"], "老师")
    left = [d for d in due if d["assignmentId"] not in already]
    for it in items:
        hit = next((d for d in left if same_homework(it["title"], d["title"])), None)
        if hit:
            it["planAssignmentId"], it["teacher"] = hit["assignmentId"], hit["teacher"]
            left.remove(hit)
    return jsonify({"items": items, "planDue": left})


def _clean_new(raw: dict) -> dict:
    title = str(raw.get("title") or "").strip()[:MAX_TITLE]
    if not title:
        abort(400, "作业内容不能是空的")
    subject = str(raw.get("subject") or "")
    if subject not in HOMEWORK_SUBJECTS:
        subject = guess_subject(title)
    try:
        est = int(raw.get("est") or 0)
    except (TypeError, ValueError):
        est = 0
    if not 3 <= est <= 180:
        est = estimate(title)
    source = str(raw.get("source") or "text")
    return {
        "title": title, "subject": subject, "est_minutes": est,
        "source": source if source in ("text", "voice", "photo", "plan") else "text",
        "plan_assignment_id": str(raw.get("planAssignmentId") or "")[:32] or None,
        "remind_at": _hhmm(raw.get("remindAt")),
        "chain": bool(raw.get("chain")),
    }


@bp.post("/homework/items")
@login_required
def add_items():
    """加入清单（一项或多项），排在当天清单的最后。返回整份清单"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    day = _day_arg(data.get("day"))
    raw = data.get("items")
    if not isinstance(raw, list) or not raw:
        abort(400, "没有要加的作业")
    existing = _items(user.id, day)
    if len(existing) + len(raw) > MAX_ITEMS * 2:
        abort(400, "一天的作业太多了，先删掉一些")
    pos = max((it.position or 0 for it in existing), default=-1) + 1
    for r in raw:
        if not isinstance(r, dict):
            abort(400, "格式不对")
        db.session.add(HomeworkItem(user_id=user.id, day=day, position=pos, **_clean_new(r)))
        pos += 1
    db.session.commit()
    return jsonify(_day_payload(user.id, day)), 201


@bp.route("/homework/items/<item_id>", methods=["PATCH", "PUT"])  # 小程序的 wx.request 没有 PATCH
@login_required
def update_item(item_id: str):
    """改字、换学科、改提醒时间 / 接着上一项、调整顺序"""
    item = _own(item_id)
    data = request.get_json(silent=True) or {}
    if "title" in data:
        title = str(data["title"] or "").strip()[:MAX_TITLE]
        if not title:
            abort(400, "作业内容不能是空的")
        item.title = title
    if "subject" in data:
        if data["subject"] not in HOMEWORK_SUBJECTS:
            abort(400, "学科不对")
        item.subject = data["subject"]
    if "remindAt" in data:
        item.remind_at = _hhmm(data["remindAt"])
        if item.remind_at:
            item.chain = False
    if "chain" in data:
        item.chain = bool(data["chain"])
        if item.chain:
            item.remind_at = None
    if "position" in data:
        try:
            item.position = int(data["position"])
        except (TypeError, ValueError):
            abort(400, "顺序不对")
    db.session.commit()
    return jsonify(_day_payload(item.user_id, item.day))


@bp.delete("/homework/items/<item_id>")
@login_required
def delete_item(item_id: str):
    item = _own(item_id)
    user_id, day = item.user_id, item.day
    _delete_photos([item])
    db.session.delete(item)
    db.session.commit()
    return jsonify(_day_payload(user_id, day))


@bp.post("/homework/schedule")
@login_required
def schedule():
    """一键排好提醒时间：从 from 开始，按清单顺序和每项估的用时依次排（第一项之后的都排成具体钟点，不用「接着上一项」）。
    做完的和正在计时的不动；body 里 off: true 表示把没做的项都改成不提醒。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    day = _day_arg(data.get("day"))
    items = _items(user.id, day)
    if data.get("off"):
        for it in items:
            if it.status == "todo":
                it.remind_at, it.chain = None, False
        db.session.commit()
        return jsonify(_day_payload(user.id, day))
    start = _hhmm(data.get("from"))
    if not start:
        abort(400, "从几点开始？")
    t = _at(day, start)
    for it in items:
        if it.status != "todo":
            continue
        it.remind_at, it.chain = t.strftime("%H:%M"), False
        # 下一项：这一项的用时取整到 5 分钟
        mins = max(5, int(round((it.est_minutes or 20) / 5.0)) * 5)
        nxt = t + timedelta(minutes=mins)
        if nxt.date() != t.date():
            nxt = t  # 排到第二天了：后面的都挤在 23:5x，不跨天
        t = nxt
    db.session.commit()
    return jsonify(_day_payload(user.id, day))


def _stop(item: HomeworkItem, now: datetime) -> None:
    """把正在计的这一段折进 elapsed"""
    if item.status == "running" and item.started_at:
        item.elapsed = (item.elapsed or 0) + max(0, int((now - item.started_at).total_seconds()))
    item.started_at = None


@bp.post("/homework/items/<item_id>/<action>")
@login_required
def act(item_id: str, action: str):
    """计时操作：start 现在开始 · pause 暂停 · resume 继续 · finish 做完了 · undo 取消完成 · snooze 晚 10 分钟再开始 · skip 先跳过"""
    item = _own(item_id)
    now = now_local()
    items = _items(item.user_id, item.day)
    data = request.get_json(silent=True) or {}
    if action == "start":
        if item.status == "done":
            abort(409, "这一项已经做完了")
        # 同一时间只计一项：别的正在计的先停下（回到没做，已用时间保留）
        for other in items:
            if other.id != item.id and other.status in ("running", "paused"):
                _stop(other, now)
                other.status = "todo"
                if other.remind_at and _at(other.day, other.remind_at) <= now:
                    other.remind_at = None  # 已经过了的提醒不再把它拉起来
        if item.status != "running":
            _start(item, now, auto=False)
    elif action == "pause":
        if item.status != "running":
            abort(409, "这一项没在计时")
        _stop(item, now)
        item.status = "paused"
    elif action == "resume":
        if item.status != "paused":
            abort(409, "这一项没暂停")
        item.status, item.started_at = "running", now
    elif action == "finish":
        if item.status == "done":
            return jsonify(_day_payload(item.user_id, item.day))
        _stop(item, now)
        item.status, item.finished_at = "done", now
        item.first_started_at = item.first_started_at or now
    elif action == "undo":
        if item.status != "done":
            abort(409, "这一项还没做完")
        item.status, item.finished_at = "todo", None
        if item.remind_at and _at(item.day, item.remind_at) <= now:
            item.remind_at = None
    elif action == "snooze":
        try:
            minutes = int(data.get("minutes") or SNOOZE_MINUTES)
        except (TypeError, ValueError):
            minutes = SNOOZE_MINUTES
        minutes = min(max(minutes, 1), 120)
        # 停表、已用时间清零（还没真正开始做），提醒时间改到 N 分钟后
        item.status, item.started_at, item.elapsed, item.auto_started = "todo", None, 0, False
        item.first_started_at = None
        at = now + timedelta(minutes=minutes)
        item.remind_at = at.strftime("%H:%M") if at.date() == now.date() else "23:59"
        item.chain = False
    elif action == "skip":
        # 先跳过：停表，已用时间留着，回到没做、不再自动开始，排到最后
        _stop(item, now)
        item.status, item.remind_at, item.chain = "todo", None, False
        item.position = max((it.position or 0 for it in items), default=0) + 1
    else:
        abort(404)
    db.session.commit()
    return jsonify(_day_payload(item.user_id, item.day))


@bp.post("/homework/items/<item_id>/photos")
@login_required
def add_photos(item_id: str):
    """完成拍照：登记 count 张照片，返回直传链接；传完调 /photos/uploaded 确认"""
    item = _own(item_id)
    try:
        count = int((request.get_json(silent=True) or {}).get("count") or 0)
    except (TypeError, ValueError):
        count = 0
    have = len(item.photos or [])
    if count < 1 or have + count > MAX_PHOTOS:
        abort(400, f"一项最多 {MAX_PHOTOS} 张照片")
    store = storage.get_storage()
    new = [{"id": secrets.token_hex(8), "uploaded": False} for _ in range(count)]
    item.photos = [*(item.photos or []), *new]
    db.session.commit()
    uploads = [{"id": p["id"], "method": "PUT", "url": store.presign(_photo_key(item.id, p["id"]), "PUT"), "headers": {"Content-Type": "image/jpeg"}} for p in new]
    return jsonify({"uploads": uploads}), 201


@bp.post("/homework/items/<item_id>/photos/uploaded")
@login_required
def photos_uploaded(item_id: str):
    item = _own(item_id)
    ids = set((request.get_json(silent=True) or {}).get("ids") or [])
    store = storage.get_storage()
    photos = []
    for p in item.photos or []:
        p = dict(p)
        if p["id"] in ids and not p.get("uploaded") and store.exists(_photo_key(item.id, p["id"])) is not None:
            p["uploaded"] = True
        photos.append(p)
    # 没传上去的登记不留着
    item.photos = [p for p in photos if p.get("uploaded") or p["id"] in ids]
    db.session.commit()
    return jsonify(_day_payload(item.user_id, item.day))


# --------------------------------------------------------------------------- 账号合并、注销


def _delete_photos(items: list[HomeworkItem]) -> None:
    keys = [_photo_key(it.id, p["id"]) for it in items for p in it.photos or []]
    if not keys:
        return
    try:
        storage.get_storage().delete(keys)
    except Exception:  # noqa: BLE001  照片删不掉不影响删记录
        log.exception("delete homework photos failed")


def merge_user_homework(source_id: str, target_id: str) -> None:
    HomeworkItem.query.filter_by(user_id=source_id).update({"user_id": target_id}, synchronize_session=False)


def delete_user_homework(user_id: str) -> None:
    items = HomeworkItem.query.filter_by(user_id=user_id).all()
    _delete_photos(items)
    HomeworkItem.query.filter_by(user_id=user_id).delete(synchronize_session=False)
