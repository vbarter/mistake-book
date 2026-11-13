"""学习计划：老师扫描 / 上传作业 → 转发到微信 → 学生点开自动加入 → 看作业、导出、拍照交回 → 老师看谁交了、错在哪。

- 一个计划 = 创建人（老师）+ 学科 + 成员 + 若干份作业。成员只能靠邀请码（卡片 / 链接里带着）加入，没有手输邀请码的入口。
- 完整的成员名单（谁交了没交）只有创建人能看；成员之间看不到别人的提交。加入页（卡片落地页）上会露出人数和最早加入的几个人，让点开的人知道有谁在里面。
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

from flask import Blueprint, abort, current_app, jsonify, make_response, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from ..auth_utils import current_user, login_required
from ..avatars import avatar_url, avatar_urls
from ..constants import SUBJECTS
from ..extensions import db
from ..models import Plan, PlanAssignment, PlanFile, PlanMember, PlanSubmission, PlanTombstone, PlanView, User
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


DISSOLVED = "这个学习计划已被创建人解散"


def _abort_if_dissolved(ref: str | None) -> None:
    """
    ref（计划 id / 邀请码 / 作业 id）属于一个解散了的计划时，明说「已被创建人解散」，而不是「不存在」「卡片失效」。
    状态码仍是 404（老版本客户端把 404 当成「不用再试了」），靠 error = plan_dissolved 区分：
    新版本客户端收到后把人从计划页请出去、刷新自己的计划列表。
    """
    ref = str(ref or "").strip()
    if not ref or len(ref) > 32:
        return
    try:
        hit = db.session.get(PlanTombstone, ref)
    except SQLAlchemyError:  # 线上还没建这张表时照旧回「不存在」
        db.session.rollback()
        return
    if hit is not None:
        abort(make_response(jsonify({"error": "plan_dissolved", "message": DISSOLVED}), 404))


def _plan_or_404(plan_id: str) -> Plan:
    plan = db.session.get(Plan, plan_id)
    if plan is None:
        _abort_if_dissolved(plan_id)
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
        _abort_if_dissolved(assignment_id)
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
        "teacherAvatar": avatar_url(plan.owner_id),
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
    avatars = avatar_urls([u.id for u in users])
    for u in users:
        name = u.nickname or DEFAULT_NICKNAME
        tail = ((u.phone or "")[-4:] or u.id[-4:]) if counts[name] > 1 else ""
        out[u.id] = {"name": name, "tail": tail, "avatar": avatars.get(u.id)}
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
            "handed": len(subs[a.id]),
        }
    return out


# --------------------------------------------------------------------------- 计划


def _create_assignments(plan: Plan, data: dict) -> tuple[list[PlanAssignment], list[dict]]:
    """布置：一次布置的所有文件（扫描件、上传的图片 / PDF / Word）算一份作业，同学整份交一次。
    返回的列表只有这一份（接口里的 assignments 字段留着，老客户端按列表读）。"""
    files = _clean_files(data.get("files"), ("scan", "attachment"))
    if not files:
        abort(400, "先扫描或上传一个附件")
    custom = str(data.get("title") or "").strip()[:120]
    now = datetime.now()
    due = data.get("dueAt")
    due = due[:32] if isinstance(due, str) and due else None
    # 没起名字：只有一个上传的文件就用它的文件名，否则用日期
    named = files[0]["name"].rsplit(".", 1)[0] if len(files) == 1 and files[0]["kind"] == "attachment" and files[0]["name"] else ""
    title = custom or named or f"{now.month}月{now.day}日作业"
    a = PlanAssignment(plan_id=plan.id, title=title[:120], due_at=due, created_at=now)
    db.session.add(a)
    db.session.flush()
    return [a], _add_files(plan, a, files)


def _created_body(plan: Plan, assignments: list[PlanAssignment], uploads: list[dict]) -> dict:
    first = assignments[0] if assignments else None
    return {
        "plan": _plan_view(plan, "owner"), "assignment": _assignment_brief(first) if first else None,
        "assignments": [_assignment_brief(a) for a in assignments], "uploads": uploads, "invite": _invite(plan, first),
    }


def _invite(plan: Plan, assignment: PlanAssignment | None = None) -> dict:
    base = (current_app.config.get("PUBLIC_BASE_URL") or request.host_url).rstrip("/")
    url = f"{base}/api/plans/j/{plan.invite_code}" + (f"?a={assignment.id}" if assignment else "")
    return {"code": plan.invite_code, "url": url}


@bp.post("/plans")
@login_required
def create_plan():
    """新建学习计划；带了文件就同时布置第一份作业，没带就只建计划。返回文件的上传链接和转发用的邀请链接"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()[:60]
    if not name:
        abort(400, "给学习计划起个名字")
    # 新建不再选学科：不带就留空；老版本客户端带了合法学科的照存，带了不认识的仍然报错
    subject = data.get("subject") or None
    if subject is not None and subject not in PLAN_SUBJECTS:
        abort(400, "学科不对")
    # 可以先不放作业：建好就转发让大家加入，之后再布置（成员都能看到）
    has_files = bool(_clean_files(data.get("files"), ("scan", "attachment")))  # 先验完再建，免得留下半个计划
    plan = Plan(owner_id=user.id, name=name, subject=subject, invite_code=_new_code())
    db.session.add(plan)
    db.session.flush()
    assignments, uploads = _create_assignments(plan, data) if has_files else ([], [])
    db.session.commit()
    return jsonify(_created_body(plan, assignments, uploads)), 201


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
            # 交上来过的份数（含已批、已打回）：首页用它区分「还没人交」和「都批完了」
            item["handed"] = sum(c["handed"] for c in counts.values())
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
        # 作业文件直接平铺在计划页：不用再点进每份作业
        store = storage.get_storage()
        files: dict[str, list[dict]] = {a.id: [] for a in live}
        live_ids = [a.id for a in live]
        subs: dict[tuple[str, str], PlanSubmission] = {}
        viewed: set[tuple[str, str]] = set()
        if live:
            for f in PlanFile.query.filter(PlanFile.assignment_id.in_(live_ids), PlanFile.submission_id.is_(None)).order_by(PlanFile.position, PlanFile.created_at).all():
                files[f.assignment_id].append(_file_view(f, store))
            for s in PlanSubmission.query.filter(PlanSubmission.assignment_id.in_(live_ids)).all():
                subs[(s.assignment_id, s.user_id)] = s
            viewed = {(v.assignment_id, v.user_id) for v in PlanView.query.filter(PlanView.assignment_id.in_(live_ids)).all()}
        body["assignments"] = [{**row, "files": files[row["id"]]} for row in body["assignments"]]
        # 成员名单带每份作业的状态。已交 = 没撤回的作业都交了；未交 = 还有没交的（退回重做的也算）。
        # 已经退出但交过作业的人也列出来（left），不然他那份待阅的没有入口；人数和未交都不算他。
        everyone = _members(plan, include_removed=True)
        names = _display_names([u for _, u in everyone])
        rows = []
        for m, u in everyone:
            items = []
            for a in live:
                sub = subs.get((a.id, u.id))
                items.append({
                    "assignmentId": a.id, "status": _my_status(sub), "submissionId": sub.id if sub else None,
                    "late": bool(sub.late) if sub else False, "score": _score(sub.results) if sub else None, "viewed": (a.id, u.id) in viewed,
                })
            handed = sum(1 for i in items if i["status"] in ("submitted", "reviewed"))
            if m.removed and not handed:
                continue
            rows.append({
                "userId": u.id, **names[u.id], "joinedAt": _iso(m.joined_at), "submitted": handed, "assignments": len(live),
                "status": "none" if not live else "submitted" if handed == len(live) else "missing",
                "toReview": sum(1 for i in items if i["status"] == "submitted"), "left": bool(m.removed), "items": items,
            })
        body["members"] = rows
        members = [r for r in rows if not r["left"]]
        body["plan"]["missing"] = sum(1 for r in members if r["status"] == "missing")
        body["invite"] = _invite(plan, live[0] if live else None)
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        body["plan"]["members"] = len(members)
        body["plan"]["toReview"] = sum(c["toReview"] for c in counts.values())
        body["plan"]["submittedToday"] = (
            PlanSubmission.query.filter(PlanSubmission.assignment_id.in_([a.id for a in live]), PlanSubmission.submitted_at >= today).count() if live else 0
        )
    else:
        mine = {s.assignment_id: s for s in PlanSubmission.query.filter_by(plan_id=plan.id, user_id=user.id).all()}
        shown = [a for a in assignments if not (a.revoked and mine.get(a.id) is None)]
        ids = [a.id for a in shown]
        # 成员的计划页也直接平铺每份作业的文件（不再点进作业页），所以打开计划页就算看过这些作业了
        store = storage.get_storage()
        files: dict[str, list[dict]] = {i: [] for i in ids}
        if ids:
            for f in PlanFile.query.filter(PlanFile.assignment_id.in_(ids), PlanFile.submission_id.is_(None)).order_by(PlanFile.position, PlanFile.created_at).all():
                files[f.assignment_id].append(_file_view(f, store))
            seen = {v.assignment_id for v in PlanView.query.filter(PlanView.assignment_id.in_(ids), PlanView.user_id == user.id).all()}
            fresh = [a.id for a in shown if not a.revoked and a.id not in seen]
            if fresh:
                db.session.add_all([PlanView(assignment_id=i, user_id=user.id) for i in fresh])
                try:
                    db.session.commit()
                except IntegrityError:  # 同时来的另一个请求已经记上了
                    db.session.rollback()
        rows = []
        for a in shown:
            sub = mine.get(a.id)
            rows.append({
                **_assignment_brief(a), "status": _my_status(sub), "score": _score(sub.results) if sub else None, "comment": sub.comment if sub else "",
                "late": bool(sub.late) if sub else False, "files": files[a.id], "digitized": bool(a.digitized),
            })
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


