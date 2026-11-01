# 上海后台部署记录

部署与检查日期：2026-11-01（北京时间）。

## 当前部署

- 上海：`root@122.51.113.112`，OpenCloudOS 9.4、Python 3.11.6。
- 后台代码：`/opt/zhicuoben/server`，虚拟环境 `.venv`，生产配置 `.env`（权限 600）。代码、配置文件摘要与香港服务器一致。
- 数据库：本机 MySQL `zhicuoben`，仅监听回环地址。保留上海已有数据库，未覆盖；它是独立副本，不与香港实时同步。
- 上传文件：`/opt/zhicuoben/data/uploads`，共 11 个文件，与香港数量一致。
- Gunicorn：单 worker、8 线程，监听 `127.0.0.1:5001`；由 Supervisor 管理，退出后自动重启。
- Supervisor：独立虚拟环境 `/opt/zhicuoben/supervisor-venv`，版本 4.3.0。
- `supervisord.service`、`nginx.service`、`mysqld.service` 已开启开机启动。Supervisor 在 MySQL 启动后运行。
- 原 `zhicuoben.service` 已停止并禁用，避免同时启动两个 Gunicorn；配置保留以便回滚。
- Supervisor 配置：`/etc/supervisord.conf` 与 `/etc/supervisord.d/zhicuoben.ini`，不加载镜像内其他项目的旧 Supervisor 配置。
- Nginx 新增 `/etc/nginx/conf.d/zhicuoben-shanghai.conf`，已有域名 HTTPS 配置保留。
- 日志：`/opt/zhicuoben/data/`；Gunicorn access/error 每日轮转保留 14 份，Supervisor 日志按大小轮转。

## 访问和检查

直接访问上海健康接口：

```bash
curl -fsS http://122.51.113.112/api/health
curl -fsS http://122.51.113.112/zhicuoben/api/health
curl -fsS http://122.51.113.112:8080/zhicuoben/api/health
```

截至部署时，`book.openmindai.cn` DNS 仍指向香港 `43.129.175.172`，未切换线上流量。验证上海 HTTPS 时需指定解析，证书校验保持开启：

```bash
curl -fsS --resolve book.openmindai.cn:443:122.51.113.112 \
  https://book.openmindai.cn/api/health
```

已通过：

- 公网 HTTP、8080 兼容入口、指定上海 IP 的 HTTPS 健康检查，返回 `ok: true`、`aiProvider: claude-relay`、`ocr: baidu:online`。
- 管理后台 HTTPS 登录、Secure/HttpOnly Cookie、统计接口读取 MySQL。
- 未登录 API / 管理接口返回 401、未知 API 返回 JSON 404、iOS Capacitor CORS。
- 数据库 7 张表可读；用户 6 条、识别任务 27 条、导出任务 5 条；上传目录文件非空。
- 一次真实 AI 中转请求正常响应；OCR 检查为鉴权/在线检查，未提交用户照片做完整识别。
- 在不含生产 `.env` 的临时源码副本中，使用内存 SQLite 运行现有测试：94 passed。生产配置会影响测试中的 Apple、微信和知识点开关，因此测试必须隔离配置。
- 主动结束 Gunicorn 主进程后，Supervisor 自动拉起新进程，健康检查恢复。
- 重启 Supervisor 服务后，后台重新进入 RUNNING 状态。
- Nginx 配置校验、Python 依赖检查、日志轮转配置预检通过。

HTTPS 证书有效至 2027-01-22；已有 certbot 续期任务保留。正式切换时需要确认域名备案、最终数据同步和续期校验的实际落点。

## 运维

```bash
ssh root@122.51.113.112
supervisorctl status
supervisorctl restart zhicuoben
systemctl status nginx supervisord mysqld
nginx -t && systemctl reload nginx
tail -n 100 /opt/zhicuoben/data/error.log
journalctl -u supervisord -n 100
```

后续从本地部署代码：

```bash
deploy/deploy.sh root@122.51.113.112
```

脚本默认仍部署香港；显式传入上海地址时自动使用 Supervisor 重启。

变更前备份位于上海：`/opt/zhicuoben/data/deploy-backup-20261101-125829/`，包括 Nginx、旧 systemd 单元、旧 Supervisor 配置、生产环境文件与 MySQL 快照。备份含敏感配置，仅供服务器管理员访问。

恢复旧进程托管方式（无需还原数据库）：

```bash
systemctl disable --now supervisord
systemctl enable --now zhicuoben
```

完整恢复代理配置前应先检查备份内容；不要将旧 MySQL 快照直接覆盖到已有新增数据的数据库。
