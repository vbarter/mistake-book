"""云同步：同一个账号在不同手机、电脑上看到同样的文件夹、试卷和错题。

客户端仍然本机优先（离线照常用），后台「先推后拉」：
- POST /sync/push      把本机改过的文件夹 / 试卷 / 照片记录推上来（带 baseRev = 上次从服务器拿到的版本号）
- GET  /sync/changes   拉 since 之后别的设备改过的记录（含删除标记），按版本号分页
- POST /sync/upload-urls / /sync/uploaded / /sync/download-urls   照片文件：服务器签临时链接，客户端直传直下对象存储
- PUT/GET /sync/blob/<签名>   本地存储（STORAGE_PROVIDER=local）时代替对象存储收发文件
- DELETE /sync/data    删掉这个账号在云端的全部试卷数据（关闭云同步时用）

冲突：baseRev 和服务器当前版本一致就直接接受；不一致说明另一台设备先改了，比较 updatedAt，新的赢，
输的一方在 rejected 里拿到服务器上的当前版本覆盖本机。删除也是一次修改：删除之后又在别处改过（updatedAt 更晚）就恢复。
错题不单独同步：错题榜、汇总都由试卷的电子版现算。设计见项目文件 reports/云端同步与COS存储-方案评估.md。
"""
from __future__ import annotations

import hashlib
import json
import logging
from functools import wraps

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from ..auth_utils import current_user, login_required
from ..constants import SUBJECTS
from ..extensions import db
from ..models import SyncFolder, SyncPage, SyncPaper, SyncState
from .. import storage

bp = Blueprint("sync", __name__)
log = logging.getLogger(__name__)

MAX_ITEMS_PER_PUSH = 500
MAX_DIGITIZED_BYTES = 8 * 1024 * 1024
CHANGES_LIMIT = 100
CHANGES_BYTE_BUDGET = 4 * 1024 * 1024  # 一页变更里电子版累计超过这个就先返回，客户端接着拉
MAX_FILES_PER_CALL = 50
PAPER_META_KEYS = ("scannedAt", "gradedAt", "taggedAt", "printedAt", "duplicateOf", "notDuplicateOf", "keepDuplicate")