def _leave_tombstones(plan: Plan, assignment_ids: list[str]) -> None:
    """解散前留个记号（见 PlanTombstone）。记不上不耽误解散：放在保存点里，失败只回滚这一小步"""
    try:
        with db.session.begin_nested():
            for ref in {plan.id, plan.invite_code, *assignment_ids}:
                db.session.merge(PlanTombstone(ref=ref, plan_id=plan.id))
    except SQLAlchemyError:
        log.exception("leave tombstones failed for %s", plan.id)


def _drop_plan(plan: Plan) -> None:
    """
    解散：成员记录一起删掉，所有加入者随之退出 —— 他们的「我加入的」和首页里不再有这个计划，也不能再打开、再交作业。
    """
    ids = [a.id for a in PlanAssignment.query.filter_by(plan_id=plan.id).all()]
    _leave_tombstones(plan, ids)
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
    code = str(code or "").strip().lower()
    plan = Plan.query.filter_by(invite_code=code).first()
    if plan is None:
        _abort_if_dissolved(code)
        abort(404, "这张卡片已经失效，请让老师重新转发一次")
    return plan


PREVIEW_MEMBERS = 8  # 加入页上最多露出几个已加入的人，其余只算在人数里


def _viewer_id() -> str | None:
    """加入页不用登录也能看；带了登录信息就认一下是谁（登录过期的当成没登录，不报错）"""
    try:
        verify_jwt_in_request(optional=True)
        return get_jwt_identity()
    except Exception:  # noqa: BLE001
        return None


