# 错误本 · 微信小程序

「知错本」的名字在微信小程序里已被占用，小程序对外名称叫「错误本」；iOS / 安卓 App 仍叫「知错本」。

用 [Taro 4](https://docs.taro.zone)（React + TypeScript）开发，和 App 共用后端 `https://book.openmindai.cn`。
功能和 App 一致：拍试卷 / 相册多选 → 服务器扫描成电子版 → 自动找出错题（含未作答）、老师没批的交给大模型补判 → 按知识点归类 → 导出错题本 / 电子试卷 PDF。

## 本地开发

```bash
cd miniprogram
npm install
npm run dev        # 监听编译到 dist/
npm run build      # 一次性编译
npm run typecheck
```

用微信开发者工具「导入项目」，目录选 `miniprogram/`（`project.config.json` 已指向 `dist/`）。
`project.config.json` 里已填正式 AppID `wx6c5b932ae1de242f`；AppSecret 只放在服务器 `.env`，不进仓库。
开发时已关闭域名校验（`urlCheck: false`），手机预览前要先完成下面的后台配置。

后端地址默认 `https://book.openmindai.cn`，本地调试可以：

```bash
TARO_APP_API_BASE=http://localhost:5001 npm run dev
```

## 上线前要在小程序后台做的事

1. **开发管理 → 开发设置 → 服务器域名**
   - request 合法域名：`https://book.openmindai.cn`
   - downloadFile 合法域名：同上（学习计划里打开 PDF / Word 附件要下载）。服务器用腾讯云 COS 存文件时，把存储桶域名（`https://<bucket>.cos.<region>.myqcloud.com`）同时加进 request 和 downloadFile 合法域名
2. **AppID / AppSecret** 写进服务器 `.env`（不要提交到仓库），然后重启服务（已配好）：
   ```
   WX_APPID=wx...
   WX_SECRET=...
   ```
   没配的时候，「微信一键登录」会自动退回游客账号，功能都能用，只是换手机后账号不通。
3. 用户隐私保护指引里勾选：相册（选择照片）、摄像头（拍照）、选中的文件（学习计划「上传附件」从聊天记录里选文件）。
4. 类目建议选「教育 → 在线教育」或「工具 → 效率」。

## 和 App 的差别

| 方面 | App | 小程序 |
| --- | --- | --- |
| 本机存储 | IndexedDB | 本地缓存（文件夹信息、每张试卷的电子版各一个 key）+ 用户目录下的照片文件 |
| 登录 | Apple / 游客 | 先浏览后登录：不登录也能打开各页面；扫描、导出、擦除、改资料时才弹「登录后才能…」（`lib/auth.ts` 的 `ensureLogin`），微信一键登录（`POST /api/auth/wechat`），没配 AppID 时退回游客 |
| 公式 | KaTeX 排版 | 换成可读文字（x²、√3、1/2、∠、≤…），看不清的字仍是红色「未识别」 |
| 排序 / 删除 | 按住拖动、左滑删除 | 长按卡片 → 上移 / 下移 / 重命名 / 删除 |
| 导出 | 系统分享面板 | 打开 PDF 预览，右上角转发给好友、打印或保存 |
| 学习计划的转发 | 系统分享面板发落地页链接，同学点开后唤起 App 加入 | 小程序自己的转发卡片（`lib/plans.ts` 的 `sharePayload`，封面是自己画的，不带任何同学信息），同学点卡片直接进 `pages/plan-join` 登录并自动加入，不用装 App、不用开放平台账号。微信规定转发必须由用户点原生转发按钮触发，所以布置完会弹一块「转发到微信」，不能自动拉起 |
| 学习计划的附件 | 从手机文件里选 | 小程序读不到手机文件，「上传附件」从微信聊天记录里选（`chooseMessageFile`）；PDF / Word 用微信自带的文档预览打开，右上角转发、打印 |
| 底部导航 | 原生 TabBar + 中间拍照按钮 | 自定义 tabBar（`src/custom-tab-bar`），外观和 App 一样，中间相机按钮弹出拍照 / 相册 |

界面（配色、卡片、首页、错题榜、导出范围、原题空白卷、拍照确认旋转、我的导出）和 App 对齐，配色在 `lib/theme.ts` 和 `app.scss`。

## 目录

```
src/
  app.ts / app.config.ts / app.scss   入口、页面与 tabBar、全局样式（App 的配色和组件样式）
  custom-tab-bar/   自定义底部导航（首页 / 试卷 / 错题榜 / 我的 + 拍照按钮）
  lib/
    store.ts    文件夹 / 试卷 / 照片的本机存储
    jobs.ts     压缩切图、提交扫描、轮询任务、AI 补判
    capture.ts  拍照 / 相册 → 建试卷 → 扫描；重拍
    export.ts   错题本 / 电子试卷 / 空白卷 PDF（服务器后台生成，我的导出）
    erase.ts    擦除手写（原题空白卷的插图）
    confirm.ts  拍照后确认、旋转
    insights.ts ranks.ts   首页统计、错题榜排名（从 app/src 移植）
    logic.ts errors.ts format.ts types.ts   与 App 相同的判分、错题汇总规则（从 app/src 移植）
    math.ts     LaTeX → 文字
    plans.ts    学习计划：接口、文件直传、识别 / 批改结果回填、转发卡片（和 app/src/lib/plans.ts 同一套规则）
    api.ts auth.ts hooks.ts
  components/   ui.tsx（学科方块、标签、面板…）、ErrorCard、ExportSheet、Buddy、Insights、AddSheet、PrintSheets、plan.tsx（学习计划共用：扫描面板、起名字、题号格、转发按钮）
  pages/        home（首页）、papers（试卷）、rank（错题榜）、profile（我的）、login、folder、paper、
                erase（原题空白卷）、rank-detail、confirm（拍照确认）、exports（我的导出）、settings、privacy、account、
                plans（学习计划列表）、plan-new（新建 / 布置）、plan（计划页）、plan-task（作业页）、plan-review（批阅）、plan-join（点卡片加入）
```

`logic.ts`、`errors.ts`、`format.ts`、`insights.ts`、`ranks.ts` 来自 App 的同名逻辑。改判分或错题规则时，两边一起改。
