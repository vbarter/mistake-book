from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON
from sqlalchemy.dialects.mysql import LONGTEXT

from .extensions import db
from . import taxonomy


def _uuid() -> str:
    return uuid.uuid4().hex


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    phone = db.Column(db.String(32), unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(255), nullable=True)  # 手机号注册时设置的登录密码（只存哈希）；Apple / 微信 / 验证码注册的为空
    apple_sub = db.Column(db.String(128), unique=True, nullable=True, index=True)
    wx_openid = db.Column(db.String(64), unique=True, nullable=True, index=True)  # 微信小程序登录
    apple_name = db.Column(db.String(64), nullable=True)  # Apple 首次授权时给的姓名（之后 Apple 不再给），管理后台显示
    apple_email = db.Column(db.String(128), nullable=True)  # Apple identityToken 里的邮箱（可能是隐藏邮箱），管理后台显示
    nickname = db.Column(db.String(32), default="小同学")
    grade = db.Column(db.String(4), default="")  # "1"–"12"；空 = 用户没设过（注册时不选年级），按卷面年级或模型判断
    subjects = db.Column(JSON, default=lambda: ["math", "chinese", "english", "science"])
    weekly_goal = db.Column(db.Integer, default=5)
    reminder_enabled = db.Column(db.Boolean, default=False)
    reminder_hour = db.Column(db.Integer, default=19)
    reminder_minute = db.Column(db.Integer, default=30)
    created_at = db.Column(db.DateTime, default=datetime.now)
    last_active_at = db.Column(db.DateTime, nullable=True, index=True)  # 最近一次打开 / 使用，管理后台看活跃度
    last_platform = db.Column(db.String(12), nullable=True)  # ios | android | wechat | web

    mistakes = db.relationship("Mistake", backref="user", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "phone": self.phone,
            "hasPassword": bool(self.password_hash),
            "loginMethod": "apple" if self.apple_sub else ("wechat" if self.wx_openid else ("phone" if self.phone else "guest")),
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
    topic_id = db.Column(db.String(24), nullable=True, index=True)  # 知识图谱知识点 id（app/taxonomy.py），没标上为空
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
            "topic": taxonomy.view(self.topic_id) if self.topic_id else None,
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


class DigitizeJob(db.Model):
    """试卷数字化任务：客户端提交后立刻拿到任务号，识别在服务器后台跑，切 App / 杀 App 都不影响；结果保留一天。"""

    __tablename__ = "digitize_jobs"
    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    status = db.Column(db.String(16), default="queued", index=True)  # queued | running | done | failed
    total_pages = db.Column(db.Integer, default=0)
    done_pages = db.Column(db.Integer, default=0)
    result = db.Column(JSON, nullable=True)  # {pages, questions, provider}
    error = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.now, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        total = max(1, self.total_pages or 1)
        progress = 100 if self.status == "done" else 0 if self.status == "failed" else min(95, int(5 + 90 * (self.done_pages or 0) / total))
        return {
            "jobId": self.id,
            "status": self.status,
            "progress": progress,
            "totalPages": self.total_pages,
            "donePages": self.done_pages,
            "error": self.error or "",
            "result": self.result if self.status == "done" else None,
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class ExportJob(db.Model):
    """导出任务（错题本 / 电子试卷 PDF）：提交后在服务器后台排版，App 关掉也照样生成；生成好的文件在「我的导出」里可以再下载，保留 7 天。"""

    __tablename__ = "export_jobs"
    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    kind = db.Column(db.String(8), default="book")  # book | paper | clean（原题空白卷，文字版）| blank（照片版空白卷）
    title = db.Column(db.String(120), default="")
    detail = db.Column(db.String(160), default="")  # 「141 题 · 错题 + 未作答」，列表里显示
    status = db.Column(db.String(16), default="queued", index=True)  # queued | running | done | failed
    error = db.Column(db.Text, default="")
    pages = db.Column(db.Integer, default=0)
    size = db.Column(db.Integer, default=0)  # 文件字节数
    created_at = db.Column(db.DateTime, default=datetime.now, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "detail": self.detail or "",
            "status": self.status,
            "error": self.error or "",
            "pages": self.pages or 0,
            "size": self.size or 0,
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class EraseJob(db.Model):
    """擦除手写任务：一份试卷的照片一起提交，服务器后台逐张擦，App 切走、杀掉都不影响；
    擦好的照片放在 UPLOAD_DIR/erase/<任务号>/<序号>.jpg，客户端取回存到手机上，服务器保留一天。"""

    __tablename__ = "erase_jobs"
    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    status = db.Column(db.String(16), default="queued", index=True)  # queued | running | done | failed
    total_pages = db.Column(db.Integer, default=0)
    done_pages = db.Column(db.Integer, default=0)
    pages_state = db.Column(JSON, nullable=True)  # 每张照片：{"status": "pending" | "done" | "failed", "warning": ""}
    error = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.now, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        pages = self.pages_state or []
        warnings = sorted({p.get("warning") for p in pages if p.get("warning")})
        return {
            "id": self.id,
            "status": self.status,
            "totalPages": self.total_pages or 0,
            "donePages": self.done_pages or 0,
            "pages": [{"index": i, "status": p.get("status") or "pending"} for i, p in enumerate(pages)],
            "warning": warnings[0] if warnings else "",
            "error": self.error or "",
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class UsageEvent(db.Model):
    """使用记录：打开、注册、登录、扫描、导出等，只给管理后台统计用，不存试卷内容。"""

    __tablename__ = "usage_events"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    kind = db.Column(db.String(16), index=True, nullable=False)  # open | signup | login | scan | scan_done | scan_fail | grade | pdf | book
    platform = db.Column(db.String(12), nullable=True)
    method = db.Column(db.String(12), nullable=True)  # 注册 / 登录方式：phone | password | apple | wechat | guest
    pages = db.Column(db.Integer, default=0)  # 扫描的照片数
    questions = db.Column(db.Integer, default=0)  # 还原出的题数
    wrong = db.Column(db.Integer, default=0)  # 其中错题 / 未作答数
    created_at = db.Column(db.DateTime, default=datetime.now, index=True)


# ---------------------------------------------------------------------------
# 云同步：文件夹 → 试卷 → 照片。id 用客户端生成的 id；时间字段原样保存客户端的 ISO 字符串（UTC），
# 用来排序和判断两台设备谁改得晚；rev 是服务器给的版本号（同一账号内递增、不重复），客户端按它增量拉取。
# deleted 是删除标记，保留一段时间让别的设备知道删了，之后由 scripts/sync_purge.py 清掉。


class SyncState(db.Model):
    """每个账号的同步版本号：每写一条同步记录 +1。单独一张表，不改 users 表（老代码、没跑 DDL 的库不受影响）"""

    __tablename__ = "sync_state"
    user_id = db.Column(db.String(32), primary_key=True)
    rev = db.Column(db.BigInteger, default=0, nullable=False)


class SyncFolder(db.Model):
    __tablename__ = "sync_folders"
    __table_args__ = (db.Index("ix_sync_folders_user_rev", "user_id", "rev"),)

    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    name = db.Column(db.String(120), default="")
    subject = db.Column(db.String(16), nullable=True)
    sort_order = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.String(32), default="")
    updated_at = db.Column(db.String(32), default="")
    rev = db.Column(db.BigInteger, default=0, nullable=False)
    deleted = db.Column(db.Boolean, default=False, nullable=False)
    server_updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now, index=True)

    def to_dict(self) -> dict:
        data = {"id": self.id, "rev": self.rev, "updatedAt": self.updated_at}
        if self.deleted:
            return {**data, "deleted": True}
        data.update({"name": self.name, "createdAt": self.created_at})
        if self.subject:
            data["subject"] = self.subject
        if self.sort_order is not None:
            data["order"] = self.sort_order
        return data


class SyncPaper(db.Model):
    __tablename__ = "sync_papers"
    __table_args__ = (db.Index("ix_sync_papers_user_rev", "user_id", "rev"),)

    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    folder_id = db.Column(db.String(32), index=True, nullable=False)
    name = db.Column(db.String(120), default="")
    subject = db.Column(db.String(16), nullable=True)
    subject_manual = db.Column(db.Boolean, default=False)
    position = db.Column(db.Integer, default=0)  # 在文件夹里的顺序
    meta = db.Column(JSON, default=dict)  # scannedAt / gradedAt / taggedAt / printedAt / duplicateOf / notDuplicateOf / keepDuplicate
    digitized = db.Column(db.Text().with_variant(LONGTEXT(), "mysql"), nullable=True)  # 电子版 JSON 原文
    digitized_hash = db.Column(db.String(16), nullable=True)
    created_at = db.Column(db.String(32), default="")
    updated_at = db.Column(db.String(32), default="")
    rev = db.Column(db.BigInteger, default=0, nullable=False)
    deleted = db.Column(db.Boolean, default=False, nullable=False)
    server_updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now, index=True)

    def to_dict(self, with_digitized: bool = True) -> dict:
        import json

        data = {"id": self.id, "folderId": self.folder_id, "rev": self.rev, "updatedAt": self.updated_at}
        if self.deleted:
            return {**data, "deleted": True}
        data.update({"name": self.name, "createdAt": self.created_at, "position": self.position or 0, "digitizedHash": self.digitized_hash})
        if self.subject:
            data["subject"] = self.subject
        if self.subject_manual:
            data["subjectManual"] = True
        data.update(self.meta or {})
        if with_digitized:
            data["digitized"] = json.loads(self.digitized) if self.digitized else None
        return data


class SyncPage(db.Model):
    __tablename__ = "sync_pages"
    __table_args__ = (db.Index("ix_sync_pages_user_rev", "user_id", "rev"),)

    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.String(32), index=True, nullable=False)
    owner_id = db.Column(db.String(32), nullable=False)  # 文件在对象存储里所在的用户目录（合并账号后可能和 user_id 不同）
    paper_id = db.Column(db.String(32), index=True, nullable=False)
    position = db.Column(db.Integer, default=0)
    width = db.Column(db.Integer, default=0)
    height = db.Column(db.Integer, default=0)
    sha = db.Column(db.String(32), nullable=True)
    dhash = db.Column(db.String(32), nullable=True)
    erased_at = db.Column(db.String(32), nullable=True)  # 擦过手写的时间；空 = 没擦
    has_original = db.Column(db.Boolean, default=False)
    has_erased = db.Column(db.String(32), nullable=True)  # 已上传的擦除版对应的 erased_at；和 erased_at 相同才是最新的
    has_thumb = db.Column(db.Boolean, default=False)
    bytes = db.Column(db.BigInteger, default=0)
    created_at = db.Column(db.String(32), default="")
    updated_at = db.Column(db.String(32), default="")
    rev = db.Column(db.BigInteger, default=0, nullable=False)
    deleted = db.Column(db.Boolean, default=False, nullable=False)
    server_updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now, index=True)

    def to_dict(self) -> dict:
        data = {"id": self.id, "paperId": self.paper_id, "rev": self.rev, "updatedAt": self.updated_at}
        if self.deleted:
            return {**data, "deleted": True}
        data.update(
            {
                "position": self.position or 0,
                "width": self.width or 0,
                "height": self.height or 0,
                "createdAt": self.created_at,
                "files": {
                    "original": bool(self.has_original),
                    "erased": bool(self.erased_at and self.has_erased == self.erased_at),
                    "thumb": bool(self.has_thumb),
                },
            }
        )
        for key, value in (("sha", self.sha), ("dhash", self.dhash), ("erased", self.erased_at)):
            if value:
                data[key] = value
        return data
