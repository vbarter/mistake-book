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

    @app.get("/api/health")
    def health():
        from .ai import provider_name

        return jsonify({"ok": True, "aiProvider": provider_name()})

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({"error": "not_found", "message": "资源不存在"}), 404

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "bad_request", "message": getattr(e, "description", "请求有误")}), 400

    with app.app_context():
        from . import models  # noqa: F401  确保模型注册

        db.create_all()

    return app
