"""练习：薄弱知识点、开始练习（变式题）、答题、结束。"""
from __future__ import annotations

import random
import re
from datetime import datetime

from flask import Blueprint, abort, jsonify, request

from ..ai import AIError, get_provider
from ..auth_utils import current_user, login_required
from ..constants import SUBJECTS
from ..extensions import db
from ..models import Mistake, PracticeSession, ReviewLog
from ..scheduler import apply_practice, effective_state

bp = Blueprint("practice", __name__)


def _topic_stats(mistakes, now: datetime) -> list[dict]:
    groups: dict[tuple[str, str], list] = {}
    for m in mistakes:
        for kp in m.knowledge_points or ["未分类"]:
            groups.setdefault((m.subject, kp), []).append(m)
    out = []
    for (subject, topic), ms in groups.items():
        mastered = sum(1 for m in ms if effective_state(m, now) == "mastered")
        # 掌握度：已掌握题占比 + 巩固中的进度加权
        progress = 0.0
        for m in ms:
            st = effective_state(m, now)
            if st == "mastered":
                progress += 1
            elif st == "learning":
                progress += 0.3 + 0.15 * min(m.interval_index or 0, 3)
        rate = round(progress / len(ms), 2)
        out.append(
            {
                "subject": subject,
                "topic": topic,
                "total": len(ms),
                "mastered": mastered,
                "wrongCount": sum(m.wrong_count or 1 for m in ms),
                "masteryRate": rate,
            }
        )
    return out


@bp.get("/practice/weak")
@login_required
def weak_topics():
    user = current_user()
    now = datetime.now()
    mistakes = Mistake.query.filter_by(user_id=user.id).all()
    topics = [t for t in _topic_stats(mistakes, now) if t["masteryRate"] < 0.8]
    topics.sort(key=lambda t: (t["masteryRate"], -t["wrongCount"]))
    return jsonify({"topics": topics, "suggestedMinutes": 3 if topics else 0})


def _letter(i: int) -> str:
    return chr(ord("A") + i)


def _build_items(mistakes: list[Mistake], count: int) -> list[dict]:
    """每道错题出一道变式（没有变式时用原题），凑够 count 题。"""
    items: list[dict] = []
    provider = get_provider()
    for m in mistakes:
        if len(items) >= count:
            break
        variants = m.variants or []
        if not variants:
            try:
                variants = [v.to_dict() for v in provider.generate_variants(m.to_dict(), count=2)]
                m.variants = variants
            except AIError:
                variants = []
        topic = (m.knowledge_points or ["未分类"])[0]
        if variants:
            v = random.choice(variants)
            items.append(
                {
                    "mistakeId": m.id,
                    "subject": m.subject,
                    "topic": topic,
                    "question": v["question"],
                    "questionType": v["questionType"],
                    "options": v.get("options") or [],
                    "answer": v["answer"],
                    "analysis": v["analysis"],
                    "isVariant": True,
                }
            )
        else:
            items.append(
                {
                    "mistakeId": m.id,
                    "subject": m.subject,
                    "topic": topic,
                    "question": m.stem_text,
                    "questionType": m.question_type,
                    "options": m.options or [],
                    "answer": m.correct_answer,
                    "analysis": m.analysis,
                    "isVariant": False,
                }
            )
    return items


