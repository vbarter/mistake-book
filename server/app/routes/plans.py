"""学习计划：老师扫描 / 上传作业 → 转发到微信 → 学生点开自动加入 → 看作业、导出、拍照交回 → 老师看谁交了、错在哪。

- 一个计划 = 创建人（老师）+ 学科 + 成员 + 若干份作业。成员只能靠邀请码（卡片 / 链接里带着）加入，没有手输邀请码的入口。
- 成员名单只有创建人能看；成员之间互相看不到，也看不到人数和别人的提交。
- 计划里不单独存名字：显示时取账号当前的称呼，用户改名后这里跟着变。创建人看到重名的成员时带手机尾号区分。
- 作业内容：扫描件（客户端识别成电子版后回填 digitized，成员看原题、能导出）和附件（PDF / Word / 图片，原样查看）。
  文件走对象存储签名链接直传直下，key 为 plans/<planId>/<fileId>.<ext>。
- 提交：学生的照片 + 逐题结果（客户端用现有扫描批改出来后回填）。老师可以改判、标已阅或退回重做。

设计与界面稿见项目文件 screenshots/study-plan/ 和方案文档。
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, abort, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

from ..auth_utils import current_user, login_required
from ..constants import SUBJECT_LABELS, SUBJECTS
from ..extensions import db
from ..models import Plan, PlanAssignment, PlanFile, PlanMember, PlanSubmission, PlanView, User
from .. import storage

bp = Blueprint("plans", __name__)
log = logging.getLogger(__name__)

PLAN_SUBJECTS = [*SUBJECTS, "mixed"]
MAX_MEMBERS = 200
MAX_FILES = 30  # 一份作业 / 一次提交最多多少个文件
MAX_DIGITIZED_BYTES = 8 * 1024 * 1024
DEFAULT_NICKNAME = "小同学"
MARKS = ("correct", "wrong", "partial", "blank", "unmarked")
_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # 去掉 0 o 1 l i，念出来、抄下来不容易错
_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}


# --------------------------------------------------------------------------- 工具


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


def _new_code() -> str:
    for _ in range(8):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(10))
        if not Plan.query.filter_by(invite_code=code).first():
            return code
    abort(503, "请稍后再试")


def _plan_or_404(plan_id: str) -> Plan:
    plan = db.session.get(Plan, plan_id)
    if plan is None:
        abort(404, "这个学习计划不存在或已解散")
    return plan


def _role(plan: Plan, user: User) -> str | None:
    """owner | member | None（不在计划里）"""
    if plan.owner_id == user.id:
        return "owner"
    m = PlanMember.query.filter_by(plan_id=plan.id, user_id=user.id, removed=False).first()
    return "member" if m else None


def _require_role(plan: Plan, *roles: str) -> str:
    role = _role(plan, current_user())
    if role is None:
        abort(403, "你不在这个学习计划里")
    if roles and role not in roles:
        abort(403, "只有创建人可以这样做")
    return role


def _assignment_or_404(assignment_id: str) -> tuple[PlanAssignment, Plan]:
    a = db.session.get(PlanAssignment, assignment_id)
    if a is None:
        abort(404, "这份作业不存在")
    return a, _plan_or_404(a.plan_id)


def _teacher_name(plan: Plan) -> str:
    owner = db.session.get(User, plan.owner_id)
    return (owner.nickname if owner else "") or "老师"


def _plan_view(plan: Plan, role: str) -> dict:
    return {
        "id": plan.id,
        "name": plan.name,
        "subject": plan.subject,
        "role": role,
        "teacher": _teacher_name(plan),
        "createdAt": _iso(plan.created_at),
    }


def _clean_files(raw, kinds: tuple[str, ...]) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_FILES:
        abort(400, f"一次最多 {MAX_FILES} 个文件")
    out = []
    for i, f in enumerate(raw):
        if not isinstance(f, dict):
            abort(400, "文件格式不对")
        mime = str(f.get("mime") or "image/jpeg").lower()
        if mime not in _EXT:
            abort(400, "只支持图片、PDF 和 Word 文件")
        kind = f.get("kind") if f.get("kind") in kinds else kinds[0]
        if kind == "scan" and not mime.startswith("image/"):
            abort(400, "扫描件必须是图片")
        try:
            size = int(f.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        if size > storage.MAX_PLAN_FILE_BYTES:
            abort(413, "单个文件不能超过 20 MB")
        out.append({"kind": kind, "name": str(f.get("name") or "")[:120], "mime": mime, "ext": _EXT[mime], "size": size, "position": i, "clientId": str(f.get("clientId") or "")[:40]})
    return out


def _add_files(plan: Plan, assignment: PlanAssignment, files: list[dict], submission: PlanSubmission | None = None) -> list[dict]:
    """建文件记录，返回带上传链接的列表（clientId 让客户端对上是哪个本地文件）"""
    store = storage.get_storage()
    out = []
    for f in files:
        row = PlanFile(
            plan_id=plan.id, assignment_id=assignment.id, submission_id=submission.id if submission else None,
            kind=f["kind"], name=f["name"], mime=f["mime"], ext=f["ext"], size=f["size"], position=f["position"],
        )
        db.session.add(row)
        db.session.flush()
        out.append({"id": row.id, "clientId": f["clientId"], "method": "PUT", "url": store.presign(row.key, "PUT"), "headers": {"Content-Type": row.mime}})
    return out


def _file_view(row: PlanFile, store) -> dict:
    return {
        "id": row.id, "kind": row.kind, "name": row.name, "mime": row.mime, "size": row.size or 0,
        "url": store.presign(row.key, "GET") if row.uploaded else None,
    }


def _files_of(assignment_id: str, submission_id: str | None) -> list[PlanFile]:
    q = PlanFile.query.filter_by(assignment_id=assignment_id)
    q = q.filter(PlanFile.submission_id == submission_id) if submission_id else q.filter(PlanFile.submission_id.is_(None))
    return q.order_by(PlanFile.position, PlanFile.created_at).all()


def _delete_files(rows: list[PlanFile]) -> None:
    if not rows:
        return
    try:
        storage.get_storage().delete([r.key for r in rows])
    except Exception:  # noqa: BLE001  文件删不掉不影响删记录
        log.exception("delete plan files failed")
    for r in rows:
        db.session.delete(r)


def _score(results) -> dict | None:
    """逐题结果 → 对 / 错 / 没做的数量；还没批改出来返回 None"""
    if not isinstance(results, list):
        return None
    correct = sum(1 for r in results if r.get("m") == "correct")
    blank = sum(1 for r in results if r.get("m") == "blank")
    wrong = sum(1 for r in results if r.get("m") in ("wrong", "partial"))
    return {"total": len(results), "correct": correct, "wrong": wrong, "blank": blank}


def _clean_results(raw) -> list[dict]:
    if not isinstance(raw, list) or len(raw) > 400:
        abort(400, "批改结果格式不对")
    out = []
    for r in raw:
        if not isinstance(r, dict):
            abort(400, "批改结果格式不对")
        mark = r.get("m") if r.get("m") in MARKS else "unmarked"
        out.append({
            "n": str(r.get("n") or "")[:16], "m": mark, "s": str(r.get("s") or "")[:300], "a": str(r.get("a") or "")[:300],
            "t": str(r.get("t") or "")[:300], "k": str(r.get("k") or "")[:40],
        })
    return out


def _is_late(assignment: PlanAssignment) -> bool:
    if not assignment.due_at:
        return False
    try:
        due = datetime.fromisoformat(assignment.due_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    now = datetime.now(due.tzinfo) if due.tzinfo else datetime.now()
    return now > due


def _display_names(users: list[User]) -> dict[str, dict]:
    """创建人看到的成员名字：取账号当前的称呼；同一个计划里重名的带手机尾号（没手机号用账号编号后四位）"""
    counts: dict[str, int] = {}
    for u in users:
        counts[u.nickname or DEFAULT_NICKNAME] = counts.get(u.nickname or DEFAULT_NICKNAME, 0) + 1
    out = {}
    for u in users:
        name = u.nickname or DEFAULT_NICKNAME
        tail = ((u.phone or "")[-4:] or u.id[-4:]) if counts[name] > 1 else ""
        out[u.id] = {"name": name, "tail": tail}
    return out


def _members(plan: Plan, include_removed: bool = False) -> list[tuple[PlanMember, User]]:
    q = db.session.query(PlanMember, User).join(User, User.id == PlanMember.user_id).filter(PlanMember.plan_id == plan.id)
    if not include_removed:
        q = q.filter(PlanMember.removed.is_(False))
    return q.order_by(PlanMember.joined_at).all()


def _my_status(sub: PlanSubmission | None) -> str:
    return sub.status if sub else "todo"


def _assignment_brief(a: PlanAssignment) -> dict:
    return {"id": a.id, "title": a.title, "dueAt": a.due_at, "questionCount": a.question_count or 0, "createdAt": _iso(a.created_at), "revoked": bool(a.revoked)}


def _owner_counts(plan: Plan, assignments: list[PlanAssignment]) -> dict[str, dict]:
    """创建人看的每份作业进度：已交 / 没交 / 没看 / 待阅"""
    member_ids = {m.user_id for m, _ in _members(plan)}
    ids = [a.id for a in assignments]
    subs: dict[str, list[PlanSubmission]] = {i: [] for i in ids}
    views: dict[str, set[str]] = {i: set() for i in ids}
    if ids:
        for s in PlanSubmission.query.filter(PlanSubmission.assignment_id.in_(ids)).all():
            subs[s.assignment_id].append(s)
        for v in PlanView.query.filter(PlanView.assignment_id.in_(ids)).all():
            views[v.assignment_id].add(v.user_id)
    out = {}
    for a in assignments:
        handed = {s.user_id for s in subs[a.id] if s.status != "returned"}
        active = handed & member_ids
        missing = member_ids - active
        out[a.id] = {
            "members": len(member_ids),
            "submitted": len(active),
            "missing": len(missing),
            "unseen": len(missing - views[a.id]),
            "toReview": sum(1 for s in subs[a.id] if s.status == "submitted"),
        }
    return out


# --------------------------------------------------------------------------- 计划


def _create_assignment(plan: Plan, data: dict) -> tuple[PlanAssignment, list[dict]]:
    files = _clean_files(data.get("files"), ("scan", "attachment"))
    if not files:
        abort(400, "先扫描或上传一个附件")
    title = str(data.get("title") or "").strip()[:120]
    if not title:
        named = next((f["name"].rsplit(".", 1)[0] for f in files if f["kind"] == "attachment" and f["name"]), "")
        now = datetime.now()
        title = named or f"{now.month}月{now.day}日作业"
    due = data.get("dueAt")
    a = PlanAssignment(plan_id=plan.id, title=title, due_at=due[:32] if isinstance(due, str) and due else None)
    db.session.add(a)
    db.session.flush()
    return a, _add_files(plan, a, files)


def _invite(plan: Plan, assignment: PlanAssignment | None = None) -> dict:
    base = (current_app.config.get("PUBLIC_BASE_URL") or request.host_url).rstrip("/")
    url = f"{base}/api/plans/j/{plan.invite_code}" + (f"?a={assignment.id}" if assignment else "")
    return {"code": plan.invite_code, "url": url}


@bp.post("/plans")
@login_required
def create_plan():
    """新建学习计划，同时布置第一份作业。返回文件的上传链接和转发用的邀请链接"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()[:60]
    if not name:
        abort(400, "给学习计划起个名字")
    subject = data.get("subject") if data.get("subject") in PLAN_SUBJECTS else None
    if subject is None:
        abort(400, "选一个学科")
    if not _clean_files(data.get("files"), ("scan", "attachment")):  # 先验完再建，免得留下半个计划
        abort(400, "先扫描或上传一个附件")
    plan = Plan(owner_id=user.id, name=name, subject=subject, invite_code=_new_code())
    db.session.add(plan)
    db.session.flush()
    assignment, uploads = _create_assignment(plan, data)
    db.session.commit()
    return jsonify({"plan": _plan_view(plan, "owner"), "assignment": _assignment_brief(assignment), "uploads": uploads, "invite": _invite(plan, assignment)}), 201


