"""知错本服务端应用工厂。"""
from __future__ import annotations

import os

from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from .extensions import db
from .config import Config  # config.py 顶部已加载 .env


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    # MySQL：连接池保活，避免 wait_timeout 后拿到失效连接；SQLite 不接受这些参数
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("mysql"):
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 280, "pool_size": 5, "max_overflow": 10}

    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)

    db.init_app(app)
    JWTManager(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    from .routes.auth import bp as auth_bp
    from .routes.mistakes import bp as mistakes_bp
    from .routes.recognize import bp as recognize_bp
    from .routes.review import bp as review_bp
    from .routes.practice import bp as practice_bp

    for bp in (auth_bp, mistakes_bp, recognize_bp, review_bp, practice_bp):
        app.register_blueprint(bp, url_prefix="/api")

    from .routes.admin import bp as admin_bp

    app.register_blueprint(admin_bp)  # /admin 管理后台

    @app.get("/api/health")
    def health():
        from .ai import provider_name

        from .ai import ocr

        return jsonify({"ok": True, "aiProvider": provider_name(), "ocr": ocr.health()})

    @app.errorhandler(404)
    def not_found(e):
        # abort(404, "具体原因") 时用具体原因（如「这个手机号还没注册」），否则是通用的「资源不存在」
        from werkzeug.exceptions import NotFound

        desc = getattr(e, "description", None)
        message = desc if desc and desc != NotFound.description else "资源不存在"
        return jsonify({"error": "not_found", "message": message}), 404

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "bad_request", "message": getattr(e, "description", "请求有误")}), 400

    # 其余 HTTP 错误（401 / 403 / 413 / 502 / 503 …）也返回 JSON，客户端才能显示具体原因，而不是「请求失败」
    from werkzeug.exceptions import HTTPException

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException):
        return jsonify({"error": (e.name or "error").lower().replace(" ", "_"), "message": e.description or "请求失败"}), e.code or 500

    # gunicorn 下把应用与各模块的日志接到 gunicorn 的 error log，后台任务里的异常才看得到。
    # handler 只挂在 root 上：app.logger（名字是 "app"）和 app.* 模块的日志都会冒泡到 root，再挂一份就会每行写两遍
    import logging

    gunicorn_logger = logging.getLogger("gunicorn.error")
    if gunicorn_logger.handlers:
        root_logger = logging.getLogger()
        root_logger.handlers = gunicorn_logger.handlers
        root_logger.setLevel(gunicorn_logger.level or logging.INFO)
        app.logger.handlers = []
        app.logger.setLevel(gunicorn_logger.level or logging.INFO)

    with app.app_context():
        from . import models  # noqa: F401  确保模型注册

        try:
            db.create_all()
        except Exception as e:  # noqa: BLE001
            # 线上数据库账号没有 CREATE 权限时不要把服务拖死：新表用 root 执行 db/schema.mysql.sql 里的 DDL
            app.logger.warning("db.create_all 失败（新表请用 root 手动建）：%s", e)

    return app