def _joined_preview(plan: Plan) -> dict:
    """加入页上「已经有谁加入了」：人数 + 最早加入的几个人的名字和头像"""
    members = _members(plan)
    shown = [u for _, u in members[:PREVIEW_MEMBERS]]
    avatars = avatar_urls([u.id for u in shown])
    return {"count": len(members), "list": [{"name": u.nickname or DEFAULT_NICKNAME, "avatar": avatars.get(u.id)} for u in shown]}


def _preview_assignments(plan: Plan, wanted: str | None) -> tuple[list[dict], PlanAssignment | None]:
    """
    加入页上的作业清单（新的在上）：每份作业的名字、布置时间和它下面的文件。
    还没加入的人也看得到，所以文件只给名字、类型、大小，不给打开的地址；加入后在计划页里才能打开。
    第二项是卡片指向的那份（没指定、或者指的那份已经删了，就是最新一份），带 shared 记号。
    """
    rows = PlanAssignment.query.filter_by(plan_id=plan.id, revoked=False).order_by(PlanAssignment.created_at.desc()).all()
    shared = next((a for a in rows if a.id == wanted), rows[0] if rows else None)
    files: dict[str, list[dict]] = {a.id: [] for a in rows}
    if rows:
        q = PlanFile.query.filter(PlanFile.assignment_id.in_(list(files)), PlanFile.submission_id.is_(None))
        for f in q.order_by(PlanFile.position, PlanFile.created_at).all():
            files[f.assignment_id].append({"id": f.id, "kind": f.kind, "name": f.name, "mime": f.mime, "size": f.size or 0, "url": None})
    return [{**_assignment_brief(a), "files": files[a.id], "shared": a is shared} for a in rows], shared


