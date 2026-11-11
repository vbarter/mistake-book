"""用户头像。

头像单独放一张表（user_avatars），不往 users 上加列：线上库加列要手动执行 ALTER，没执行的话整个登录都会挂；
单独一张表即使还没建，也只是大家暂时没有头像——这里所有读操作都容错，表不存在就当没有头像。

图片本身放对象存储，key 在用户自己的目录下（u/<用户>/avatar-<版本>.jpg），注销账号时跟着照片一起删。
每次换头像都换一个版本号，客户端拿到的地址也跟着变，不会被旧图缓存住。
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime

from . import storage
from .extensions import db
from .models import UserAvatar

log = logging.getLogger(__name__)

MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 客户端会先缩到 400 像素左右，正常几十 KB


def avatar_key(user_id: str, version: str) -> str:
    return f"{storage.user_prefix(user_id)}avatar-{version}.jpg"


def new_version() -> str:
    return secrets.token_hex(6)


def avatar_urls(user_ids) -> dict[str, str]:
    """一批用户的头像地址（临时签名链接）；没有头像的不在结果里"""
    ids = [i for i in dict.fromkeys(user_ids) if i]
    if not ids:
        return {}
    try:
        with db.session.begin_nested():  # 用保存点：查失败只撤这一句，不动请求里还没提交的别的改动
            rows = UserAvatar.query.filter(UserAvatar.user_id.in_(ids)).all()
    except Exception as e:  # noqa: BLE001  表还没建：当成都没有头像，不能拖垮别的功能
        log.warning("读头像失败（user_avatars 表建了吗）：%s", e)
        return {}
    if not rows:
        return {}
    store = storage.get_storage()
    return {r.user_id: store.presign(avatar_key(r.user_id, r.version), "GET") for r in rows}


def avatar_url(user_id: str) -> str | None:
    return avatar_urls([user_id]).get(user_id)


def set_avatar(user_id: str, version: str) -> None:
    """确认上传完成：记下新版本，删掉旧图"""
    row = db.session.get(UserAvatar, user_id)
    old = row.version if row else None
    if row is None:
        db.session.add(UserAvatar(user_id=user_id, version=version))
    else:
        row.version, row.updated_at = version, datetime.now()
    db.session.commit()
    if old and old != version:
        try:
            storage.get_storage().delete([avatar_key(user_id, old)])
        except Exception as e:  # noqa: BLE001  旧图删不掉不影响换头像
            log.warning("删旧头像失败：%s", e)


def delete_avatar(user_id: str) -> None:
    """注销账号：删掉记录（图片随用户目录一起删）"""
    try:
        UserAvatar.query.filter_by(user_id=user_id).delete(synchronize_session=False)
        db.session.flush()
    except Exception as e:  # noqa: BLE001
        db.session.rollback()
        log.warning("删头像记录失败：%s", e)
