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
2. **AppID / AppSecret** 写进服务器 `.env`（不要提交到仓库），然后重启服务（已配好）：
   ```
   WX_APPID=wx...
   WX_SECRET=...
   ```
   没配的时候，「微信一键登录」会自动退回游客账号，功能都能用，只是换手机后账号不通。
3. 用户隐私保护指引里勾选：相册（选择照片）、摄像头（拍照）。
4. 类目建议选「教育 → 在线教育」或「工具 → 效率」。

## 和 App 的差别

| 方面 | App | 小程序 |
| --- | --- | --- |
| 本机存储 | IndexedDB | 本地缓存（文件夹信息、每张试卷的电子版各一个 key）+ 用户目录下的照片文件 |
| 登录 | Apple / 游客 | 微信一键登录（`POST /api/auth/wechat`），没配 AppID 时退回游客 |
| 公式 | KaTeX 排版 | 换成可读文字（x²、√3、1/2、∠、≤…），看不清的字仍是红色「未识别」 |
| 排序 / 删除 | 按住拖动、左滑删除 | 长按卡片 → 上移 / 下移 / 重命名 / 删除 |
| 导出 | 系统分享面板 | 打开 PDF 预览，右上角转发给好友、打印或保存 |
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
    api.ts auth.ts hooks.ts
  components/   ui.tsx（学科方块、标签、面板…）、ErrorCard、ExportSheet、Buddy、Insights、AddSheet、PrintSheets
  pages/        home（首页）、papers（试卷）、rank（错题榜）、profile（我的）、login、folder、paper、
                erase（原题空白卷）、rank-detail、confirm（拍照确认）、exports（我的导出）、settings、privacy、account
```

`logic.ts`、`errors.ts`、`format.ts`、`insights.ts`、`ranks.ts` 来自 App 的同名逻辑。改判分或错题规则时，两边一起改。