def sync_enabled(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_app.config.get("SYNC_ENABLED", True):
            abort(503, "云同步暂时关闭，试卷先保存在这台设备上")
        return fn(*args, **kwargs)

    return wrapper


# --------------------------------------------------------------------------- 工具


def _str(value, limit: int) -> str:
    return str(value if value is not None else "")[:limit]


def _ts(value) -> str:
    """客户端时间（ISO 字符串）。只做长度和类型检查，原样存回去，客户端拿到的和它发的完全一样"""
    return value[:32] if isinstance(value, str) else ""


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _id(value) -> str | None:
    text = str(value or "").strip()
    return text if 0 < len(text) <= 32 and text.replace("-", "").replace("_", "").isalnum() else None


class Counter:
    """一个账号的版本号计数器（sync_state 一行）。锁住这一行，同一账号的写入排队，两台设备同时推时版本号不重复"""

    def __init__(self, user_id: str, lock: bool = True):
        self.id = user_id
        q = db.session.query(SyncState).filter_by(user_id=user_id)
        state = (q.with_for_update() if lock else q).one_or_none()
        if state is None:
            state = SyncState(user_id=user_id, rev=0)
            db.session.add(state)
            db.session.flush()
        self.state = state

    @property
    def rev(self) -> int:
        return self.state.rev or 0

    def next(self) -> int:
        self.state.rev = self.rev + 1
        return self.state.rev


def _next_rev(counter: "Counter") -> int:
    return counter.next()


def _locked_user() -> "Counter":
    return Counter(current_user().id)


def current_rev(user_id: str) -> int:
    state = db.session.get(SyncState, user_id)
    return state.rev if state else 0


def _wins(item: dict, row) -> bool:
    """这条推送能不能覆盖服务器上的记录"""
    base = item.get("baseRev")
    if base is not None and _int(base, -1) == row.rev:
        return True
    return _ts(item.get("updatedAt")) > (row.updated_at or "")


# --------------------------------------------------------------------------- 写入


def _apply_folder(row: SyncFolder, item: dict) -> None:
    row.name = _str(item.get("name"), 120)
    subject = item.get("subject")
    row.subject = subject if subject in SUBJECTS else None
    order = item.get("order")
    row.sort_order = _int(order) if order is not None else None
    row.created_at = _ts(item.get("createdAt")) or row.created_at or ""


def _apply_paper(row: SyncPaper, item: dict) -> None:
    """写试卷字段；没带 digitized 键表示电子版没变，带 null 表示清掉"""
    if "digitized" in item:
        dig = item.get("digitized")
        if dig is None:
            row.digitized, row.digitized_hash = None, None
        else:
            text = json.dumps(dig, ensure_ascii=False, separators=(",", ":"))
            row.digitized = text
            row.digitized_hash = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    row.name = _str(item.get("name"), 120)
    subject = item.get("subject")
    row.subject = subject if subject in SUBJECTS else None
    row.subject_manual = bool(item.get("subjectManual"))
    row.position = _int(item.get("position"))
    row.meta = {k: item[k] for k in PAPER_META_KEYS if item.get(k) is not None}
    row.created_at = _ts(item.get("createdAt")) or row.created_at or ""


def _apply_page(row: SyncPage, item: dict) -> None:
    row.position = _int(item.get("position"))
    row.width = _int(item.get("width"))
    row.height = _int(item.get("height"))
    row.sha = _str(item.get("sha"), 32) or None
    row.dhash = _str(item.get("dhash"), 32) or None
    row.erased_at = _ts(item.get("erased")) or None
    row.created_at = _ts(item.get("createdAt")) or row.created_at or ""


def _tombstone(row, user: Counter, updated_at: str) -> None:
    row.deleted = True
    row.updated_at = updated_at or row.updated_at
    row.rev = _next_rev(user)


def _cascade_delete(user: Counter, *, folder_id: str | None = None, paper_id: str | None = None, updated_at: str = "") -> None:
    """删文件夹 → 删里面的试卷和照片；删试卷 → 删它的照片"""
    paper_ids = [paper_id] if paper_id else []
    if folder_id:
        for paper in SyncPaper.query.filter_by(user_id=user.id, folder_id=folder_id, deleted=False).all():
            _tombstone(paper, user, updated_at)
            paper_ids.append(paper.id)
    if paper_ids:
        for page in SyncPage.query.filter(SyncPage.user_id == user.id, SyncPage.paper_id.in_(paper_ids), SyncPage.deleted.is_(False)).all():
            _tombstone(page, user, updated_at)


def _revive(row, user: Counter, child_updated: str) -> bool:
    """子记录要放进一个已删除的父记录：子记录改得比删除晚就把父记录恢复，否则不能放"""
    if not row.deleted:
        return True
    if child_updated <= (row.updated_at or ""):
        return False
    row.deleted = False
    row.updated_at = child_updated
    row.rev = _next_rev(user)
    if isinstance(row, SyncPaper):
        folder = db.session.get(SyncFolder, row.folder_id)
        if folder is None or folder.user_id != user.id or not _revive(folder, user, child_updated):
            return False
    return True


def _push_one(model, user: Counter, item: dict, parent: tuple | None, apply) -> tuple[str, dict]:
    """处理一条推送记录，返回 ("applied" | "rejected", 回给客户端的内容)"""
    rid = _id(item.get("id")) if isinstance(item, dict) else None
    if rid is None:
        return "rejected", {"id": str(item.get("id") if isinstance(item, dict) else ""), "reason": "invalid", "current": None}
    updated = _ts(item.get("updatedAt"))
    deleted = bool(item.get("deleted"))
    row = db.session.get(model, rid)
    if row is not None and row.user_id != user.id:
        return "rejected", {"id": rid, "reason": "invalid", "current": None}
    if row is not None and not _wins(item, row):
        return "rejected", {"id": rid, "reason": "conflict", "current": row.to_dict()}
    if deleted:
        if row is None:
            return "applied", {"id": rid, "rev": None}
        if not row.deleted:
            _tombstone(row, user, updated)
            if model is SyncFolder:
                _cascade_delete(user, folder_id=rid, updated_at=updated)
            elif model is SyncPaper:
                _cascade_delete(user, paper_id=rid, updated_at=updated)
        return "applied", {"id": rid, "rev": row.rev}
    if parent is not None:
        parent_model, parent_key = parent
        parent_id = _id(item.get(parent_key))
        prow = db.session.get(parent_model, parent_id) if parent_id else None
        if prow is None or prow.user_id != user.id:
            return "rejected", {"id": rid, "reason": "missing_parent", "current": row.to_dict() if row else None}
        if not _revive(prow, user, updated):
            return "rejected", {"id": rid, "reason": "parent_deleted", "current": row.to_dict() if row else None}
    if model is SyncPaper and item.get("digitized") is not None:
        if len(json.dumps(item["digitized"], ensure_ascii=False).encode("utf-8")) > MAX_DIGITIZED_BYTES:
            return "rejected", {"id": rid, "reason": "invalid", "message": "电子版太大", "current": row.to_dict() if row else None}
    if row is None:
        row = model(id=rid, user_id=user.id)
        if model is SyncPage:
            row.owner_id = user.id
        db.session.add(row)
    if model is SyncPaper:
        row.folder_id = _id(item.get("folderId"))
    elif model is SyncPage:
        row.paper_id = _id(item.get("paperId"))
    apply(row, item)
    row.deleted = False
    row.updated_at = updated or row.updated_at or ""
    row.rev = _next_rev(user)
    return "applied", {"id": rid, "rev": row.rev}


@bp.post("/sync/push")
@sync_enabled
@login_required
def push():
    data = request.get_json(silent=True) or {}
    groups = {k: data.get(k) or [] for k in ("folders", "papers", "pages")}
    if not all(isinstance(v, list) for v in groups.values()):
        abort(400, "格式不对")
    if sum(len(v) for v in groups.values()) > MAX_ITEMS_PER_PUSH:
        abort(400, f"一次最多推 {MAX_ITEMS_PER_PUSH} 条")
    user = _locked_user()
    applied: dict[str, list] = {k: [] for k in groups}
    rejected: dict[str, list] = {k: [] for k in groups}
    plan = (
        ("folders", SyncFolder, None, _apply_folder),
        ("papers", SyncPaper, (SyncFolder, "folderId"), _apply_paper),
        ("pages", SyncPage, (SyncPaper, "paperId"), _apply_page),
    )
    for key, model, parent, apply in plan:  # 先文件夹再试卷再照片：同一次推送里新建的父记录子记录能找到
        for item in groups[key]:
            outcome, body = _push_one(model, user, item if isinstance(item, dict) else {}, parent, apply)
            (applied if outcome == "applied" else rejected)[key].append(body)
            db.session.flush()
    db.session.commit()
    return jsonify({"applied": applied, "rejected": rejected, "rev": user.rev})


# --------------------------------------------------------------------------- 拉取


@bp.get("/sync/changes")
@sync_enabled
@login_required
def changes():
    """since 之后的变更，按版本号从小到大；more = true 时用返回的 rev 接着拉。since=0 是新设备第一次全量拉，不带删除标记"""
    user = current_user()
    since = max(0, _int(request.args.get("since")))
    limit = min(max(1, _int(request.args.get("limit"), CHANGES_LIMIT)), 500)
    rows: list = []
    for model in (SyncFolder, SyncPaper, SyncPage):
        q = model.query.filter(model.user_id == user.id, model.rev > since)
        if since == 0:
            q = q.filter(model.deleted.is_(False))
        rows.extend(q.order_by(model.rev).limit(limit + 1).all())
    rows.sort(key=lambda r: r.rev)
    more = len(rows) > limit
    rows = rows[:limit]
    budget = CHANGES_BYTE_BUDGET
    out: dict[str, list] = {"folders": [], "papers": [], "pages": []}
    cursor = since
    for i, row in enumerate(rows):
        if isinstance(row, SyncPaper) and row.digitized and not row.deleted:
            size = len(row.digitized)
            if size > budget and i > 0:
                more = True
                break
            budget -= size
        key = "folders" if isinstance(row, SyncFolder) else "papers" if isinstance(row, SyncPaper) else "pages"
        out[key].append(row.to_dict())
        cursor = row.rev
    else:
        if not more:
            cursor = max(cursor, current_rev(user.id))
    return jsonify({**out, "rev": cursor, "more": more})


# --------------------------------------------------------------------------- 照片文件


def _file_requests(data: dict) -> list[tuple[SyncPage, str, dict]]:
    files = data.get("files") or []
    if not isinstance(files, list) or len(files) > MAX_FILES_PER_CALL:
        abort(400, f"一次最多 {MAX_FILES_PER_CALL} 个文件")
    user = current_user()
    out = []
    for f in files:
        if not isinstance(f, dict) or f.get("kind") not in storage.KINDS:
            abort(400, "文件类型不对")
        page = db.session.get(SyncPage, _id(f.get("pageId")) or "")
        if page is None or page.user_id != user.id or page.deleted:
            out.append((None, f["kind"], f))
            continue
        out.append((page, f["kind"], f))
    return out


@bp.post("/sync/upload-urls")
@sync_enabled
@login_required
def upload_urls():
    """要上传照片的签名链接（PUT，有效期 SYNC_URL_EXPIRES 秒）。照片记录要先推上来"""
    store = storage.get_storage()
    urls, missing = [], []
    for page, kind, f in _file_requests(request.get_json(silent=True) or {}):
        if page is None or (kind == "erased" and not page.erased_at):
            missing.append({"pageId": f.get("pageId"), "kind": kind})
            continue
        key = storage.object_key(page.owner_id, page.id, kind)
        urls.append({"pageId": page.id, "kind": kind, "method": "PUT", "url": store.presign(key, "PUT"), "headers": {"Content-Type": "image/jpeg"}})
    return jsonify({"urls": urls, "missing": missing, "expiresIn": current_app.config.get("SYNC_URL_EXPIRES", 900)})


@bp.post("/sync/uploaded")
@sync_enabled
@login_required
def uploaded():
    """传完照片后确认：服务器查一下文件确实在，记下来并升版本号，别的设备就知道可以下载了"""
    user = _locked_user()
    store = storage.get_storage()
    done, missing = [], []
    for page, kind, f in _file_requests(request.get_json(silent=True) or {}):
        size = store.exists(storage.object_key(page.owner_id, page.id, kind)) if page is not None else None
        if page is None or size is None:
            missing.append({"pageId": f.get("pageId"), "kind": kind})
            continue
        if kind == "original":
            page.has_original, page.bytes = True, size
        elif kind == "thumb":
            page.has_thumb = True
        else:
            erased = _ts(f.get("erased"))
            if not page.erased_at or (erased and erased != page.erased_at):
                missing.append({"pageId": page.id, "kind": kind, "reason": "stale"})  # 传的是旧的擦除版，服务器上已经有更新的
                continue
            page.has_erased = page.erased_at
        page.rev = _next_rev(user)
        done.append({"pageId": page.id, "kind": kind, "rev": page.rev})
    db.session.commit()
    return jsonify({"done": done, "missing": missing, "rev": user.rev})


@bp.post("/sync/download-urls")
@sync_enabled
@login_required
def download_urls():
    """下载照片的签名链接（GET）。文件还没传上来的放在 missing 里"""
    store = storage.get_storage()
    urls, missing = [], []
    for page, kind, f in _file_requests(request.get_json(silent=True) or {}):
        ready = page is not None and (
            page.has_original if kind == "original" else page.has_thumb if kind == "thumb" else bool(page.erased_at and page.has_erased == page.erased_at)
        )
        if not ready:
            missing.append({"pageId": f.get("pageId"), "kind": kind})
            continue
        urls.append({"pageId": page.id, "kind": kind, "url": store.presign(storage.object_key(page.owner_id, page.id, kind), "GET")})
    return jsonify({"urls": urls, "missing": missing, "expiresIn": current_app.config.get("SYNC_URL_EXPIRES", 900)})


def _local_store() -> storage.LocalStorage:
    store = storage.get_storage()
    if not isinstance(store, storage.LocalStorage):
        abort(404)
    return store


@bp.put("/sync/blob/<token>")
def blob_put(token: str):
    """本地存储模式下的上传地址（签名就是凭证，和对象存储的签名链接一样不带登录头）"""
    store = _local_store()
    key = store.resolve_token(token, "PUT")
    if key is None:
        abort(403, "链接无效或已过期")
    if (request.content_length or 0) > storage.MAX_BLOB_BYTES:
        abort(413, "照片太大")
    data = request.get_data(cache=False)
    if not data or len(data) > storage.MAX_BLOB_BYTES:
        abort(400 if not data else 413, "照片是空的" if not data else "照片太大")
    store.write(key, data)
    return "", 200


@bp.get("/sync/blob/<token>")
def blob_get(token: str):
    store = _local_store()
    key = store.resolve_token(token, "GET")
    path = store.file_path(key) if key else None
    if path is None:
        abort(404 if key else 403)
    return send_file(path, mimetype="image/jpeg", max_age=3600)


# --------------------------------------------------------------------------- 删除 / 合并账号


def delete_user_sync(user_id: str, drop_counter: bool = False) -> None:
    """删掉一个账号在云端的全部试卷数据：记录和对象存储里的文件（注销账号、关闭云同步时用）"""
    other_owners = [r.owner_id for r in db.session.query(SyncPage.owner_id).filter(SyncPage.user_id == user_id, SyncPage.owner_id != user_id).distinct()]
    store = None
    try:
        store = storage.get_storage()
        keys = [
            storage.object_key(p.owner_id, p.id, kind)
            for p in SyncPage.query.filter(SyncPage.user_id == user_id, SyncPage.owner_id.in_(other_owners)).all()
            for kind in storage.KINDS
        ] if other_owners else []
        store.delete(keys)
        store.delete_prefix(storage.user_prefix(user_id))
    except Exception:  # noqa: BLE001  文件删不掉不影响删记录；对象存储那边可以按目录补删
        log.exception("delete sync files failed for %s (store=%s)", user_id, getattr(store, "name", None))
    for model in (SyncPage, SyncPaper, SyncFolder):
        model.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    if drop_counter:
        db.session.query(SyncState).filter_by(user_id=user_id).delete(synchronize_session=False)


def merge_user_sync(source_id: str, target_id: str) -> int:
    """合并账号：把 source 的文件夹、试卷、照片搬到 target 名下，按 target 的版本号重新编号，
    target 的其他设备下次同步就能拉到。照片文件不搬（还在 source 的目录里，owner_id 记着）。返回搬了多少条。"""
    target = Counter(target_id)
    moved = 0
    for model in (SyncFolder, SyncPaper, SyncPage):
        for row in model.query.filter_by(user_id=source_id).order_by(model.rev).all():
            row.user_id = target_id
            row.rev = target.next()
            moved += 1
    db.session.query(SyncState).filter_by(user_id=source_id).delete(synchronize_session=False)
    return moved


@bp.delete("/sync/data")
@sync_enabled
@login_required
def delete_data():
    """关闭云同步并删除云端试卷数据；本机的不动"""
    user = _locked_user()
    delete_user_sync(user.id)
    user.next()  # 版本号不回退：别的设备的游标不会因为删了数据而失效
    db.session.commit()
    return jsonify({"ok": True, "rev": user.rev})


@bp.get("/sync/status")
@login_required
def status():
    """这个账号云端存了多少：文件夹、试卷、照片数和照片占用；以及同步开没开、用的哪种存储"""
    user = current_user()
    q = lambda m: m.query.filter_by(user_id=user.id, deleted=False)  # noqa: E731
    total_bytes = db.session.query(db.func.coalesce(db.func.sum(SyncPage.bytes), 0)).filter_by(user_id=user.id, deleted=False).scalar()
    return jsonify(
        {
            "enabled": bool(current_app.config.get("SYNC_ENABLED", True)),
            "storage": storage.provider_name(current_app.config),
            "rev": current_rev(user.id),
            "folders": q(SyncFolder).count(),
            "papers": q(SyncPaper).count(),
            "pages": q(SyncPage).count(),
            "photoBytes": int(total_bytes or 0),
        }
    )