@bp.get("/plans")
@login_required
def list_plans():
    """我创建的和我加入的学习计划，带首页卡片要用的汇总"""
    user = current_user()
    joined_ids = [m.plan_id for m in PlanMember.query.filter_by(user_id=user.id, removed=False).all()]
    plans = Plan.query.filter(db.or_(Plan.owner_id == user.id, Plan.id.in_(joined_ids))).order_by(Plan.created_at.desc()).all()
    out = []
    summary = {"todo": 0, "nextDue": None, "nextTitle": None, "nextSubject": None, "toReview": 0, "submittedToday": 0, "owned": 0, "joined": 0}
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    for plan in plans:
        role = "owner" if plan.owner_id == user.id else "member"
        assignments = PlanAssignment.query.filter_by(plan_id=plan.id, revoked=False).order_by(PlanAssignment.created_at.desc()).all()
        item = {**_plan_view(plan, role), "assignments": len(assignments)}
        if role == "owner":
            counts = _owner_counts(plan, assignments)
            item["members"] = next(iter(counts.values()))["members"] if counts else len(_members(plan))
            item["toReview"] = sum(c["toReview"] for c in counts.values())
            summary["owned"] += 1
            summary["toReview"] += item["toReview"]
            if assignments:
                summary["submittedToday"] += PlanSubmission.query.filter(
                    PlanSubmission.assignment_id.in_([a.id for a in assignments]), PlanSubmission.submitted_at >= today
                ).count()
        else:
            mine = {s.assignment_id: s for s in PlanSubmission.query.filter_by(plan_id=plan.id, user_id=user.id).all()}
            todo = [a for a in assignments if _my_status(mine.get(a.id)) in ("todo", "returned")]
            item["todo"] = len(todo)
            summary["joined"] += 1
            summary["todo"] += len(todo)
            for a in todo:
                if a.due_at and (summary["nextDue"] is None or a.due_at < summary["nextDue"]):
                    summary["nextDue"], summary["nextTitle"], summary["nextSubject"] = a.due_at, a.title, plan.subject
            if todo and summary["nextTitle"] is None:
                summary["nextTitle"], summary["nextSubject"] = todo[0].title, plan.subject
        out.append(item)
    return jsonify({"plans": out, "summary": summary})


