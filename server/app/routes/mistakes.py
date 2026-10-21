"""错题库：列表、知识点分组、详情、批量创建（含去重合并）、编辑、删除、掌握、变式、统计。"""
from __future__ import annotations

import base64
import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from difflib import SequenceMatcher

from flask import Blueprint, abort, current_app, jsonify, request, send_from_directory

from ..ai import AIError, get_provider
from ..auth_utils import current_user, login_required
from ..constants import QUESTION_TYPES, REASONS, SUBJECTS
from ..extensions import db
from ..models import Mistake, ReviewLog
from ..scheduler import effective_state, mark_mastered, reinstate, schedule_new

bp = Blueprint("mistakes", __name__)


# ----------------------------------------------------------------- helpers
def _own(mistake_id: str) -> Mistake:
    m = Mistake.query.filter_by(id=mistake_id, user_id=current_user().id).first()
    if m is None:
        abort(404)
    return m


def _normalize(text: str) -> str:
    return "".join(ch for ch in (text or "") if not ch.isspace()).lower()


def _find_duplicate(user_id: str, subject: str, stem: str) -> Mistake | None:
    norm = _normalize(stem)
    if len(norm) < 6:
        return None
    for m in Mistake.query.filter_by(user_id=user_id, subject=subject).all():
        if SequenceMatcher(None, norm, _normalize(m.stem_text)).ratio() >= 0.9:
            return m
    return None


def _save_image(user_id: str, data_url: str | None) -> str | None:
    if not data_url:
        return None
    try:
        header, b64 = data_url.split(",", 1)
        ext = "png" if "png" in header else "jpg"
        raw = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        return None
    folder = os.path.join(current_app.config["UPLOAD_DIR"], user_id)
    os.makedirs(folder, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(folder, name), "wb") as f:
        f.write(raw)
    return f"{user_id}/{name}"


def _apply_fields(m: Mistake, data: dict) -> None:
    if "subject" in data:
        if data["subject"] not in SUBJECTS:
            abort(400, "学科不合法")
        m.subject = data["subject"]
    if "knowledgePoints" in data:
        kps = [str(k).strip() for k in data["knowledgePoints"] if str(k).strip()]
        m.knowledge_points = kps[:3] or ["未分类"]
    if "questionType" in data and data["questionType"] in QUESTION_TYPES:
        m.question_type = data["questionType"]
    if "options" in data:
        m.options = [str(o) for o in data["options"]][:6]
    if "stemText" in data:
        m.stem_text = str(data["stemText"]).strip()
    if "studentAnswer" in data:
        m.student_answer = str(data["studentAnswer"]).strip()
    if "correctAnswer" in data:
        m.correct_answer = str(data["correctAnswer"]).strip()
        m.ai_generated = False
    if "analysis" in data:
        m.analysis = str(data["analysis"]).strip()
        m.ai_generated = False
    if "tip" in data:
        m.tip = str(data["tip"]).strip()
    if "reasons" in data:
        reasons = [r for r in data["reasons"] if r in REASONS]
        m.reasons = reasons
    if "note" in data:
        m.note = str(data["note"]).strip()[:500]
    if "source" in data and isinstance(data["source"], dict):
        m.source = {k: data["source"][k] for k in ("name", "page", "box", "date") if k in data["source"]}
    if "uncertainSpans" in data:
        m.uncertain_spans = [str(s) for s in data["uncertainSpans"]][:10]


# ----------------------------------------------------------------- routes
@bp.get("/uploads/<path:name>")
def serve_upload(name: str):
    return send_from_directory(current_app.config["UPLOAD_DIR"], name)


@bp.get("/mistakes")
@login_required
def list_mistakes():
    user = current_user()
    now = datetime.now()
    q = Mistake.query.filter_by(user_id=user.id)
    subject = request.args.get("subject")
    if subject in SUBJECTS:
        q = q.filter_by(subject=subject)
    topic = request.args.get("topic")
    items = q.order_by(Mistake.created_at.desc()).all()
    if topic:
        items = [m for m in items if topic in (m.knowledge_points or [])]
    state = request.args.get("state")
    if state in ("due", "learning", "mastered"):
        items = [m for m in items if effective_state(m, now) == state]
    keyword = (request.args.get("q") or "").strip().lower()
    if keyword:
        items = [
            m
            for m in items
            if keyword in (m.stem_text or "").lower()
            or any(keyword in k.lower() for k in (m.knowledge_points or []))
            or keyword in (m.note or "").lower()
        ]
    limit = min(int(request.args.get("limit", 200)), 500)
    return jsonify({"items": [m.to_dict(brief=True, now=now) for m in items[:limit]], "total": len(items)})


