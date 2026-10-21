#!/usr/bin/env bash
# 把 server/ 同步到云服务器并重启服务。用法：deploy/deploy.sh [user@host]
set -euo pipefail
HOST="${1:-root@43.129.175.172}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ 同步代码到 $HOST:/opt/zhicuoben/server"
tar -C "$ROOT/server" \
  --exclude .venv --exclude instance --exclude uploads --exclude .env \
  --exclude __pycache__ --exclude .pytest_cache \
  -czf - . | ssh "$HOST" 'mkdir -p /opt/zhicuoben/server /opt/zhicuoben/data/uploads && tar -xzf - -C /opt/zhicuoben/server'

ssh "$HOST" bash -s <<'EOF'
set -e
cd /opt/zhicuoben/server
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt gunicorn
if [ ! -f .env ]; then
  echo "!! /opt/zhicuoben/server/.env 不存在，请参照 .env.example 创建"; exit 1
fi
if [ ! -f /etc/systemd/system/zhicuoben.service ]; then
  echo "!! 缺少 systemd 单元，请先复制 deploy/zhicuoben.service 到 /etc/systemd/system/ 并 enable"; exit 1
fi
systemctl restart zhicuoben.service
sleep 2
systemctl is-active zhicuoben.service
curl -s -m 5 http://127.0.0.1:5001/api/health; echo
EOF
echo "✓ 部署完成"
