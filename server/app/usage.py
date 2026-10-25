"""记录使用情况（给管理后台统计）。记录失败不影响正常请求。"""
from __future__ import annotations

import logging
from datetime import datetime

from flask import has_request_context, request

from .extensions import db
from .models import UsageEvent, User

log = logging.getLogger(__name__)


def platform_of_request() -> str | None:
    """从 User-Agent 判断是哪一端：小程序的 UA 里也有 iPhone / Android，所以先认微信。"""
    if not has_request_context():
        return None
    ua = request.headers.get("User-Agent", "")
    if "miniProgram" in ua or "MicroMessenger" in ua:
        return "wechat"
    if "Android" in ua:
        return "android"
    if "iPhone" in ua or "iPad" in ua or "iOS" in ua:
        return "ios"
    return "web"


def track(user: User | str, kind: str, *, method: str | None = None, pages: int = 0, questions: int = 0, wrong: int = 0) -> None:
    try:
        user_id = user if isinstance(user, str) else user.id
        platform = platform_of_request()
        db.session.add(UsageEvent(user_id=user_id, kind=kind, platform=platform, method=method, pages=pages, questions=questions, wrong=wrong))
        if not isinstance(user, str) and kind not in ("scan_done", "scan_fail"):
            user.last_active_at = datetime.now()
            if platform:
                user.last_platform = platform
        db.session.commit()
    except Exception:  # noqa: BLE001
        log.exception("usage track failed: %s", kind)
        db.session.rollback()