@bp.get("/mistakes/groups")
@login_required
def knowledge_groups():
    """按学科 → 知识点聚合，供错题库「按知识点」视图。"""
    user = current_user()
    now = datetime.now()
    subject = request.args.get("subject")
    q = Mistake.query.filter_by(user_id=user.id)
    if subject in SUBJECTS:
        q = q.filter_by(subject=subject)
    mistakes = q.all()
    only_due = request.args.get("state") == "due"

    groups: dict[tuple[str, str], dict] = {}
    for m in mistakes:
        st = effective_state(m, now)
        if only_due and st != "due":
            continue
        for kp in m.knowledge_points or ["未分类"]:
            g = groups.setdefault(
                (m.subject, kp),
                {"subject": m.subject, "topic": kp, "total": 0, "due": 0, "learning": 0, "mastered": 0, "latestAt": None},
            )
            g["total"] += 1
            g[st] += 1
            if g["latestAt"] is None or (m.created_at and m.created_at.isoformat() > g["latestAt"]):
                g["latestAt"] = m.created_at.isoformat(timespec="seconds") if m.created_at else None

    by_subject: dict[str, list] = defaultdict(list)
    for g in groups.values():
        g["masteryRate"] = round(g["mastered"] / g["total"], 2) if g["total"] else 0
        by_subject[g["subject"]].append(g)
    counted = [m for m in mistakes if not only_due or effective_state(m, now) == "due"]
    sections = []
    for s in SUBJECTS:
        if by_subject[s]:
            topics = sorted(by_subject[s], key=lambda g: (-g["due"], g["masteryRate"], g["topic"]))
            subject_items = [m for m in counted if m.subject == s]
            sections.append(
                {
                    "subject": s,
                    "total": len(subject_items),
                    "mastered": sum(1 for m in subject_items if effective_state(m, now) == "mastered"),
                    "topics": topics,
                }
            )
    return jsonify(
        {
            "sections": sections,
            "summary": {
                "topics": len(groups),
                "total": len(counted),
                "mastered": sum(1 for m in counted if effective_state(m, now) == "mastered"),
                "due": sum(1 for m in counted if effective_state(m, now) == "due"),
            },
        }
    )


@bp.get("/mistakes/<mid>")
@login_required
def get_mistake(mid: str):
    return jsonify({"mistake": _own(mid).to_dict()})


@bp.post("/mistakes")
@login_required
def create_mistakes():
    """批量入库。请求：{"items": [{subject, knowledgePoints, stemText, ..., stemImage(dataURL)}]}。
    同学科且题干相似度 ≥ 90% 视为同题，合并为「再错一次」。"""
    user = current_user()
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not items:
        abort(400, "没有要保存的错题")
    now = datetime.now()
    created, merged = [], []
    for raw in items[:20]:
        if raw.get("subject") not in SUBJECTS:
            abort(400, "学科不合法")
        if not str(raw.get("stemText", "")).strip():
            abort(400, "题干不能为空")
        if not raw.get("reasons"):
            abort(400, "请至少选择一个错因")
        dup = _find_duplicate(user.id, raw["subject"], raw["stemText"]) if raw.get("allowMerge", True) else None
        if dup is not None:
            dup.wrong_count = (dup.wrong_count or 1) + 1
            if raw.get("reasons"):
                dup.reasons = sorted(set((dup.reasons or []) + [r for r in raw["reasons"] if r in REASONS]))
            schedule_new(dup, now)
            db.session.add(ReviewLog(user_id=user.id, mistake_id=dup.id, kind="create", result="again"))
            merged.append(dup)
            continue
        m = Mistake(user_id=user.id, subject=raw["subject"])
        _apply_fields(m, raw)
        m.ai_generated = bool(raw.get("aiGenerated", True))
        m.ai_pending = bool(raw.get("aiPending", False))
        m.stem_image = _save_image(user.id, raw.get("stemImage"))
        schedule_new(m, now)
        db.session.add(m)
        db.session.flush()
        db.session.add(ReviewLog(user_id=user.id, mistake_id=m.id, kind="create", result="new"))
        created.append(m)
    db.session.commit()
    return (
        jsonify(
            {
                "created": [m.to_dict(now=now) for m in created],
                "merged": [m.to_dict(now=now) for m in merged],
                "topics": sorted({kp for m in created + merged for kp in (m.knowledge_points or [])}),
            }
        ),
        201,
    )


