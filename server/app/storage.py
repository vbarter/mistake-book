"""云同步的文件存储：试卷原图、擦过手写的照片、缩略图。

两种实现，`.env` 里 STORAGE_PROVIDER 切换（留空自动：COS 配置齐了用 cos，否则 local）：
- cos：腾讯云对象存储。客户端拿服务器签的临时链接直接 PUT / GET，照片流量不经过服务器；
  密钥只在服务器 .env 里（COS_SECRET_ID / COS_SECRET_KEY，建议用只授权这一个桶的子账号）。
- local：存在服务器磁盘 UPLOAD_DIR/sync/ 下，链接指向本服务的 /api/sync/blob/<签名>（相对路径，客户端拼在 API 地址后面）。
  本地开发、测试用，也可以在没开通 COS 时临时顶上。

对象 key：u/<userId>/p/<pageId>.jpg（原图）、<pageId>~erased.jpg、<pageId>~thumb.jpg。按用户分目录，注销账号时整目录删掉。
"""
from __future__ import annotations

import logging
import os
import shutil
import threading

from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer

log = logging.getLogger(__name__)

KINDS = ("original", "erased", "thumb")
_SUFFIX = {"original": "", "erased": "~erased", "thumb": "~thumb"}
MAX_BLOB_BYTES = 15 * 1024 * 1024  # 单张照片上限（原图最长边 2400，正常 1 MB 以内）


MAX_PLAN_FILE_BYTES = 20 * 1024 * 1024  # 学习计划的附件（PDF / Word / 图片）上限


def max_bytes(key: str) -> int:
    if "/avatar-" in key:
        return 2 * 1024 * 1024  # 头像，和 avatars.MAX_AVATAR_BYTES 一致
    return MAX_PLAN_FILE_BYTES if key.startswith("plans/") else MAX_BLOB_BYTES


def object_key(owner_id: str, page_id: str, kind: str) -> str:
    return f"u/{owner_id}/p/{page_id}{_SUFFIX[kind]}.jpg"


def user_prefix(owner_id: str) -> str:
    return f"u/{owner_id}/"


class LocalStorage:
    name = "local"

    def __init__(self, root: str, secret: str, expires: int):
        self.root = root
        self.expires = expires
        self._signer = URLSafeTimedSerializer(secret, salt="sync-blob")

    def _path(self, key: str) -> str:
        path = os.path.normpath(os.path.join(self.root, key))
        if not path.startswith(os.path.normpath(self.root) + os.sep):
            raise ValueError("bad key")
        return path

    def presign(self, key: str, method: str) -> str:
        return "/api/sync/blob/" + self._signer.dumps({"k": key, "m": method})

    def resolve_token(self, token: str, method: str) -> str | None:
        """校验 /api/sync/blob/<token> 的签名和有效期，返回 key；不对返回 None。"""
        try:
            data = self._signer.loads(token, max_age=self.expires)
        except BadSignature:
            return None
        if not isinstance(data, dict) or data.get("m") != method or not isinstance(data.get("k"), str):
            return None
        return data["k"]

    def write(self, key: str, data: bytes, mime: str = "") -> None:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)

    def copy(self, src: str, dst: str) -> None:
        path = self._path(dst)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        shutil.copyfile(self._path(src), path)

    def file_path(self, key: str) -> str | None:
        path = self._path(key)
        return path if os.path.isfile(path) else None

    def exists(self, key: str) -> int | None:
        """文件在就返回大小，不在返回 None"""
        path = self.file_path(key)
        return os.path.getsize(path) if path else None

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            try:
                os.remove(self._path(key))
            except FileNotFoundError:
                pass

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self._path(prefix.rstrip("/")), ignore_errors=True)

    def health(self) -> str:
        return "local:online"


class CosStorage:
    name = "cos"

    def __init__(self, region: str, bucket: str, secret_id: str, secret_key: str, expires: int):
        from qcloud_cos import CosConfig, CosS3Client  # 只在用 COS 时才需要装 cos-python-sdk-v5

        self.bucket = bucket
        self.region = region
        self.expires = expires
        self.client = CosS3Client(CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Scheme="https"))

    def presign(self, key: str, method: str) -> str:
        return self.client.get_presigned_url(Bucket=self.bucket, Key=key, Method=method, Expired=self.expires)

    def write(self, key: str, data: bytes, mime: str = "application/octet-stream") -> None:
        self.client.put_object(Bucket=self.bucket, Body=data, Key=key, ContentType=mime)

    def copy(self, src: str, dst: str) -> None:
        self.client.copy_object(Bucket=self.bucket, Key=dst, CopySource={"Bucket": self.bucket, "Key": src, "Region": self.region})

    def exists(self, key: str) -> int | None:
        from qcloud_cos.cos_exception import CosServiceError

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return None
            raise
        return int(head.get("Content-Length") or 0)

    def delete(self, keys: list[str]) -> None:
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            if chunk:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Object": [{"Key": k} for k in chunk], "Quiet": "true"})

    def delete_prefix(self, prefix: str) -> None:
        marker = ""
        while True:
            resp = self.client.list_objects(Bucket=self.bucket, Prefix=prefix, Marker=marker, MaxKeys=1000)
            keys = [c["Key"] for c in resp.get("Contents", [])]
            self.delete(keys)
            if resp.get("IsTruncated") != "true":
                return
            marker = resp.get("NextMarker") or (keys[-1] if keys else "")
            if not marker:
                return

    def health(self) -> str:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return "cos:online"
        except Exception as e:  # noqa: BLE001
            log.warning("cos head_bucket failed: %s", e)
            return "cos:offline"


_lock = threading.Lock()


def provider_name(config) -> str:
    want = (config.get("STORAGE_PROVIDER") or "").strip().lower()
    if want in ("local", "cos"):
        return want
    return "cos" if all(config.get(k) for k in ("COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION")) else "local"


def get_storage():
    """当前应用的存储实例（按应用缓存，测试里每个应用一份）"""
    app = current_app._get_current_object()
    store = app.extensions.get("sync_storage")
    if store is not None:
        return store
    with _lock:
        store = app.extensions.get("sync_storage")
        if store is None:
            cfg = app.config
            expires = int(cfg.get("SYNC_URL_EXPIRES") or 900)
            if provider_name(cfg) == "cos":
                missing = [k for k in ("COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION") if not cfg.get(k)]
                if missing:
                    raise RuntimeError("STORAGE_PROVIDER=cos 但缺少配置：" + ", ".join(missing))
                store = CosStorage(cfg["COS_REGION"], cfg["COS_BUCKET"], cfg["COS_SECRET_ID"], cfg["COS_SECRET_KEY"], expires)
            else:
                store = LocalStorage(os.path.join(cfg["UPLOAD_DIR"], "sync"), cfg["SECRET_KEY"], expires)
            app.extensions["sync_storage"] = store
    return store


def health() -> str:
    try:
        return get_storage().health()
    except Exception as e:  # noqa: BLE001
        log.warning("storage init failed: %s", e)
        return f"{provider_name(current_app.config)}:unconfigured"
