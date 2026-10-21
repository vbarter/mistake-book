"""间隔复习规则（PRD 画板 31 的简化 SM-2）。

档位间隔：1 → 3 → 7 → 15 → 30 天，保温每 30 天。
记得：档位 +1；连续 2 次记得且档位 ≥ 2 → 已掌握。
模糊：档位不变，下次间隔 × 0.5（最少 1 天）。
忘了：回到档位 0，streak 清零。
练习答错：立即到期；练习答对：等同于一次「记得」。
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

INTERVALS = [1, 3, 7, 15, 30]
MAINTENANCE_DAYS = 30
DUE_HOUR = 4


def due_at(days: float, now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    target = now + timedelta(days=days)
    return target.replace(hour=DUE_HOUR, minute=0, second=0, microsecond=0)


def effective_state(m, now: datetime) -> str:
    if m.mastered:
        return "mastered"
    if m.next_due_at is None or m.next_due_at <= now:
        return "due"
    return "learning"


def schedule_new(m, now: datetime | None = None) -> None:
    """新错题：今天就要复习一次（到期时间设为现在），之后进入 1 天档。"""
    now = now or datetime.now()
    m.interval_index = 0
    m.streak = 0
    m.mastered = False
    m.manual_mastered = False
    m.mastered_at = None
    m.next_due_at = now


def apply_rating(m, result: str, now: datetime | None = None) -> dict:
    """复习自评。返回 {"from": state, "to": state, "nextDueAt": dt}。"""
    now = now or datetime.now()
    before = effective_state(m, now)

    if result == "remembered":
        m.streak = (m.streak or 0) + 1
        m.interval_index = min((m.interval_index or 0) + 1, len(INTERVALS) - 1)
        if m.streak >= 2 and m.interval_index >= 2:
            m.mastered = True
            m.manual_mastered = False
            m.mastered_at = now
            m.next_due_at = due_at(MAINTENANCE_DAYS, now)
        else:
            m.next_due_at = due_at(INTERVALS[m.interval_index], now)
    elif result == "fuzzy":
        m.streak = 0
        days = max(1, INTERVALS[m.interval_index or 0] * 0.5)
        m.next_due_at = due_at(days, now)
    elif result == "forgot":
        m.streak = 0
        m.interval_index = 0
        m.mastered = False
        m.manual_mastered = False
        m.mastered_at = None
        m.next_due_at = due_at(INTERVALS[0], now)
    else:
        raise ValueError(f"unknown rating: {result}")

    return {"from": before, "to": effective_state(m, now), "nextDueAt": m.next_due_at}


def apply_practice(m, correct: bool, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    if correct:
        return apply_rating(m, "remembered", now)
    before = effective_state(m, now)
    m.streak = 0
    m.interval_index = 0
    m.mastered = False
    m.manual_mastered = False
    m.mastered_at = None
    m.next_due_at = now
    return {"from": before, "to": effective_state(m, now), "nextDueAt": now}


def mark_mastered(m, now: datetime | None = None) -> None:
    now = now or datetime.now()
    m.mastered = True
    m.manual_mastered = True
    m.mastered_at = now
    m.next_due_at = due_at(MAINTENANCE_DAYS, now)


def reinstate(m, now: datetime | None = None) -> None:
    now = now or datetime.now()
    m.mastered = False
    m.manual_mastered = False
    m.mastered_at = None
    m.streak = 0
    m.interval_index = min(m.interval_index or 0, 1)
    m.next_due_at = now


def build_queue(mistakes, now: datetime, limit: int) -> list:
    """今日队列：到期最久 → 错次最多 → 学科轮换，上限 limit。"""
    due = [m for m in mistakes if effective_state(m, now) == "due"]
    due.sort(key=lambda m: (m.next_due_at or now, -(m.wrong_count or 1), m.created_at or now))

    buckets: dict[str, list] = defaultdict(list)
    order: list[str] = []
    for m in due:
        if m.subject not in buckets:
            order.append(m.subject)
        buckets[m.subject].append(m)

    queue: list = []
    while len(queue) < limit and any(buckets.values()):
        for subject in order:
            if buckets[subject]:
                queue.append(buckets[subject].pop(0))
                if len(queue) >= limit:
                    break
    return queue
