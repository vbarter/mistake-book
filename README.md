# 知错本 · 学生端

面向小学高年级学生的 AI 错题本：拍下试卷 → 自动框选与识别 → 归入知识点 → 按遗忘曲线复习 → 同类变式练习。

设计依据：[设计 PRD 画布](https://claude.ai/artifact/2N4CKrjTAbpF5Uru2Za1mY)（15 块画板）。

```
mistake-book/
├── server/        Flask + SQLAlchemy + JWT 后端（Python 3.12）
│   ├── app/
│   │   ├── routes/      auth · mistakes · recognize · review · practice
│   │   ├── ai/          AI Provider：mock（默认）/ claude（视觉识别 + 结构化输出）
│   │   ├── scheduler.py 间隔复习规则（简化 SM-2）与掌握状态机
│   │   └── models.py    User · Mistake · ReviewLog · PracticeSession
│   └── tests/           pytest 接口与规则测试
└── app/           React 18 + Vite + TypeScript，Capacitor 6 打包 iOS / Android
    ├── src/pages/       欢迎 · 设置 · 登录 · 今天 · 录题三步 · 错题库 · 详情 · 复习 · 练习 · 我的
    ├── src/lib/boxes.ts 框选、裁剪与自动分段
    ├── ios/             Xcode 工程（Swift Package Manager）
    └── android/         Android Studio 工程
```

## 一、本地运行

### 1. 后端

```bash
cd server && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp .env.example .env && .venv/bin/python run.py
```

默认监听 `http://0.0.0.0:5001`（macOS 的 AirPlay 占用了 5000）。不配置 `DATABASE_URL` 时用 SQLite（`server/instance/zhicuoben.db`），正式环境用 MySQL：

### MySQL（Docker）

```bash
docker compose up -d
```

需要 Docker Desktop 已启动（CLI 在 `/Applications/Docker.app/Contents/Resources/bin`，若 `docker` 命令找不到请加入 PATH）。启动 MySQL 8.4（root/root，库 `zhicuoben`，账号 `zhicuoben`/`zhicuoben`），首次初始化自动执行 [server/db/schema.mysql.sql](server/db/schema.mysql.sql) 建表。已有实例上手动执行：

```bash
mysql -h 127.0.0.1 -P 3306 -uroot -proot < server/db/schema.mysql.sql
```

然后在 `server/.env` 里设置：

```
DATABASE_URL=mysql+pymysql://zhicuoben:zhicuoben@127.0.0.1:3306/zhicuoben?charset=utf8mb4
```

DDL 与 `app/models.py` 一一对应：`users`、`mistakes`、`review_logs`、`practice_sessions` 四张表，JSON 列存知识点、错因、变式题等数组，`(user_id, mastered, next_due_at)` 联合索引服务今日队列查询，外键级联删除保证删除账号时数据清空。

对着 MySQL 跑同一套测试（会用独立的 `zhicuoben_test` 库，测试前后自动建表删表）：

```bash
docker exec zhicuoben-mysql mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS zhicuoben_test; GRANT ALL ON zhicuoben_test.* TO 'zhicuoben'@'%';"
cd server && TEST_DATABASE_URL='mysql+pymysql://zhicuoben:zhicuoben@127.0.0.1:3306/zhicuoben_test?charset=utf8mb4' .venv/bin/python -m pytest -q tests
```

- `GET /api/health` 返回当前 AI Provider。
- 开发期短信验证码固定 `123456`，接口会回显 `devCode`。
- 接入 Claude：在 `.env` 里填 `ANTHROPIC_API_KEY`（或先 `ant auth login`），`AI_PROVIDER=auto` 会自动切换。识别用 `claude-opus-5-5` 视觉模型 + JSON Schema 结构化输出，一次完成 OCR、学科归类、知识点、答案与解析；不填 Key 时用本地 Mock，返回四道示例题，全流程可跑。

测试：

```bash
cd server && .venv/bin/python -m pytest -q tests
```

### 2. 前端（网页调试）

```bash
cd app && npm install && npm run dev
```

打开 `http://localhost:5173`，`/api` 由 Vite 代理到 5001。用手机尺寸查看最接近真机。拍摄页在网页端退化为文件选择，也可点「用示例试卷试试」加载内置样例。

## 二、打包 iOS / Android

原生工程已生成在 `app/ios` 与 `app/android`，网页资源通过 Capacitor 同步进去。

1. 配置后端地址：复制 `app/.env.example` 为 `app/.env`，把 `VITE_API_BASE` 改成手机能访问的地址（局域网 IP 或正式域名）。真机里也可在「我的 → 账号与登录 → 服务器地址」临时修改。
2. 构建并同步：

```bash
cd app && npm run cap:sync
```

3. iOS（需要 Xcode 15+，本机未安装）：

```bash
cd app && npx cap open ios
```

在 Xcode 里选择开发团队与 Bundle ID（`com.zhicuoben.app`），然后在模拟器或真机运行。相机与相册权限文案已写入 `Info.plist`。

也可以不开 Xcode，直接命令行构建并装进模拟器：

```bash
cd app/ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ../build CODE_SIGNING_ALLOWED=NO build && xcrun simctl boot "iPhone 17"; xcrun simctl install booted ../build/Build/Products/Debug-iphonesimulator/App.app && xcrun simctl launch booted com.zhicuoben.app
```

Xcode 27 适配（已完成）：部署目标提到 iOS 15（Xcode 27 最低支持 15.0）；iOS 27 SDK 强制 UIScene 生命周期，已添加 `App/SceneDelegate.swift` 并在 `Info.plist` 配置 `UIApplicationSceneManifest`，Capacitor 6 原模板会在启动时触发断点崩溃。模拟器里 App 通过 `http://localhost:5001` 直连本机后端；真机需改 `VITE_API_BASE` 为局域网 IP。

**真机 / TestFlight 打包（已验证）**：团队 ID `65G6A2Q6DK` 已写入工程，自动签名。`app/.env` 指向线上 API 后：

```bash
cd app && npm run build && npx cap sync ios && cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -archivePath ../build/App.xcarchive -allowProvisioningUpdates archive
```

```bash
cd app/ios && xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist ExportOptions-development.plist -exportPath build/export-dev -allowProvisioningUpdates
```

```bash
cd app/ios && xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist ExportOptions-appstore.plist -exportPath build/export-appstore -allowProvisioningUpdates
```

- `export-dev/App.ipa`：Apple Development 签名，只能装到开发者账号里已注册的设备（Finder 拖到设备、Apple Configurator，或 `xcrun devicectl device install app --device <udid> App.ipa`）。
- `export-appstore/App.ipa`：Cloud Managed Apple Distribution 签名，用于上传 TestFlight / App Store（Xcode Organizer，或 `xcrun altool --upload-app`，或 `asc` CLI）。上传前在 App Store Connect 新建 App 记录（Bundle ID `com.zhicuoben.app`）。
- 每次上传前把 `CURRENT_PROJECT_VERSION`（build 号）加 1。
- `Info.plist` 里 `NSAllowsArbitraryLoads = true` 是为了连公网 HTTP 的 API；提交审核前应改为 HTTPS 域名并移除该项。

Apple 登录：`@capacitor-community/apple-sign-in` 6.x 不支持 Swift Package Manager，暂未接入；接入时在 Signing & Capabilities 加 **Sign in with Apple**，拿到 `identityToken` 后调用 `Login.tsx` 里预留的 `appleLogin()`。

4. Android（需要 Android Studio 与 JDK 17，本机未安装）：

```bash
cd app && npx cap open android
```

Gradle 同步后直接运行。开发期 `capacitor.config.ts` 开启了明文 HTTP 以便连局域网后端，上线前应改为 HTTPS 并关闭 `cleartext`。

## 三、云服务器部署（已部署）

后端运行在 `43.129.175.172`（OpenCloudOS 9，Python 3.11），对外地址：

```
http://43.129.175.172:8080/zhicuoben/api/health
```

| 项 | 位置 |
|---|---|
| 代码与虚拟环境 | `/opt/zhicuoben/server`（`.venv`、`.env` 在其中） |
| 上传图片与日志 | `/opt/zhicuoben/data/`（`uploads/`、`access.log`、`error.log`） |
| 进程 | systemd `zhicuoben.service`，gunicorn 2 进程 × 4 线程，监听 `127.0.0.1:5001`（[deploy/zhicuoben.service](deploy/zhicuoben.service)） |
| 反向代理 | nginx 8080 通用站点 `include /etc/nginx/default.d/zhicuoben.conf`，`/zhicuoben/` → 5001（[deploy/nginx-zhicuoben.conf](deploy/nginx-zhicuoben.conf)） |

常用命令（在服务器上）：

```bash
systemctl status zhicuoben
journalctl -u zhicuoben -n 50
tail -f /opt/zhicuoben/data/error.log
```

更新代码：本地执行 `deploy/deploy.sh`，会同步 `server/`、安装依赖并重启服务。

**数据库**：MySQL 8.0 直接装在这台服务器上（`dnf install mysql-server`），配置 `/etc/my.cnf.d/zhicuoben.cnf` 只监听 `127.0.0.1`，默认 utf8mb4、东八区。库表由 [server/db/schema.mysql.sql](server/db/schema.mysql.sql) 建立，应用账号 `zhicuoben@localhost` 只有增删改查权限，密码在服务器的 `/opt/zhicuoben/server/.env` 里。上海那台 TencentDB 与香港服务器不在同一地域，跨境打通需购买云联网带宽，故未使用。

```bash
mysql -uroot zhicuoben            # 服务器上本地 root 免密登录
mysqldump -uroot zhicuoben > /opt/zhicuoben/data/backup-$(date +%F).sql   # 备份
```

**App 指向线上**：`app/.env` 设 `VITE_API_BASE=http://43.129.175.172:8080/zhicuoben` 后 `npm run cap:sync`。注意 iOS 的 ATS 默认禁止向公网 IP 发明文 HTTP，真机调试需在 `Info.plist` 临时加 `NSAppTransportSecurity → NSAllowsArbitraryLoads = true`；正式发布应给 API 配一个带 HTTPS 证书的子域名（magicart.cc 当前被 Cloudflare 规则整站 301 到首页，不能直接复用）。

## 四、关键规则（与 PRD 画板 31 一致）

- 掌握状态：待复习 → 巩固中 → 已掌握。到期即待复习；连续两次「记得」且档位 ≥ 2 自动升级已掌握；手动标记可撤销。
- 间隔序列 1 → 3 → 7 → 15 → 30 天；「模糊」间隔减半，「忘了」回到 1 天；练习答错立即到期。
- 同学科题干相似度 ≥ 90% 的再次录入会合并为「再错一次」。
- 每日复习队列上限 20 题，按到期时间、错次、学科轮换排序。

## 五、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/code · /auth/login · /auth/apple · /auth/guest · /auth/bind | 验证码 / 手机登录 / Apple 登录 / 游客 / 绑定 |
| GET PATCH DELETE | /api/auth/me | 资料、设置、删除账号 |
| POST | /api/recognize | 框选截图 → AI 识别（不入库） |
| GET POST | /api/mistakes | 列表（subject / state / q / topic）· 批量入库（自动合并同题） |
| GET | /api/mistakes/groups | 学科 → 知识点聚合 |
| GET PATCH DELETE | /api/mistakes/:id | 详情、编辑、删除 |
| POST | /api/mistakes/:id/master · /reinstate · /variants | 标记掌握 / 重新加入 / 生成变式 |
| GET | /api/review/today · /review/preview/:id | 今日队列 · 自评预告 |
| POST | /api/review/:id/rate | 自评 forgot / fuzzy / remembered |
| GET | /api/practice/weak · /practice/:sid | 薄弱知识点 · 会话 |
| POST | /api/practice/start · /:sid/answer · /:sid/finish | 开始 / 作答 / 结束 |
| GET | /api/stats/overview | 今天页与我的页数据 |

## 六、尚未实现（PRD 范围内）

- 导出 PDF（界面已留入口，提示「下个版本提供」）。
- 复习提醒的本地通知推送（设置已可保存，需接入 `@capacitor/local-notifications`）。
- Apple 登录服务端验签（`APPLE_VERIFY=1` 时需接入 Apple 公钥）；生产短信服务。
- AI 预框当前用本地「按行墨迹分段」替代，接入 Claude 后仍由用户确认框选。