@bp.get("/plans/<plan_id>")
@login_required
def get_plan(plan_id: str):
    user = current_user()
    plan = _plan_or_404(plan_id)
    role = _require_role(plan)
    assignments = PlanAssignment.query.filter_by(plan_id=plan.id).order_by(PlanAssignment.created_at.desc()).all()
    body: dict = {"plan": _plan_view(plan, role)}
    if role == "owner":
        live = [a for a in assignments if not a.revoked]
        counts = _owner_counts(plan, live)
        body["assignments"] = [{**_assignment_brief(a), **counts[a.id]} for a in live]
        members = _members(plan)
        names = _display_names([u for _, u in members])
        handed: dict[str, int] = {}
        if live:
            for s in PlanSubmission.query.filter(PlanSubmission.assignment_id.in_([a.id for a in live]), PlanSubmission.status != "returned").all():
                handed[s.user_id] = handed.get(s.user_id, 0) + 1
        body["members"] = [
            {"userId": u.id, **names[u.id], "joinedAt": _iso(m.joined_at), "submitted": handed.get(u.id, 0), "assignments": len(live)} for m, u in members
        ]
        body["invite"] = _invite(plan, live[0] if live else None)
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        body["plan"]["members"] = len(members)
        body["plan"]["toReview"] = sum(c["toReview"] for c in counts.values())
        body["plan"]["submittedToday"] = (
            PlanSubmission.query.filter(PlanSubmission.assignment_id.in_([a.id for a in live]), PlanSubmission.submitted_at >= today).count() if live else 0
        )
    else:
        mine = {s.assignment_id: s for s in PlanSubmission.query.filter_by(plan_id=plan.id, user_id=user.id).all()}
        rows = []
        for a in assignments:
            sub = mine.get(a.id)
            if a.revoked and sub is None:
                continue
            rows.append({**_assignment_brief(a), "status": _my_status(sub), "score": _score(sub.results) if sub else None, "comment": sub.comment if sub else "", "late": bool(sub.late) if sub else False})
        body["assignments"] = rows
        body["me"] = {"name": user.nickname or DEFAULT_NICKNAME, "defaultName": (user.nickname or DEFAULT_NICKNAME) == DEFAULT_NICKNAME}
    return jsonify(body)


