import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# 必须在读取 os.getenv 之前加载 .env；override=True 让项目 .env 覆盖 shell 里残留的同名变量
# （例如开发机上全局导出的 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY）
load_dotenv(BASE_DIR / ".env", override=True)


def _env_list(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me-please-use-32-bytes")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    # 登录状态一直保持到用户主动退出：token 一年有效，App 每次打开调 /auth/me 都换一个新的，常用就永不过期
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=365)

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'instance' / 'zhicuoben.db'}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads"))
    MAX_CONTENT_LENGTH = 150 * 1024 * 1024  # 一张试卷照片张数不限，按 100 个上传片段留余量；nginx 同步 150m

    # Capacitor 原生壳的来源是 capacitor://localhost（iOS）与 http://localhost（Android）
    CORS_ORIGINS = _env_list(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost",
    )

    # AI：auto = 有 ANTHROPIC_API_KEY 就用 Claude，否则用本地 Mock
    AI_PROVIDER = os.getenv("AI_PROVIDER", "auto")
    ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "gpt-6.1-sol")

    # 短信：mock 模式下验证码固定为 123456，并在接口返回里回显
    # 短信：off（默认，手机号验证码登录关闭，只有审核账号能用）| aliyun（阿里云短信认证，见 app/sms.py）| mock（本地开发，验证码固定 123456 并回显）
    SMS_PROVIDER = os.getenv("SMS_PROVIDER", "off")
    DEV_SMS_CODE = "123456"
    # App Store 审核用的测试账号：固定手机号 + 固定验证码，不发短信、不回显（.env 里配置，不进仓库）
    REVIEW_PHONE = os.getenv("REVIEW_PHONE", "").strip()
    REVIEW_CODE = os.getenv("REVIEW_CODE", "").strip()
    # 管理后台 /admin 的登录密码；不配置时后台不开放
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()

    # Apple 登录：开发期不校验 identityToken 签名（APPLE_VERIFY=0）
    APPLE_VERIFY = os.getenv("APPLE_VERIFY", "0") == "1"
    APPLE_BUNDLE_ID = os.getenv("APPLE_BUNDLE_ID", "com.zhicuoben.app")

    # 知识图谱标注：识别完后把错题交给大模型挑图谱里的知识点 id（数据见 app/data/taxonomy.json）。默认关
    TAXONOMY_TAGGING = os.getenv("TAXONOMY_TAGGING", "0") == "1"

    MAX_CROPS_PER_RECOGNIZE = 6
    MAX_PAGES_PER_SCAN = 100  # 前端不限照片张数；宽幅照片会拆成左右两张上传，这里只防滥用
    DAILY_REVIEW_LIMIT = 20