@bp.post("/practice/start")
@login_required
def start():
    user = current_user()
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "weak")
    count = int(data.get("count", 3))
    if count not in (3, 5, 10):
        abort(400, "题量只能是 3 / 5 / 10")
    now = datetime.now()
    q = Mistake.query.filter_by(user_id=user.id)
    mistakes = q.all()
    if not mistakes:
        abort(400, "还没有错题，先去录几道吧")

    if mode == "weak":
        topic, subject = data.get("topic"), data.get("subject")
        if topic:
            pool = [m for m in mistakes if topic in (m.knowledge_points or []) and (not subject or m.subject == subject)]
        else:
            stats = _topic_stats(mistakes, now)
            stats.sort(key=lambda t: (t["masteryRate"], -t["wrongCount"]))
            weakest = stats[0] if stats else None
            topic = weakest["topic"] if weakest else None
            subject = weakest["subject"] if weakest else None
            pool = [m for m in mistakes if weakest and topic in (m.knowledge_points or []) and m.subject == subject]
    else:
        subjects = [s for s in data.get("subjects", []) if s in SUBJECTS] or (user.subjects or SUBJECTS)
        pool = [m for m in mistakes if m.subject in subjects]
        if data.get("onlyDue"):
            pool = [m for m in pool if effective_state(m, now) == "due"]
        topic, subject = None, None
    if not pool:
        abort(400, "这个范围里没有可练的题")

    # 优先未掌握、错次多的题；不够时循环使用
    pool.sort(key=lambda m: (m.mastered, -(m.wrong_count or 1)))
    ordered = (pool * ((count // len(pool)) + 1))[:count]
    items = _build_items(ordered, count)
    session = PracticeSession(
        user_id=user.id,
        mode=mode,
        topic=topic,
        subject=subject,
        items=items,
        answers={},
        mastery_before={t["topic"]: t["masteryRate"] for t in _topic_stats(mistakes, now)},
    )
    db.session.add(session)
    db.session.commit()
    return jsonify({"session": session.to_dict()}), 201


@bp.get("/practice/<sid>")
@login_required
def get_session(sid: str):
    session = PracticeSession.query.filter_by(id=sid, user_id=current_user().id).first()
    if session is None:
        abort(404)
    return jsonify({"session": session.to_dict(reveal=session.finished_at is not None)})


def _normalize_answer(text: str) -> str:
    t = re.sub(r"[\s（）()。．.]", "", str(text or "")).lower()
    return t.replace("米", "").replace("千克", "").replace("平方厘米", "").replace("厘米", "")


def _is_correct(item: dict, answer: str) -> bool:
    expected = str(item.get("answer", "")).strip()
    given = str(answer or "").strip()
    if item.get("questionType") == "choice":
        return given.upper()[:1] == expected.upper()[:1]
    return _normalize_answer(given) == _normalize_answer(expected) or (
        bool(given) and _normalize_answer(expected).startswith(_normalize_answer(given)) and len(_normalize_answer(given)) >= 2
    )


@bp.post("/practice/<sid>/answer")
@login_required
def answer(sid: str):
    user = current_user()
    session = PracticeSession.query.filter_by(id=sid, user_id=user.id).first()
    if session is None:
        abort(404)
    data = request.get_json(silent=True) or {}
    index = int(data.get("index", -1))
    items = session.items or []
    if not 0 <= index < len(items):
        abort(400, "题号不对")
    answers = dict(session.answers or {})
    if str(index) in answers:
        abort(400, "这题已经作答过了")
    item = items[index]
    given = str(data.get("answer", "")).strip()
    if item.get("questionType") == "solve" and data.get("selfRated") is not None:
        correct = bool(data["selfRated"])  # 解答题由学生对照答案自评
    else:
        correct = _is_correct(item, given)
    answers[str(index)] = {"answer": given, "correct": correct}
    session.answers = answers

    m = Mistake.query.filter_by(id=item["mistakeId"], user_id=user.id).first()
    change = None
    if m is not None:
        change = apply_practice(m, correct)
        db.session.add(ReviewLog(user_id=user.id, mistake_id=m.id, kind="practice", result="correct" if correct else "wrong"))
    db.session.commit()
    return jsonify(
        {
            "correct": correct,
            "answer": item["answer"],
            "analysis": item["analysis"],
            "change": {"from": change["from"], "to": change["to"]} if change else None,
            "answered": len(answers),
            "total": len(items),
        }
    )


@bp.post("/practice/<sid>/finish")
@login_required
def finish(sid: str):
    user = current_user()
    session = PracticeSession.query.filter_by(id=sid, user_id=user.id).first()
    if session is None:
        abort(404)
    now = datetime.now()
    if session.finished_at is None:
        session.finished_at = now
        db.session.commit()
    answers = session.answers or {}
    total = len(session.items or [])
    correct = sum(1 for a in answers.values() if a.get("correct"))
    mistakes = Mistake.query.filter_by(user_id=user.id).all()
    after = {t["topic"]: t["masteryRate"] for t in _topic_stats(mistakes, now)}
    topics = sorted({it["topic"] for it in session.items or []})
    newly = [
        m.to_dict(brief=True, now=now)
        for m in mistakes
        if m.id in {it["mistakeId"] for it in session.items or []} and m.mastered and m.mastered_at and m.mastered_at >= session.started_at
    ]
    return jsonify(
        {
            "session": session.to_dict(reveal=True),
            "result": {
                "correct": correct,
                "answered": len(answers),
                "total": total,
                "rate": round(correct / total, 2) if total else 0,
                "topics": [
                    {"topic": t, "before": (session.mastery_before or {}).get(t, 0), "after": after.get(t, 0)} for t in topics
                ],
                "newlyMastered": newly,
            },
        }
    )