@bp.route("/plans/<plan_id>", methods=["PATCH", "PUT"])
@login_required
def update_plan(plan_id: str):
    plan = _plan_or_404(plan_id)
    _require_role(plan, "owner")
    data = request.get_json(silent=True) or {}
    if "name" in data:
        name = str(data.get("name") or "").strip()[:60]
        if not name:
            abort(400, "名字不能为空")
        plan.name = name
    if "subject" in data:
        if data.get("subject") not in PLAN_SUBJECTS:
            abort(400, "学科不对")
        plan.subject = data["subject"]
    if data.get("resetInvite"):
        plan.invite_code = _new_code()  # 旧卡片、旧链接立即失效，已在计划里的人不受影响
    db.session.commit()
    return jsonify({"plan": _plan_view(plan, "owner"), "invite": _invite(plan)})


def _drop_plan(plan: Plan) -> None:
    ids = [a.id for a in PlanAssignment.query.filter_by(plan_id=plan.id).all()]
    try:
        storage.get_storage().delete_prefix(f"plans/{plan.id}/")
    except Exception:  # noqa: BLE001
        log.exception("delete plan files failed for %s", plan.id)
    if ids:
        PlanView.query.filter(PlanView.assignment_id.in_(ids)).delete(synchronize_session=False)
    for model in (PlanFile, PlanSubmission, PlanAssignment, PlanMember):
        model.query.filter_by(plan_id=plan.id).delete(synchronize_session=False)
    db.session.delete(plan)


@bp.delete("/plans/<plan_id>")
@login_required
def delete_plan(plan_id: str):
    """解散：计划、作业、创建人能看到的提交全部删除。学生自己试卷里存的那份在他本机和他的云同步里，不受影响"""
    plan = _plan_or_404(plan_id)
    _require_role(plan, "owner")
    _drop_plan(plan)
    db.session.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- 加入 / 成员


def _invite_plan(code: str) -> Plan:
    plan = Plan.query.filter_by(invite_code=str(code or "").strip().lower()).first()
    if plan is None:
        abort(404, "这张卡片已经失效，请让老师重新转发一次")
    return plan


@bp.get("/plans/invite/<code>")
def invite_preview(code: str):
    """卡片落地页用：不用登录，只给计划名、老师称呼、学科和这份作业的名字"""
    plan = _invite_plan(code)
    a = db.session.get(PlanAssignment, request.args.get("a") or "")
    if a is None or a.plan_id != plan.id or a.revoked:
        a = PlanAssignment.query.filter_by(plan_id=plan.id, revoked=False).order_by(PlanAssignment.created_at.desc()).first()
    return jsonify({
        "plan": {"id": plan.id, "name": plan.name, "subject": plan.subject, "teacher": _teacher_name(plan)},
        "assignment": _assignment_brief(a) if a else None,
    })


