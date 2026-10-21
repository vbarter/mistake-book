from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON

from .extensions import db


def _uuid() -> str:
    return uuid.uuid4().hex


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    phone = db.Column(db.String(32), unique=True, nullable=True, index=True)
    apple_sub = db.Column(db.String(128), unique=True, nullable=True, index=True)
    nickname = db.Column(db.String(32), default="小同学")
    grade = db.Column(db.String(4), default="5")
    subjects = db.Column(JSON, default=lambda: ["math", "chinese", "english", "science"])
    weekly_goal = db.Column(db.Integer, default=5)
    reminder_enabled = db.Column(db.Boolean, default=False)
    reminder_hour = db.Column(db.Integer, default=19)
    reminder_minute = db.Column(db.Integer, default=30)
    created_at = db.Column(db.DateTime, default=datetime.now)

    mistakes = db.relationship("Mistake", backref="user", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "phone": self.phone,
            "loginMethod": "apple" if self.apple_sub else ("phone" if self.phone else "guest"),
            "nickname": self.nickname,
            "grade": self.grade,
            "subjects": self.subjects or [],
            "weeklyGoal": self.weekly_goal,
            "reviewReminder": {
                "enabled": bool(self.reminder_enabled),
                "hour": self.reminder_hour,
                "minute": self.reminder_minute,
            },
            "createdAt": _iso(self.created_at),
        }


class Mistake(db.Model):
    __tablename__ = "mistakes"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), db.ForeignKey("users.id"), index=True, nullable=False)

    subject = db.Column(db.String(16), nullable=False, index=True)
    knowledge_points = db.Column(JSON, default=list)
    question_type = db.Column(db.String(16), default="solve")
    options = db.Column(JSON, default=list)
    stem_text = db.Column(db.Text, default="")
    stem_image = db.Column(db.String(256), nullable=True)
    uncertain_spans = db.Column(JSON, default=list)
    student_answer = db.Column(db.Text, default="")
    correct_answer = db.Column(db.Text, default="")
    analysis = db.Column(db.Text, default="")
    tip = db.Column(db.Text, default="")
    ai_generated = db.Column(db.Boolean, default=True)
    ai_pending = db.Column(db.Boolean, default=False)
    reasons = db.Column(JSON, default=list)
    note = db.Column(db.Text, default="")
    source = db.Column(JSON, default=dict)

    mastered = db.Column(db.Boolean, default=False, index=True)
    manual_mastered = db.Column(db.Boolean, default=False)
    mastered_at = db.Column(db.DateTime, nullable=True)
    interval_index = db.Column(db.Integer, default=0)
    next_due_at = db.Column(db.DateTime, nullable=True, index=True)
    streak = db.Column(db.Integer, default=0)
    wrong_count = db.Column(db.Integer, default=1)
    variants = db.Column(JSON, default=list)

    created_at = db.Column(db.DateTime, default=datetime.now, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    logs = db.relationship(
        "ReviewLog", backref="mistake", cascade="all, delete-orphan", order_by="ReviewLog.created_at"
    )

    def state(self, now: datetime | None = None) -> str:
        from .scheduler import effective_state

        return effective_state(self, now or datetime.now())

    def to_dict(self, brief: bool = False, now: datetime | None = None) -> dict:
        now = now or datetime.now()
        data = {
            "id": self.id,
            "subject": self.subject,
            "knowledgePoints": self.knowledge_points or [],
            "questionType": self.question_type,
            "options": self.options or [],
            "stemText": self.stem_text,
            "stemImageUrl": f"/api/uploads/{self.stem_image}" if self.stem_image else None,
            "studentAnswer": self.student_answer,
            "reasons": self.reasons or [],
            "note": self.note,
            "source": self.source or {},
            "mastery": self.state(now),
            "manualMastered": bool(self.manual_mastered),
            "wrongCount": self.wrong_count,
            "aiPending": bool(self.ai_pending),
            "review": {
                "intervalIndex": self.interval_index,
                "nextDueAt": _iso(self.next_due_at),
                "streak": self.streak,
            },
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }
        if not brief:
            data.update(
                {
                    "correctAnswer": self.correct_answer,
                    "analysis": self.analysis,
                    "tip": self.tip,
                    "aiGenerated": bool(self.ai_generated),
                    "uncertainSpans": self.uncertain_spans or [],
                    "variants": self.variants or [],
                    "masteredAt": _iso(self.mastered_at),
                    "history": [log.to_dict() for log in self.logs],
                }
            )
        return data


class ReviewLog(db.Model):
    __tablename__ = "review_logs"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), db.ForeignKey("users.id"), index=True, nullable=False)
    mistake_id = db.Column(db.String(32), db.ForeignKey("mistakes.id"), index=True, nullable=False)
    kind = db.Column(db.String(16), default="review")  # review | practice | create | master
    result = db.Column(db.String(16), default="")  # forgot | fuzzy | remembered | correct | wrong
    created_at = db.Column(db.DateTime, default=datetime.now, index=True)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "result": self.result, "at": _iso(self.created_at)}


class PracticeSession(db.Model):
    __tablename__ = "practice_sessions"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), db.ForeignKey("users.id"), index=True, nullable=False)
    mode = db.Column(db.String(16), default="weak")
    topic = db.Column(db.String(64), nullable=True)
    subject = db.Column(db.String(16), nullable=True)
    items = db.Column(JSON, default=list)
    answers = db.Column(JSON, default=dict)
    mastery_before = db.Column(JSON, default=dict)
    started_at = db.Column(db.DateTime, default=datetime.now)
    finished_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self, reveal: bool = False) -> dict:
        items = []
        for i, item in enumerate(self.items or []):
            public = {
                "index": i,
                "mistakeId": item["mistakeId"],
                "subject": item["subject"],
                "topic": item["topic"],
                "question": item["question"],
                "questionType": item["questionType"],
                "options": item.get("options") or [],
                "isVariant": item.get("isVariant", False),
            }
            if reveal or str(i) in (self.answers or {}):
                public["answer"] = item["answer"]
                public["analysis"] = item["analysis"]
            items.append(public)
        return {
            "id": self.id,
            "mode": self.mode,
            "topic": self.topic,
            "subject": self.subject,
            "items": items,
            "answers": self.answers or {},
            "startedAt": _iso(self.started_at),
            "finishedAt": _iso(self.finished_at),
        }
