"""智能聊天「问小壹」：给 App 发一张访问试卷知识库的短期票。

POST /api/kb/token → {token, expiresIn, base}

知识库（另一个服务，eduction_rag）自己没有账号体系，只认带 sub / exp 的 JWT。这里用**单独的密钥** KB_JWT_SECRET
签一张短期票（默认 1 小时），App 拿它直接调知识库的上传、检索、问答接口；主站的登录密钥不出这台服务器。
没配 KB_JWT_SECRET 或 KB_PUBLIC_URL 时返回 503，App 就不显示对话入口。
"""
from __future__ import annotations

import time

import jwt
from flask import Blueprint, current_app, jsonify

from ..auth_utils import current_user, login_required

bp = Blueprint("kb", __name__)


@bp.post("/kb/token")
@login_required
def kb_token():
    cfg = current_app.config
    secret, base = cfg.get("KB_JWT_SECRET") or "", (cfg.get("KB_PUBLIC_URL") or "").rstrip("/")
    if not secret or not base:
        return jsonify({"error": "kb_disabled", "message": "智能问答还没开通"}), 503
    user = current_user()
    now = int(time.time())
    ttl = max(60, int(cfg.get("KB_TOKEN_TTL") or 3600))
    # sub 带前缀：知识库按 sub 建用户、隔离个人库，和以后可能接进来的别的身份来源不撞号
    claims: dict = {"sub": f"zcb:{user.id}", "iat": now, "exp": now + ttl}
    name = (user.nickname or "").strip()
    if name:
        claims["name"] = name[:100]
    if cfg.get("KB_JWT_AUDIENCE"):
        claims["aud"] = cfg["KB_JWT_AUDIENCE"]
    if cfg.get("KB_JWT_ISSUER"):
        claims["iss"] = cfg["KB_JWT_ISSUER"]
    return jsonify({"token": jwt.encode(claims, secret, algorithm="HS256"), "expiresIn": ttl, "base": base})