@bp.post("/plans/join")
@login_required
def join_plan():
    """点开卡片后自动加入，不用创建人批准。已经在里面的直接返回。名字用账号当前的称呼"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    plan = _invite_plan(data.get("code"))
    default_name = (user.nickname or DEFAULT_NICKNAME) == DEFAULT_NICKNAME
    new_user = bool(user.created_at and datetime.now() - user.created_at < timedelta(minutes=30))
    info = {"name": user.nickname or DEFAULT_NICKNAME, "defaultName": default_name, "needsName": default_name and new_user}
    if plan.owner_id == user.id:
        return jsonify({"plan": _plan_view(plan, "owner"), "joined": False, "me": info})
    member = PlanMember.query.filter_by(plan_id=plan.id, user_id=user.id).first()
    joined = False
    if member is None or member.removed:
        if PlanMember.query.filter_by(plan_id=plan.id, removed=False).count() >= MAX_MEMBERS:
            abort(409, f"这个学习计划已经满 {MAX_MEMBERS} 人了")
        if member is None:
            db.session.add(PlanMember(plan_id=plan.id, user_id=user.id))
        else:
            member.removed, member.joined_at = False, datetime.now()
        joined = True
        try:
            db.session.commit()
        except IntegrityError:  # 同一个人的两个请求同时加入：另一个已经写进去了
            db.session.rollback()
            joined = False
    return jsonify({"plan": _plan_view(plan, "member"), "joined": joined, "me": info})


@bp.delete("/plans/<plan_id>/members/<user_id>")
@login_required
def remove_member(plan_id: str, user_id: str):
    """创建人移除成员，或成员自己退出（user_id = me）。交过的记录创建人还能看"""
    user = current_user()
    plan = _plan_or_404(plan_id)
    if user_id == "me":
        _require_role(plan, "member")
        user_id = user.id
    else:
        _require_role(plan, "owner")
    member = PlanMember.query.filter_by(plan_id=plan.id, user_id=user_id, removed=False).first()
    if member is None:
        abort(404, "成员不存在")
    member.removed = True
    db.session.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- 作业


@bp.post("/plans/<plan_id>/assignments")
@login_required
def create_assignment(plan_id: str):
    plan = _plan_or_404(plan_id)
    _require_role(plan, "owner")
    assignment, uploads = _create_assignment(plan, request.get_json(silent=True) or {})
    db.session.commit()
    return jsonify({"plan": _plan_view(plan, "owner"), "assignment": _assignment_brief(assignment), "uploads": uploads, "invite": _invite(plan, assignment)}), 201


@bp.post("/plans/files/uploaded")
@login_required
def files_uploaded():
    """传完文件后确认：服务器查一下文件确实在"""
    user = current_user()
    ids = (request.get_json(silent=True) or {}).get("ids") or []
    if not isinstance(ids, list) or len(ids) > MAX_FILES * 2:
        abort(400, "格式不对")
    store = storage.get_storage()
    done, missing = [], []
    for fid in ids:
        row = db.session.get(PlanFile, str(fid))
        plan = db.session.get(Plan, row.plan_id) if row else None
        if row is None or plan is None:
            missing.append(fid)
            continue
        if row.submission_id:
            sub = db.session.get(PlanSubmission, row.submission_id)
            allowed = sub is not None and sub.user_id == user.id
        else:
            allowed = plan.owner_id == user.id
        size = store.exists(row.key) if allowed else None
        if size is None:
            missing.append(fid)
            continue
        row.uploaded, row.size = True, size
        done.append(row.id)
    db.session.commit()
    return jsonify({"done": done, "missing": missing})


def _hardest(subs: list[PlanSubmission], top: int = 5) -> list[dict]:
    """全班错得最多的题：按题号把各人的结果对齐"""
    stats: dict[str, dict] = {}
    graded = 0
    for s in subs:
        if not isinstance(s.results, list):
            continue
        graded += 1
        for r in s.results:
            n = r.get("n") or ""
            if not n:
                continue
            item = stats.setdefault(n, {"number": n, "wrong": 0, "knowledge": "", "stem": ""})
            if r.get("m") in ("wrong", "partial", "blank"):
                item["wrong"] += 1
            item["knowledge"] = item["knowledge"] or r.get("k") or ""
            item["stem"] = item["stem"] or r.get("t") or ""
    rows = sorted((v for v in stats.values() if v["wrong"] > 0), key=lambda v: -v["wrong"])[:top]
    return [{**r, "graded": graded} for r in rows]


@bp.get("/plans/assignments/<assignment_id>")
@login_required
def get_assignment(assignment_id: str):
    """作业详情。成员：内容 + 我的提交；创建人：内容 + 谁交了谁没交 + 错得最多的题"""
    user = current_user()
    a, plan = _assignment_or_404(assignment_id)
    role = _require_role(plan)
    store = storage.get_storage()
    body: dict = {
        "plan": _plan_view(plan, role),
        "assignment": {**_assignment_brief(a), "digitized": json.loads(a.digitized) if a.digitized else None, "files": [_file_view(f, store) for f in _files_of(a.id, None)]},
    }
    if role == "owner":
        members = _members(plan, include_removed=True)
        names = _display_names([u for _, u in members])
        subs = {s.user_id: s for s in PlanSubmission.query.filter_by(assignment_id=a.id).all()}
        viewed = {v.user_id for v in PlanView.query.filter_by(assignment_id=a.id).all()}
        submitted, missing = [], []
        for m, u in members:
            sub = subs.get(u.id)
            if sub is not None and sub.status != "returned":
                submitted.append({
                    "submissionId": sub.id, "userId": u.id, **names[u.id], "status": sub.status, "late": bool(sub.late),
                    "submittedAt": _iso(sub.submitted_at), "score": _score(sub.results), "left": bool(m.removed),
                })
            elif not m.removed:
                missing.append({"userId": u.id, **names[u.id], "viewed": u.id in viewed, "returned": sub is not None})
        submitted.sort(key=lambda s: (s["status"] != "submitted", s["submittedAt"] or ""))
        body["board"] = {
            "members": sum(1 for m, _ in members if not m.removed),
            "submitted": submitted,
            "missing": missing,
            "unseen": sum(1 for x in missing if not x["viewed"]),
            "hardest": _hardest([s for s in subs.values() if s.status != "returned"]),
        }
        body["invite"] = _invite(plan, a)
    else:
        if a.revoked and not PlanSubmission.query.filter_by(assignment_id=a.id, user_id=user.id).first():
            abort(404, "老师撤回了这份作业")
        if not PlanView.query.filter_by(assignment_id=a.id, user_id=user.id).first():
            # 客户端刚进页面会连着请求两次，两个请求可能同时发现「还没看过」都去写，后写的撞唯一约束。
            # 撞了说明已经记上了，当成功处理，不能让整个请求 500。
            db.session.add(PlanView(assignment_id=a.id, user_id=user.id))
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
        sub = PlanSubmission.query.filter_by(assignment_id=a.id, user_id=user.id).first()
        body["submission"] = _submission_view(sub, store) if sub else None
    return jsonify(body)


@bp.put("/plans/assignments/<assignment_id>/digitized")
@login_required
def set_assignment_digitized(assignment_id: str):
    """创建人的 App 把扫描件识别成电子版后回填，成员看到的就从照片换成电子版"""
    a, plan = _assignment_or_404(assignment_id)
    _require_role(plan, "owner")
    data = request.get_json(silent=True) or {}
    dig = data.get("digitized")
    if not isinstance(dig, dict):
        abort(400, "电子版格式不对")
    text = json.dumps(dig, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_DIGITIZED_BYTES:
        abort(413, "电子版太大")
    a.digitized = text
    a.question_count = len(dig.get("questions") or [])
    title = str(data.get("title") or "").strip()[:120]
    if title:
        a.title = title
    db.session.commit()
    return jsonify({"assignment": _assignment_brief(a)})


@bp.delete("/plans/assignments/<assignment_id>")
@login_required
def revoke_assignment(assignment_id: str):
    """撤回：没人交过的直接删；有人交过的标成已撤回，交过的人还能看到自己那份"""
    a, plan = _assignment_or_404(assignment_id)
    _require_role(plan, "owner")
    if PlanSubmission.query.filter_by(assignment_id=a.id).count():
        a.revoked = True
    else:
        _delete_files(PlanFile.query.filter_by(assignment_id=a.id).all())
        PlanView.query.filter_by(assignment_id=a.id).delete(synchronize_session=False)
        db.session.delete(a)
    db.session.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- 提交


def _submission_view(sub: PlanSubmission, store, with_results: bool = True) -> dict:
    data = {
        "id": sub.id, "status": sub.status, "comment": sub.comment or "", "late": bool(sub.late),
        "submittedAt": _iso(sub.submitted_at), "reviewedAt": _iso(sub.reviewed_at), "score": _score(sub.results),
        "files": [_file_view(f, store) for f in _files_of(sub.assignment_id, sub.id)],
    }
    if with_results:
        data["results"] = sub.results
    return data


@bp.post("/plans/assignments/<assignment_id>/submission")
@login_required
def submit(assignment_id: str):
    """成员交作业（或重交）：登记照片，返回上传链接。老师标已阅之后不能再重交，除非被退回"""
    user = current_user()
    a, plan = _assignment_or_404(assignment_id)
    _require_role(plan, "member")
    if a.revoked:
        abort(409, "老师撤回了这份作业")
    files = _clean_files((request.get_json(silent=True) or {}).get("files"), ("scan",))
    if not files:
        abort(400, "先拍下做完的作业")
    sub = PlanSubmission.query.filter_by(assignment_id=a.id, user_id=user.id).first()
    if sub is not None and sub.status == "reviewed":
        abort(409, "老师已经批阅过了，不能再重交")
    if sub is None:
        sub = PlanSubmission(plan_id=plan.id, assignment_id=a.id, user_id=user.id)
        db.session.add(sub)
        db.session.flush()
    else:
        _delete_files(_files_of(a.id, sub.id))
    sub.status, sub.comment, sub.results, sub.reviewed_at = "submitted", "", None, None
    sub.submitted_at, sub.late = datetime.now(), _is_late(a)
    uploads = _add_files(plan, a, files, sub)
    db.session.commit()
    return jsonify({"submission": _submission_view(sub, storage.get_storage()), "uploads": uploads}), 201


def _submission_or_404(submission_id: str) -> tuple[PlanSubmission, Plan]:
    sub = db.session.get(PlanSubmission, submission_id)
    if sub is None:
        abort(404, "这次提交不存在")
    return sub, _plan_or_404(sub.plan_id)


@bp.put("/plans/submissions/<submission_id>/results")
@login_required
def set_results(submission_id: str):
    """学生的 App 批改完后回填逐题结果（只有本人能填；老师批阅之后不再接受）"""
    sub, _ = _submission_or_404(submission_id)
    if sub.user_id != current_user().id:
        abort(403, "只能提交自己的作业")
    if sub.status != "submitted":
        abort(409, "老师已经批阅过了")
    sub.results = _clean_results((request.get_json(silent=True) or {}).get("results"))
    db.session.commit()
    return jsonify({"submission": _submission_view(sub, storage.get_storage())})


@bp.get("/plans/submissions/<submission_id>")
@login_required
def get_submission(submission_id: str):
    """创建人检查一个学生的提交：原照片 + 逐题结果；带上一个 / 下一个，批 40 份不用来回进出"""
    user = current_user()
    sub, plan = _submission_or_404(submission_id)
    if sub.user_id != user.id and plan.owner_id != user.id:
        abort(403, "只有创建人和本人能看")
    body: dict = {"submission": _submission_view(sub, storage.get_storage()), "plan": _plan_view(plan, "owner" if plan.owner_id == user.id else "member")}
    a = db.session.get(PlanAssignment, sub.assignment_id)
    body["assignment"] = _assignment_brief(a) if a else None
    if plan.owner_id == user.id:
        members = _members(plan, include_removed=True)
        names = _display_names([u for _, u in members])
        body["student"] = names.get(sub.user_id, {"name": DEFAULT_NICKNAME, "tail": ""})
        order = [s.id for s in PlanSubmission.query.filter(PlanSubmission.assignment_id == sub.assignment_id, PlanSubmission.status != "returned").order_by(PlanSubmission.submitted_at).all()]
        if sub.id in order:
            i = order.index(sub.id)
            body["nav"] = {"index": i + 1, "total": len(order), "prev": order[i - 1] if i > 0 else None, "next": order[i + 1] if i + 1 < len(order) else None}
    return jsonify(body)


@bp.route("/plans/submissions/<submission_id>", methods=["PATCH", "PUT"])
@login_required
def review_submission(submission_id: str):
    """创建人：改判某几题（marks: {题目下标: 判定}）、标已阅（reviewed）或退回重做（returned），可以附一句话"""
    sub, plan = _submission_or_404(submission_id)
    _require_role(plan, "owner")
    data = request.get_json(silent=True) or {}
    marks = data.get("marks")
    if isinstance(marks, dict) and isinstance(sub.results, list):
        results = [dict(r) for r in sub.results]
        for key, mark in marks.items():
            try:
                i = int(key)
            except (TypeError, ValueError):
                continue
            if 0 <= i < len(results) and mark in MARKS:
                results[i]["m"], results[i]["o"] = mark, True
        sub.results = results
    status = data.get("status")
    if status in ("reviewed", "returned"):
        sub.status, sub.reviewed_at = status, datetime.now()
    elif status is not None:
        abort(400, "状态不对")
    if "comment" in data:
        sub.comment = str(data.get("comment") or "").strip()[:200]
    db.session.commit()
    return jsonify({"submission": _submission_view(sub, storage.get_storage())})


# --------------------------------------------------------------------------- 注销 / 合并账号


def delete_user_plans(user_id: str) -> None:
    """注销账号：创建的计划全部解散；加入的计划里的成员记录、提交和照片删掉"""
    for plan in Plan.query.filter_by(owner_id=user_id).all():
        _drop_plan(plan)
    subs = PlanSubmission.query.filter_by(user_id=user_id).all()
    if subs:
        _delete_files(PlanFile.query.filter(PlanFile.submission_id.in_([s.id for s in subs])).all())
        for s in subs:
            db.session.delete(s)
    PlanMember.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    PlanView.query.filter_by(user_id=user_id).delete(synchronize_session=False)


def merge_user_plans(source_id: str, target_id: str) -> None:
    """合并账号：创建的计划、成员身份、提交都挪到 target；两边都在同一个计划里时留 target 的"""
    Plan.query.filter_by(owner_id=source_id).update({"owner_id": target_id}, synchronize_session=False)
    for model, key in ((PlanMember, "plan_id"), (PlanSubmission, "assignment_id"), (PlanView, "assignment_id")):
        taken = {getattr(r, key) for r in model.query.filter_by(user_id=target_id).all()}
        for row in model.query.filter_by(user_id=source_id).all():
            if getattr(row, key) in taken:
                if model is PlanSubmission:
                    _delete_files(PlanFile.query.filter_by(submission_id=row.id).all())
                db.session.delete(row)
            else:
                row.user_id = target_id
    db.session.flush()
    # 自己创建的计划里不该再有自己这个成员
    for plan in Plan.query.filter_by(owner_id=target_id).all():
        PlanMember.query.filter_by(plan_id=plan.id, user_id=target_id).delete(synchronize_session=False)


# --------------------------------------------------------------------------- 转发出去的链接落地页


_SUBJECT_NAMES = {**SUBJECT_LABELS, "mixed": "综合"}

_LANDING = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<style>
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;background:#F4F6FB;color:#1B2A4A;min-height:100vh;display:flex;flex-direction:column}}
.top{{background:#1F3B73;color:#fff;padding:36px 24px 56px}}.brand{{font-size:14px;opacity:.8}}.who{{margin-top:18px;font-size:15px;opacity:.9}}
h1{{margin:6px 0 0;font-size:24px;line-height:1.35}}
.card{{margin:-32px 16px 0;background:#fff;border-radius:16px;padding:20px;box-shadow:0 6px 24px rgba(31,59,115,.08)}}
.row{{display:flex;justify-content:space-between;padding:8px 0;font-size:15px}}.row span:first-child{{color:#7A869F}}
.tag{{display:inline-block;background:#E8EEFB;color:#1F3B73;border-radius:6px;padding:2px 8px;font-size:13px}}
.grow{{flex:1}}.bar{{padding:16px 16px calc(16px + env(safe-area-inset-bottom))}}
.btn{{display:block;width:100%;border:0;border-radius:14px;background:#1F3B73;color:#fff;font-size:17px;font-weight:600;padding:16px;text-align:center;text-decoration:none}}
.tip{{margin-top:12px;text-align:center;font-size:13px;color:#7A869F}}.tip a{{color:#1F3B73}}
.mask{{display:none;position:fixed;inset:0;background:rgba(10,20,45,.82);color:#fff;padding:28px;font-size:17px;line-height:1.7;text-align:right}}
.mask.on{{display:block}}.mask b{{font-size:30px}}
</style></head><body>
<div class="top"><div class="brand">上壹课 · 学习计划</div><div class="who">{teacher} 邀请你加入</div><h1>{name}</h1></div>
<div class="card"><div class="row"><span>学科</span><span class="tag">{subject}</span></div>{assignment}</div>
<div class="grow"></div>
<div class="bar"><a class="btn" id="open" href="{deeplink}">打开上壹课，加入学习计划</a>
<div class="tip" id="tip">{download}</div></div>
<div class="mask" id="mask"><b>↗</b><br>点右上角「···」<br>选择「在浏览器打开」<br>就能打开上壹课加入了</div>
<script>
(function(){{
  var wx=/MicroMessenger/i.test(navigator.userAgent),mask=document.getElementById('mask');
  document.getElementById('open').addEventListener('click',function(e){{if(wx){{e.preventDefault();mask.className='mask on';}}}});
  mask.addEventListener('click',function(){{mask.className='mask';}});
  if(!wx){{setTimeout(function(){{location.href={deeplink_js};}},300);}}
}})();
</script></body></html>"""


