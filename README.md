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

## 2.0 产品结构（当前版本）

三个 Tab，一条主路径：**拍试卷 → AI 还原电子版 → 错题按知识点汇总 → 导出**。

- **试卷**（`pages/Papers.tsx`、`FolderDetail.tsx`、`capture/Paper.tsx`、`capture/Capture.tsx`）：一次考试一个文件夹，一个文件夹装多张试卷（`lib/folders.ts`：Folder → Paper → 照片 + 电子版 + 订正记录，存本机 IndexedDB，1.x 的"一夹一卷"记录会自动迁移）。文件夹页分"试卷 / 错题汇总"两段，错题跨试卷按考纲一级知识点合并（`lib/errors.ts`），点题号或卡片勾选"已订正"，进度回流到文件夹卡的进度环。单张试卷页分"试卷（可打印原题）/ 作答 / 错题"三段。
- **错题库**（`pages/Library.tsx`）：所有文件夹的错题，按学科（学科 → 知识点 → 题）或按时间（月份 → 文件夹 → 题），右上角导出当前范围。
- **我的**（`pages/Profile.tsx`、`ProfilePages.tsx`）：昵称、年级（1–12，含高中）与所在城市（本机保存，扫描时作为考纲提示传给 `/api/digitize` 的 `region`）、学科、本机数据、隐私、账号、关于。周目标、复习提醒、家长视图、练习与每日复习已从界面去掉；服务端对应接口保留但前端不再调用。
- **导出**（`components/ExportSheet.tsx`）两种 PDF：错题本 `POST /api/digitize/book`（横向 A4，左栏空白重做、右栏原答案 / 正确答案 / 解析，按知识点分组，短文的几个空合成一题）；原始电子试卷 `POST /api/digitize/pdf`（可一次传多张 `papers`，合成一个文件）。原生端走系统分享面板可直接打印。
- **学科自动识别**：学科枚举覆盖小学到高中（数学、语文、英语、科学、物理、化学、生物、历史、地理、道法）。扫描时把全部学科给模型，模型在卷面级输出 `subject`（从卷头判断，题块默认继承，卷面判不出时按题块多数推断），试卷记录存下学科，文件夹没选学科时由第一张扫完的卷自动填上。一个文件夹里有多科时卡片上叠放两个学科方块、试卷行带小方块、错题汇总可按学科切换并按学科导出。提示词里给了各科的考纲一级知识点示例（物理 / 化学 / 生物 / 史地道）。个人资料里勾选的学科只影响错题库排序，不限制识别。
- **扫描是服务器后台任务**：`POST /api/digitize` 收到照片后立刻返回任务号（202），识别在服务器线程里跑并把每页进度写进 `digitize_jobs` 表（`db.create_all` 自动建表，DDL 也在 `db/schema.mysql.sql`），结果保留一天；`GET /api/digitize/jobs/<id>` 查进度与结果，服务重启卡住的任务超过 10 分钟按失败报。客户端（`lib/jobs.ts`）提交后把任务号和上传片段映射存在试卷记录上，立刻回到文件夹，试卷行显示「AI 还原中 N%」；全局轮询每 4 秒问一次，App 回到前台（`appStateChange` / `visibilitychange`）立刻问一次，完成后把电子版、学科落库并通知页面刷新。切走 App、杀掉 App 都不影响，照片和任务号都在本机。测试与 `DIGITIZE_SYNC=1` 时同步执行并直接返回 done。识别分两步：先调 OCR（`ai/ocr.py`）把文字逐行识别出来（每页约 3–6 秒，公式为 LaTeX），再把照片和 OCR 文字一起交给大模型做版面、手写作答、批改与知识点分析，印刷内容以 OCR 为准逐字照抄；OCR 失败时退回大模型直接看图。OCR 有两套方案，`.env` 里 `OCR_PROVIDER = paddle | baidu | off` 开关切换（留空自动：哪套配置齐了用哪套，paddle 优先），改完 `systemctl restart zhicuoben` 生效：**paddle** 是私有化部署的 PaddleOCR-VL（OpenAI Chat Completions 兼容接口，配置 `OCR_BASE_URL` / `OCR_AUTH` / `OCR_MODEL`）；**baidu** 是百度智能云「试卷分析与识别」doc_analysis（配置 `BAIDU_OCR_API_KEY` / `BAIDU_OCR_SECRET_KEY`，access_token 进程内缓存 30 天、失效自动刷新），开了 `layout_analysis` 按分栏（对页 / 两栏）排阅读顺序、栏间空一行，能区分印刷与手写，手写行加 `[手写] ` 前缀交给大模型只作参考（它偶尔把整行印刷标成手写，提示词里已说明以照片为准）。`/api/health` 的 `ocr` 字段显示 `disabled` / `<方案>:online` / `<方案>:offline` / `<方案>:unconfigured`，sheet 上带 `ocrText`。识别走全局队列（`ai/queue.py`）：整个进程最多 `MAX_CONCURRENT_PAGES`（默认 5）张照片同时调大模型，多出来的排队，先到先得；每张照片拿到槽位时进度按「开始算一半、完成算全部」推进，状态接口带 `queue: {limit, running, waiting}` 和 `startedPages`，客户端据此显示「排队中 · 前面还有 N 张」。因此 gunicorn 跑单 worker 多线程（`deploy/zhicuoben.service`：`--workers 1 --threads 8`），多 worker 时每个进程各有一份上限。某张照片模型返回解析不了的 JSON 时自动重试一次。
- 视觉：`styles/v2.css` + `components/v2.tsx`（学科方块、状态标签、错题进度环、带图标分段控件）。设计稿见 Claude 画板「知错本 2.0 产品路径」。
- 下面"录题流程（v1.0 第二版）""关键规则"等段落描述的是 1.x 的今天 / 复习 / 练习链路，接口仍在，界面已下线。

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
- 接入 Claude：在 `.env` 里填 `ANTHROPIC_API_KEY`（或先 `ant auth login`），`AI_PROVIDER=auto` 会自动切换。识别模型由 `ANTHROPIC_MODEL` 指定，默认 `gpt-6.1-sol`（经 api.tu-zi.com 中转，用真卷对比过 claude-opus-5-5 / claude-haiku-5-5 / gpt-6.1-sol，gpt-6.1-sol 对铅笔手写的识别最好、答案与知识点准确），JSON Schema 结构化输出，一次完成 OCR、学科归类、知识点、答案与解析；不填 Key 时用本地 Mock，返回四道示例题，全流程可跑。
- 走中转（线上用的是 api.tu-zi.com）：再设 `ANTHROPIC_BASE_URL=https://api.tu-zi.com`，Key 用中转的 `sk-...`。中转只提供标准 Messages 接口，Provider 会自动进入中转模式：不发 beta 头、结构化输出和服务端回退，改为提示词约束 JSON 并容错解析（`/api/health` 显示 `claude-relay`）。tu-zi 对每次请求按模型最大输出预扣额度，余额不足时返回 403，App 会提示「额度不足」。