@bp.patch("/mistakes/<mid>")
@login_required
def update_mistake(mid: str):
    m = _own(mid)
    _apply_fields(m, request.get_json(silent=True) or {})
    db.session.commit()
    return jsonify({"mistake": m.to_dict()})


@bp.delete("/mistakes/<mid>")
@login_required
def delete_mistake(mid: str):
    m = _own(mid)
    if m.stem_image:
        try:
            os.remove(os.path.join(current_app.config["UPLOAD_DIR"], m.stem_image))
        except OSError:
            pass
    db.session.delete(m)
    db.session.commit()
    return jsonify({"ok": True})


@bp.post("/mistakes/<mid>/master")
@login_required
def master(mid: str):
    m = _own(mid)
    mark_mastered(m)
    db.session.add(ReviewLog(user_id=m.user_id, mistake_id=m.id, kind="master", result="manual"))
    db.session.commit()
    return jsonify({"mistake": m.to_dict()})


@bp.post("/mistakes/<mid>/reinstate")
@login_required
def reinstate_mistake(mid: str):
    m = _own(mid)
    reinstate(m)
    db.session.add(ReviewLog(user_id=m.user_id, mistake_id=m.id, kind="master", result="reinstated"))
    db.session.commit()
    return jsonify({"mistake": m.to_dict()})


@bp.post("/mistakes/<mid>/variants")
@login_required
def generate_variants(mid: str):
    m = _own(mid)
    count = int((request.get_json(silent=True) or {}).get("count", 2))
    try:
        variants = get_provider().generate_variants(m.to_dict(), count=max(1, min(count, 5)))
    except AIError as e:
        return jsonify({"error": "ai_unavailable", "message": str(e)}), 502
    m.variants = [v.to_dict() for v in variants]
    db.session.commit()
    return jsonify({"mistake": m.to_dict()})


@bp.get("/stats/overview")
@login_required
def overview():
    """今天页与我的页所需的全部数字。"""
    user = current_user()
    now = datetime.now()
    mistakes = Mistake.query.filter_by(user_id=user.id).all()
    states = [effective_state(m, now) for m in mistakes]
    total = len(mistakes)
    mastered = states.count("mastered")

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    logs = ReviewLog.query.filter(ReviewLog.user_id == user.id, ReviewLog.created_at >= week_start).all()
    review_logs = [l for l in logs if l.kind == "review"]
    week_days = {l.created_at.date() for l in review_logs}
    week = []
    for i in range(7):
        day = (week_start + timedelta(days=i)).date()
        week.append({"date": day.isoformat(), "done": day in week_days, "isToday": day == now.date(), "future": day > now.date()})

    # 连续天数：从今天（或昨天）往前数有复习记录的天
    all_days = {l.created_at.date() for l in ReviewLog.query.filter_by(user_id=user.id, kind="review").all()}
    streak = 0
    cursor = now.date() if now.date() in all_days else now.date() - timedelta(days=1)
    while cursor in all_days:
        streak += 1
        cursor -= timedelta(days=1)

    subject_dist = []
    for s in SUBJECTS:
        ms = [m for m in mistakes if m.subject == s]
        if ms:
            subject_dist.append(
                {
                    "subject": s,
                    "total": len(ms),
                    "mastered": sum(1 for m in ms if effective_state(m, now) == "mastered"),
                    "due": sum(1 for m in ms if effective_state(m, now) == "due"),
                }
            )

    due_items = [m for m in mistakes if effective_state(m, now) == "due"]
    due_by_subject = defaultdict(int)
    for m in due_items:
        due_by_subject[m.subject] += 1
    recent = sorted(mistakes, key=lambda m: m.created_at or now, reverse=True)[:3]
    return jsonify(
        {
            "total": total,
            "mastered": mastered,
            "due": len(due_items),
            "dueBySubject": dict(due_by_subject),
            "masteryRate": round(mastered / total, 2) if total else 0,
            "weekNew": sum(1 for m in mistakes if m.created_at and m.created_at >= week_start),
            "weekMastered": sum(1 for m in mistakes if m.mastered_at and m.mastered_at >= week_start),
            "weekReviewed": len(review_logs),
            "weeklyGoal": user.weekly_goal,
            "week": week,
            "streakDays": streak,
            "subjects": subject_dist,
            "recent": [m.to_dict(brief=True, now=now) for m in recent],
        }
    )
