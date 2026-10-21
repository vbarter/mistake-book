import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    # 0.0.0.0 便于手机 / 模拟器通过局域网 IP 访问
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5001)), debug=os.getenv("FLASK_DEBUG", "1") == "1")
