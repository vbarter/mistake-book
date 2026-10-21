"""今日复习：队列与自评。"""
from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, abort, current_app, jsonify, request

from ..auth_utils import current_user, login_required
from ..constants import RATINGS
from ..extensions import db
from ..models import Mistake, ReviewLog
from ..scheduler import INTERVALS, apply_rating, build_queue, effective_state

bp = Blueprint("review", __name__)


def _today_logs(user_id: str, now: datetime):
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return ReviewLog.query.filter(
        ReviewLog.user_id == user_id, ReviewLog.kind == "review", ReviewLog.created_at >= start
    ).all()


@bp.get("/review/today")
@login_required
def today():
    user = current_user()
    now = datetime.now()
    mistakes = Mistake.query.filter_by(user_id=user.id).all()
    limit = current_app.config["DAILY_REVIEW_LIMIT"]
    queue = build_queue(mistakes, now, limit)
    done_today = len(_today_logs(user.id, now))
    total_due = sum(1 for m in mistakes if effective_state(m, now) == "due")
    end_of_tomorrow = (now + timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=0)
    tomorrow = sum(1 for m in mistakes if not m.mastered and m.next_due_at and now < m.next_due_at <= end_of_tomorrow)
    return jsonify(
        {
            "items": [m.to_dict(now=now) for m in queue],
            "total": len(queue),
            "doneToday": done_today,
            "overflow": max(0, total_due - len(queue)),
            "tomorrow": tomorrow,
            "estimatedMinutes": max(1, round(len(queue) * 1.1)),
        }
    )


@bp.post("/review/<mid>/rate")
@login_required
def rate(mid: str):
    user = current_user()
    data = request.get_json(silent=True) or {}
    result = data.get("result")
    if result not in RATINGS:
        abort(400, "自评只能是 forgot / fuzzy / remembered")
    m = Mistake.query.filter_by(id=mid, user_id=user.id).first()
    if m is None:
        abort(404)
    now = datetime.now()
    change = apply_rating(m, result, now)
    db.session.add(ReviewLog(user_id=user.id, mistake_id=m.id, kind="review", result=result))
    db.session.commit()
    return jsonify(
        {
            "mistake": m.to_dict(now=now),
            "change": {"from": change["from"], "to": change["to"], "nextDueAt": change["nextDueAt"].isoformat(timespec="seconds")},
            "intervals": INTERVALS,
        }
    )


@bp.get("/review/preview/<mid>")
@login_required
def preview(mid: str):
    """三个自评按钮上显示的「下次时间」预告。"""
    user = current_user()
    m = Mistake.query.filter_by(id=mid, user_id=user.id).first()
    if m is None:
        abort(404)
    idx = m.interval_index or 0
    nxt = min(idx + 1, len(INTERVALS) - 1)
    will_master = (m.streak or 0) + 1 >= 2 and nxt >= 2
    return jsonify(
        {
            "forgot": {"days": INTERVALS[0]},
            "fuzzy": {"days": max(1, INTERVALS[idx] * 0.5)},
            "remembered": {"days": 30 if will_master else INTERVALS[nxt], "willMaster": will_master},
        }
    )
