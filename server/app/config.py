import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# 必须在读取 os.getenv 之前加载 .env
load_dotenv(BASE_DIR / ".env")


def _env_list(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me-please-use-32-bytes")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=90)

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'instance' / 'zhicuoben.db'}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads"))
    MAX_CONTENT_LENGTH = 32 * 1024 * 1024

    # Capacitor 原生壳的来源是 capacitor://localhost（iOS）与 http://localhost（Android）
    CORS_ORIGINS = _env_list(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost",
    )

    # AI：auto = 有 ANTHROPIC_API_KEY 就用 Claude，否则用本地 Mock
    AI_PROVIDER = os.getenv("AI_PROVIDER", "auto")
    ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")

    # 短信：mock 模式下验证码固定为 123456，并在接口返回里回显
    SMS_PROVIDER = os.getenv("SMS_PROVIDER", "mock")
    DEV_SMS_CODE = "123456"

    # Apple 登录：开发期不校验 identityToken 签名（APPLE_VERIFY=0）
    APPLE_VERIFY = os.getenv("APPLE_VERIFY", "0") == "1"
    APPLE_BUNDLE_ID = os.getenv("APPLE_BUNDLE_ID", "com.zhicuoben.app")

    MAX_CROPS_PER_RECOGNIZE = 6
    MAX_PAGES_PER_SCAN = 4
    DAILY_REVIEW_LIMIT = 20