@bp.get("/plans/invite/<code>")
def invite_preview(code: str):
    """
    卡片落地页用：不用登录，给计划名、创建人的称呼和头像、学科、作业清单（每份作业下面有哪些文件）、已经加入的人。
    assignment 是卡片指向的那份（老客户端只认它）。
    带了登录信息时多给 role：owner = 自己建的，member = 已经在里面，null = 还没加入（要点一下确认才加入）。
    """
    plan = _invite_plan(code)
    assignments, a = _preview_assignments(plan, request.args.get("a"))
    viewer, role = _viewer_id(), None
    if viewer and viewer == plan.owner_id:
        role = "owner"
    elif viewer and PlanMember.query.filter_by(plan_id=plan.id, user_id=viewer, removed=False).first():
        role = "member"
    return jsonify({
        "plan": {"id": plan.id, "name": plan.name, "subject": plan.subject, "teacher": _teacher_name(plan), "teacherAvatar": avatar_url(plan.owner_id)},
        "assignment": _assignment_brief(a) if a else None,
        "assignments": assignments,
        "members": _joined_preview(plan),
        "role": role,
    })


@bp.post("/plans/join")
@login_required
def join_plan():
    """加入（客户端在加入页上让人确认过才调），不用创建人批准。已经在里面的直接返回。名字用账号当前的称呼"""
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
    assignments, uploads = _create_assignments(plan, request.get_json(silent=True) or {})
    db.session.commit()
    return jsonify(_created_body(plan, assignments, uploads)), 201


@bp.post("/plans/assignments/<assignment_id>/files")
@login_required
def add_assignment_files(assignment_id: str):
    """创建人往已有的一份作业里加文件：登记文件，返回上传链接（传完照常调 files/uploaded 确认）"""
    a, plan = _assignment_or_404(assignment_id)
    _require_role(plan, "owner")
    if a.revoked:
        abort(409, "这份作业已经删除了")
    files = _clean_files((request.get_json(silent=True) or {}).get("files"), ("scan", "attachment"))
    if not files:
        abort(400, "先扫描或上传一个附件")
    have = _files_of(a.id, None)
    if len(have) + len(files) > MAX_FILES:
        abort(400, f"一份作业最多 {MAX_FILES} 个文件")
    base = max((f.position or 0 for f in have), default=-1) + 1
    for f in files:
        f["position"] += base
    uploads = _add_files(plan, a, files)
    db.session.commit()
    return jsonify({"assignment": _assignment_brief(a), "uploads": uploads}), 201