本地调试大模型：`server/.env` 里填 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_BASE_URL=https://api.tu-zi.com`，重启后 `/api/health` 应显示 `claude-relay`；想临时回到不花钱的示例结果，把 `AI_PROVIDER=mock` 即可。项目 `.env` 会覆盖 shell 里同名的环境变量（`load_dotenv(override=True)`）。日志在 `server/instance/dev-server.log`（用 `python -u run.py` 启动时不缓冲）。

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
- `Info.plist` 里 `NSAllowsArbitraryLoads = true` 是为了连公网 HTTP 的 API；提交审核前应改为 HTTPS 域名并移除该项。**注意**：ATS 字典里不能同时出现 `NSAllowsLocalNetworking`、`NSAllowsArbitraryLoadsInWebContent` 或 `NSAllowsArbitraryLoadsForMedia`，否则 iOS 会忽略 `NSAllowsArbitraryLoads`（build 1、2 就是因此在真机上报「没有网络」，系统日志为 `does not conform to ATS policy`）。

Apple 登录（已接入）：工程已升级到 Capacitor 7，使用 `@capacitor-community/apple-sign-in` 7.1.0（支持 SPM）。`App/App.entitlements` 声明 `com.apple.developer.applesignin`，自动签名归档时会把 **Sign in with Apple** 能力注册到 App ID。登录页点「通过 Apple 登录」→ 系统授权面板 → 把 `identityToken` 交给 `/api/auth/apple`（新用户）或 `/api/auth/bind`（游客绑定）。服务端 `APPLE_VERIFY=1` 时用 Apple JWKS 公钥校验签名、`iss`、`aud`（Bundle ID）和有效期，线上已开启；本地联调可设为 0 只解码。Apple 只在首次授权返回姓名，之后沿用已保存的昵称。模拟器测试需先在模拟器的「设置」里登录 Apple ID。

4. Android（需要 Android Studio 与 JDK 17，本机未安装）：

```bash
cd app && npx cap open android
```

Gradle 同步后直接运行。开发期 `capacitor.config.ts` 开启了明文 HTTP 以便连局域网后端，上线前应改为 HTTPS 并关闭 `cleartext`。

## 三、云服务器部署（已部署）

> 加新表时注意：线上 MySQL 账号 `zhicuoben` 没有 CREATE 权限，`db.create_all()` 会失败（已改为只记警告不崩溃）。部署前先在服务器上用 root 执行 `db/schema.mysql.sql` 里对应的 `CREATE TABLE IF NOT EXISTS`，例如 `mysql -uroot zhicuoben < db/schema.mysql.sql`。


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

## 录题流程（v1.0 第二版）

