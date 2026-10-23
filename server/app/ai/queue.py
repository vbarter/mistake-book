"""全局识别队列：整个进程里最多 MAX_CONCURRENT_PAGES 张图片同时调用大模型，多出来的排队等。

所有数字化任务的每一张照片都从这里拿槽位（不区分来自哪个任务、哪个用户），先到先得。
gunicorn 要跑单 worker（多线程），这个上限才是真正全局的；多 worker 时每个进程各有一份。
"""
from __future__ import annotations

import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, TypeVar

T = TypeVar("T")

MAX_CONCURRENT_PAGES = max(1, int(os.getenv("MAX_CONCURRENT_PAGES", "5")))

_pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_PAGES, thread_name_prefix="digitize-page")
_lock = threading.Lock()
_waiting = 0  # 已提交、还没拿到槽位
_running = 0  # 正在调模型


def submit(fn: Callable[[], T], on_start: Callable[[], None] | None = None) -> Future[T]:
    """提交一张图片的识别；排队时计入 waiting，拿到槽位后计入 running 并回调 on_start。"""
    global _waiting
    with _lock:
        _waiting += 1

    def run() -> T:
        global _waiting, _running
        with _lock:
            _waiting -= 1
            _running += 1
        try:
            if on_start:
                try:
                    on_start()
                except Exception:  # noqa: BLE001  回调出错不影响识别
                    pass
            return fn()
        finally:
            with _lock:
                _running -= 1

    return _pool.submit(run)


def stats() -> dict:
    with _lock:
        return {"limit": MAX_CONCURRENT_PAGES, "running": _running, "waiting": _waiting}