@bp.delete("/plans/files/<file_id>")
@login_required
def delete_assignment_file(file_id: str):
    """创建人删掉作业里的一个文件（加文件没传上去时客户端用它收拾）。作业至少留一个文件；同学交的文件不归这里管"""
    row = db.session.get(PlanFile, file_id)
    plan = db.session.get(Plan, row.plan_id) if row else None
    if row is None or plan is None or row.submission_id:
        abort(404, "文件不存在")
    _require_role(plan, "owner")
    if len(_files_of(row.assignment_id, None)) <= 1:
        abort(409, "一份作业至少留一个文件")
    _delete_files([row])
    db.session.commit()
    return jsonify({"ok": True})


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
            abort(404, "老师删除了这份作业")
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
        abort(409, "老师删除了这份作业")
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


@bp.delete("/plans/assignments/<assignment_id>/submission")
@login_required
def withdraw_submission(assignment_id: str):
    """成员解绑：撤掉自己交的那份（照片一起删），这份作业回到没交。老师批阅过的不能撤"""
    user = current_user()
    a, plan = _assignment_or_404(assignment_id)
    _require_role(plan, "member")
    sub = PlanSubmission.query.filter_by(assignment_id=a.id, user_id=user.id).first()
    if sub is None:
        return jsonify({"ok": True})  # 本来就没交（或者点了两下）
    if sub.status == "reviewed":
        abort(409, "老师已经批阅过了，不能解绑")
    _delete_files(_files_of(a.id, sub.id))
    db.session.delete(sub)
    db.session.flush()
    # 老师删掉的作业只是为交过的人留着：最后一份也撤了，就把它真的删掉
    if a.revoked and not PlanSubmission.query.filter_by(assignment_id=a.id).count():
        _delete_files(PlanFile.query.filter_by(assignment_id=a.id).all())
        PlanView.query.filter_by(assignment_id=a.id).delete(synchronize_session=False)
        db.session.delete(a)
    db.session.commit()
    return jsonify({"ok": True})


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