录题入口（`Papers.tsx`、`Today.tsx`、`capture/Capture.tsx`）：「试卷」是独立 Tab，列出录过的每份试卷（缩略图、页数、日期、状态：未扫描 / 错 N 题 / 全对），点一下直达电子版（已扫描）或录入页（未扫描），底栏「拍试卷 / 从相册选」一步开始；今天页只保留右上角相机、首次使用的引导卡和「最近试卷」卡（最近 3 份 + 拍新试卷），不再有重复的录题按钮。录入页不再有引导页和试卷夹列表：带 `state.source` 进入时立刻起相机或相册多选，什么都没选就原路返回；相册多选是一次选完整份卷子，所以选完自动开始扫描；拍照一次一页，拍完所有页再点扫描。试卷夹存在本机 IndexedDB（`app/src/lib/folders.ts`），最多 4 页，可重命名、追加页、随时回来继续。

主按钮「扫描还原电子版」把每页准备成上传片段（`prepareUpload`：模型会把图片压到最长边约 1568px，所以左右两页拍在一张里的宽幅照片先切成左右两张各带 2% 重叠，再缩到 1568px / 质量 0.85），上传 `/api/digitize`。服务端对每张图片并发各调一次模型，按原卷版面还原为 `sheets`（一张照片拍到几页就几个 sheet，带页码 label、卷头 title、得分 score、零散文字 note）→ `blocks`（按阅读顺序：`section` 大题标题 / 说明 / 分值，`passage` 短文正文并用 `[[36]]` 占位内嵌空格，`wordbank` 词库方框，`item` 小题含题号、正文占位空格、括号给词 hint、改写要求 instruction、选项，`text` 页眉页脚），每个空（`blank`）单独记录学生手写转写 student（看不清用「□」）、老师批改 mark、批注 note、正确答案 answer 与解析 analysis；passage / item 还带学科、题型、知识点、提示、在照片上的 bbox。服务端再从版面块派生 `questions`（一个编号空 = 一题，带 sheet / blockIndex / blankIds），错题本收录链路不变；前端把片段编号和 bbox 映射回试卷夹里的页。结果存进试卷夹，下次打开直接看（旧结构的电子版会被忽略，重扫即可）。批改判定规则：打勾 ✓ ☑ √ 为正确，打叉 ✗ ×、斜杠 /、划掉为错误，部分扣分为半对；没有作答的空单独归为「未作答」（mark=blank，服务端 `digitize.py` 兜底），不算答错，但和错题一样进入汇总并可订正；老师没批改（unmarked）的选择 / 填空题，只要学生写了答案且模型给出了正确答案，服务端 `auto_mark` 会自动对照判对错（看不清的「□」和解答题不判，`/` 分隔的多个答案任一匹配即对），前端 `effectiveMark` 对旧扫描结果做同样处理，所以未批改卷子的错题也会进汇总和错题本；导出错题本时可选只含错题 / 只含未作答 / 只含未订正。电子版页（`Paper.tsx` + `styles/paper.css`）分三段：「试卷」是可打印的干净原题（大题标题与说明、短文内嵌只带空号的空格、词库方框、括号给词与改写要求，不含任何手写）；「作答」逐空列出学生手写转写、判定（正确 / 错误 / 半对 / 未作答 / 未批改）与正确答案；「错题汇总」只按知识点归类：模型先从卷头、页眉页脚判断考试信息（examLevel 考试类型、examGrade 年级、region 地区、syllabus 归类依据的考纲 / 课标，如「上海中考英语考纲」），再要求每题 knowledgePoints 第一项必须是该考纲里的一级知识点规范名称（整卷统一，便于按知识点记忆），后面才是细分点；页面与 PDF 都按第一项分组，组内逐题给出作答、正确答案、解析、提示与细分点，错题默认全选，「收进错题本」按位置裁出截图进入核对页。「导出 PDF」调用 `POST /api/digitize/pdf`（reportlab，内置 STSong-Light 中文字体，不依赖服务器字体文件），PDF 含试卷打印版、作答与批改对照表、错题汇总三部分；原生端写入缓存后拉起系统分享面板（可直接打印、存到「文件」），网页端在新标签打开。「改用手动框选」保留旧流程作为备用；`/api/scan` 仍可用（只返回判错题）。服务端 AI 调用统一走流式请求（SDK 对大 `max_tokens` 的非流式调用会直接报错）。

## 五、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/code · /auth/login · /auth/apple · /auth/guest · /auth/bind | 验证码 / 手机登录 / Apple 登录 / 游客 / 绑定 |
| GET PATCH DELETE | /api/auth/me | 资料、设置、删除账号 |
| POST | /api/digitize | 提交数字化任务：整页试卷照片（≤8 张，宽幅照片前端已拆成左右两张）→ 202 + 任务号；完成后结果为按原卷版面还原的电子版 `pages`（sheets → blocks → blanks）+ 派生题目 `questions` |
| GET | /api/digitize/jobs/<id> | 任务进度、状态，完成后带 `result` |
| POST | /api/digitize/pdf | 电子版（`title`、`pages`、`questions` 原样传回）→ 可打印 PDF：试卷 + 作答与批改 + 错题汇总 |
| POST | /api/scan | 整页试卷（≤4 页）→ 只返回判错题目及位置（不入库） |
| POST | /api/recognize | 手动框选截图 → AI 识别（不入库） |
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
