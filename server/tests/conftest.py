import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import create_app  # noqa: E402
from app.ai import reset_provider  # noqa: E402


# 默认用内存 SQLite；设置 TEST_DATABASE_URL 可对着 MySQL 跑同一套测试，例如
#   TEST_DATABASE_URL=mysql+pymysql://zhicuoben:zhicuoben@127.0.0.1:3306/zhicuoben_test?charset=utf8mb4
TEST_DB = os.getenv("TEST_DATABASE_URL", "sqlite://")


@pytest.fixture()
def app():
    tmp = tempfile.mkdtemp()
    reset_provider()
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": TEST_DB,
            "UPLOAD_DIR": tmp,
            "AI_PROVIDER": "mock",
            "SMS_PROVIDER": "mock",
        }
    )
    from app.extensions import db

    with app.app_context():
        db.drop_all()
        db.create_all()
    yield app
    if not TEST_DB.startswith("sqlite"):
        with app.app_context():
            db.session.remove()
            db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def auth(client):
    """登录并返回带 Authorization 的 headers。"""
    r = client.post("/api/auth/code", json={"phone": "13800000000"})
    code = r.get_json()["devCode"]
    r = client.post("/api/auth/login", json={"phone": "13800000000", "code": code, "profile": {"nickname": "小雨", "grade": "5"}})
    token = r.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


TINY_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