_LANDING = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<style>
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;background:#F4F6FB;color:#1B2A4A;min-height:100vh;display:flex;flex-direction:column}}
.top{{background:#1F3B73;color:#fff;padding:28px 20px 52px}}.brand{{font-size:13px;opacity:.8}}.who{{margin-top:14px;font-size:15px;opacity:.92;display:flex;align-items:center;gap:10px}}
h1{{margin:6px 0 0;font-size:24px;line-height:1.35}}
.ava{{width:36px;height:36px;border-radius:18px;flex-shrink:0;object-fit:cover;background:#E8EEFB;color:#1F3B73;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}}
.who .ava{{border:2px solid rgba(255,255,255,.7)}}.joined{{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;opacity:.88}}
.stack{{display:flex;flex-shrink:0}}.stack .ava{{width:26px;height:26px;border-radius:13px;font-size:11px;border:2px solid #1F3B73;margin-left:-8px}}.stack .ava:first-child{{margin-left:0}}
.list{{margin:-32px 14px 0;display:flex;flex-direction:column;gap:10px}}
.hw{{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(31,59,115,.08)}}
.hw summary{{display:flex;align-items:center;gap:10px;padding:12px 14px 12px 12px;list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent}}.hw summary::-webkit-details-marker{{display:none}}
.no{{width:26px;height:26px;border-radius:8px;background:#1F3B73;color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;align-self:flex-start;margin-top:1px}}
.main{{flex:1;min-width:0}}.t{{font-size:16px;line-height:22px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.sub{{font-size:12px;line-height:18px;color:#7A869F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.tag{{flex-shrink:0;background:#E8EEFB;color:#1F3B73;border-radius:12px;padding:0 8px;font-size:12px;line-height:24px;font-weight:600}}
.chev{{flex-shrink:0;width:8px;height:8px;border-right:2px solid #A9B2C6;border-bottom:2px solid #A9B2C6;transform:rotate(45deg);margin:0 4px 4px 2px}}.hw[open] .chev{{transform:rotate(-135deg);margin:4px 4px 0 2px}}.hw.solo .chev{{display:none}}
.f{{display:flex;align-items:center;gap:12px;min-height:50px;padding:8px 16px 8px 48px;border-top:1px solid #EEF1F7;background:#FAFBFD}}.f.more{{display:none}}.hw.all .f.more{{display:flex}}
.badge{{width:34px;height:40px;border-radius:8px;background:#E8EEFB;color:#1F3B73;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}}
.fn{{font-size:15px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.fs{{font-size:12px;line-height:16px;color:#7A869F}}
.lock{{flex-shrink:0;width:15px;height:15px;stroke:#B9C0D0;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}}
.rest{{display:block;width:100%;border:0;border-top:1px solid #EEF1F7;background:#FAFBFD;text-align:left;min-height:42px;padding:0 16px 0 48px;font-size:14px;font-weight:600;color:#1F3B73;font-family:inherit}}.hw.all .rest{{display:none}}
.none{{background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(31,59,115,.08);padding:36px 20px;text-align:center;font-size:13px;line-height:19px;color:#7A869F}}.none b{{display:block;font-size:16px;color:#1B2A4A;margin-bottom:6px}}
.grow{{flex:1;min-height:16px}}.bar{{position:sticky;bottom:0;background:#F4F6FB;padding:12px 14px calc(14px + env(safe-area-inset-bottom))}}
.btn{{display:block;width:100%;border:0;border-radius:14px;background:#1F3B73;color:#fff;font-size:17px;font-weight:600;padding:15px;text-align:center;text-decoration:none}}
.tip{{margin-top:10px;text-align:center;font-size:13px;color:#7A869F}}.tip a{{color:#1F3B73}}
.mask{{display:none;position:fixed;inset:0;background:rgba(10,20,45,.82);color:#fff;padding:28px;font-size:17px;line-height:1.7;text-align:right}}
.mask.on{{display:block}}.mask b{{font-size:30px}}
</style></head><body>
<div class="top"><div class="brand">上壹课 · 学习计划</div><div class="who">{avatar}<span>{teacher} 邀请你加入</span></div><h1>{name}</h1>{joined}</div>
<div class="list">{assignments}</div>
<div class="grow"></div>
<div class="bar"><a class="btn" id="open" href="{deeplink}">打开上壹课，加入学习计划</a>
<div class="tip" id="tip">{download}</div></div>
<div class="mask" id="mask"><b>↗</b><br>点右上角「···」<br>选择「在浏览器打开」<br>就能打开上壹课加入了</div>
<script>
(function(){{
  var wx=/MicroMessenger/i.test(navigator.userAgent),mask=document.getElementById('mask');
  function go(e){{if(wx){{if(e)e.preventDefault();mask.className='mask on';}}else if(!e){{location.href={deeplink_js};}}}}
  document.getElementById('open').addEventListener('click',go);
  mask.addEventListener('click',function(){{mask.className='mask';}});
  // 文件在这里只看得到名字：点文件和点按钮一样，去上壹课加入后再打开；「其余 N 个文件」就地展开
  document.addEventListener('click',function(e){{
    var t=e.target,rest=t.closest&&t.closest('.rest'),file=t.closest&&t.closest('.f');
    if(rest){{rest.parentNode.className+=' all';}}else if(file){{go();}}
  }});
  var solo=document.querySelector('.hw.solo summary');
  if(solo)solo.addEventListener('click',function(e){{e.preventDefault();}});
  if(!wx){{setTimeout(function(){{location.href={deeplink_js};}},300);}}
}})();
</script></body></html>"""

LANDING_FILES = 3  # 落地页上一份作业先显示几个文件，和客户端的 HW_PREVIEW 一致
_LOCK = '<svg class="lock" viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>'


def _size_text(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def _file_badge(mime: str) -> str:
    return "PDF" if mime == "application/pdf" else "DOC" if "word" in mime else "图片"


def _landing_cards(assignments: list[dict]) -> str:
    """落地页上的作业清单：和计划页同一种卡片（序号、作业名、日期和文件数，文件缩进排在下面），卡片指向的那份展开"""
    from html import escape

    if not assignments:
        return '<div class="none"><b>老师还没有布置作业</b>可以先加入<br>老师布置后会出现在计划里</div>'
    solo = len(assignments) == 1
    out = []
    for i, a in enumerate(assignments):
        files = a["files"]
        created = a["createdAt"] or ""
        date = f"{int(created[5:7])}月{int(created[8:10])}日" if len(created) >= 10 else ""
        if date and created[:4] != str(datetime.now().year):
            date = f"{created[:4]}年{date}"
        sub = " · ".join(x for x in (date, f"{len(files)} 个文件", f"{_due_text(a['dueAt'])}截止" if a["dueAt"] else "") if x)
        rows = "".join(
            f'<div class="f{" more" if n >= LANDING_FILES else ""}"><span class="badge">{_file_badge(f["mime"])}</span>'
            f'<div class="main"><div class="fn">{escape(f["name"])}</div><div class="fs">{_size_text(f["size"])}</div></div>{_LOCK}</div>'
            for n, f in enumerate(files)
        )
        rest = f'<button class="rest" type="button">其余 {len(files) - LANDING_FILES} 个文件</button>' if len(files) > LANDING_FILES else ""
        tag = '<span class="tag">这次布置</span>' if a["shared"] and not solo else ""
        out.append(
            f'<details class="hw{" solo" if solo else ""}"{" open" if a["shared"] else ""}><summary><span class="no">{len(assignments) - i}</span>'
            f'<div class="main"><div class="t">{escape(a["title"])}</div><div class="sub">{escape(sub)}</div></div>{tag}<span class="chev"></span></summary>{rows}{rest}</details>'
        )
    return "".join(out)


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
    assignments, a = _preview_assignments(plan, request.args.get("a"))
    scheme = current_app.config.get("APP_URL_SCHEME") or "shangyike"
    deeplink = f"{scheme}://plans/join?code={plan.invite_code}" + (f"&a={a.id}" if a else "")

    def ava(name: str, url: str | None) -> str:
        return f'<img class="ava" src="{escape(url)}" alt="">' if url else f'<span class="ava">{escape(name[-1:])}</span>'

    people = _joined_preview(plan)
    joined = ""
    if people["count"]:
        stack = "".join(ava(m["name"], m["avatar"]) for m in people["list"][:5])
        joined = f'<div class="joined"><div class="stack">{stack}</div><span>已有 {people["count"]} 人加入</span></div>'
    dl = current_app.config.get("APP_DOWNLOAD_URL") or ""
    download = f'还没装上壹课？<a href="{escape(dl)}">去下载</a>，装好后再点一次这个链接' if dl else "还没装上壹课？先在应用商店搜索「上壹课」安装，再点一次这个链接"
    html = _LANDING.format(
        title=escape(f"{_teacher_name(plan)}邀请你加入「{plan.name}」"), desc=escape(a.title if a else "打开上壹课加入学习计划"),
        teacher=escape(_teacher_name(plan)), name=escape(plan.name),
        assignments=_landing_cards(assignments), joined=joined, avatar=ava(_teacher_name(plan), avatar_url(plan.owner_id)), deeplink=escape(deeplink), deeplink_js=json.dumps(deeplink), download=download,
    )
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}