def _due_text(due_at: str) -> str:
    """截止时间给人看：客户端存的是带时区的 ISO 时间，落地页按北京时间显示"""
    try:
        due = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
    except ValueError:
        return due_at[:16].replace("T", " ")
    if due.tzinfo:
        due = due.astimezone(timezone(timedelta(hours=8)))
    return f"{due.month}月{due.day}日 {due:%H:%M}"


@bp.get("/plans/j/<code>")
def landing(code: str):
    """微信里点开卡片 / 链接看到的页面：只有一个动作，打开上壹课加入。没装 App 的给下载地址"""
    from html import escape

    plan = Plan.query.filter_by(invite_code=str(code or "").strip().lower()).first()
    if plan is None:
        return "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='font-family:sans-serif;padding:48px 24px;text-align:center;color:#1B2A4A'><h3>这张卡片已经失效</h3><p style='color:#7A869F'>请让老师重新转发一次</p>", 404
    a = db.session.get(PlanAssignment, request.args.get("a") or "")
    if a is None or a.plan_id != plan.id or a.revoked:
        a = PlanAssignment.query.filter_by(plan_id=plan.id, revoked=False).order_by(PlanAssignment.created_at.desc()).first()
    scheme = current_app.config.get("APP_URL_SCHEME") or "shangyike"
    deeplink = f"{scheme}://plans/join?code={plan.invite_code}" + (f"&a={a.id}" if a else "")
    rows = ""
    if a:
        rows = f'<div class="row"><span>作业</span><span>{escape(a.title)}</span></div>'
        if a.due_at:
            rows += f'<div class="row"><span>截止</span><span>{escape(_due_text(a.due_at))}</span></div>'
    dl = current_app.config.get("APP_DOWNLOAD_URL") or ""
    download = f'还没装上壹课？<a href="{escape(dl)}">去下载</a>，装好后再点一次这张卡片' if dl else "还没装上壹课？先在应用商店搜索「上壹课」安装，再点一次这张卡片"
    html = _LANDING.format(
        title=escape(f"{_teacher_name(plan)}邀请你加入「{plan.name}」"), desc=escape(a.title if a else "打开上壹课加入学习计划"),
        teacher=escape(_teacher_name(plan)), name=escape(plan.name), subject=_SUBJECT_NAMES.get(plan.subject, "综合"),
        assignment=rows, deeplink=escape(deeplink), deeplink_js=json.dumps(deeplink), download=download,
    )
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}
