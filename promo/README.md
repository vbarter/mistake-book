# 上壹课 · 功能宣传视频

用代码生成的小程序宣传视频。这个目录自成一体，不参与小程序、App、服务端的构建。

## 怎么做出来的

- **画面**：每一幕是一段 HTML/CSS，所有动画都写成「时间 t 的函数」（`src/engine.js`），不用 CSS 动画和定时器，所以每一帧都能精确复现。
- **渲染**：`render.mjs` 用 esbuild 打包，起一个本机服务，无头 Chromium 逐帧 `seek → 截图`，再交给 ffmpeg 编成 H.264 并合上配乐。
- **配乐**：`audio/synth.mjs` 是一套很小的软件合成器（振荡器、包络、滤波、混响、延迟），`audio/*.score.mjs` 是谱子。全部由代码算出采样，没有用任何录音或采样素材，原创，可以商用。
- **和小程序保持一致**：颜色、圆角、字号照 `miniprogram/src/app.scss`；彩色图标直接引用 `miniprogram/src/lib/colorIcons.ts`；吉祥物「试卷小人」是 `components/Buddy.tsx` 的同一张 SVG。小程序改了图标，重新渲染就会跟着变。
- **字体**：思源黑体（Noto Sans SC，SIL OFL 1.1，可商用），通过 `@fontsource/noto-sans-sc` 安装，不依赖系统字体，所以在哪台机器上渲染都一样。

没有用 Remotion：它对 4 人以上的公司要付费授权，还要另外下载一份浏览器；这里的需求（确定性的逐帧渲染）用 Playwright + ffmpeg 一百来行就够了，没有授权问题。

## 用法

需要 Node 20+、ffmpeg、Playwright 的 Chromium。

```bash
cd promo
npm install
npm install --no-save playwright && npx playwright install chromium   # 机器上已经有 Playwright 就跳过

node render.mjs overview                  # 渲染成片 → out/overview.mp4（1080×1920，30 帧/秒）
node render.mjs overview --music          # 改了谱子后，重新合成配乐再渲染
node render.mjs overview --stills 9.6,23.8  # 只截几帧看画面 → out/stills/
node render.mjs overview --serve          # 浏览器里实时预览 http://127.0.0.1:4173/?film=overview&t=20
node audio/build.mjs overview             # 只合成配乐 → out/overview.wav
sh sheet.sh overview 9.6,23.8,34.8        # 截几帧拼成一张图
```

`--scale 1` 出 540×960 的小样，快四倍左右；`--workers` 调并行的页面数。4 核云主机上渲染 46 秒的成片大约 20 分钟（画面里的模糊和投影在没有显卡的机器上比较慢），有显卡的电脑会快很多。

## 目录

```
src/engine.js              时间轴工具：缓动、弹簧、逐字进场、分幕与圆形转场
src/brand.js               品牌色、图标、吉祥物、标志
src/parts.js               手机外壳、状态栏、底部导航、示意试卷、首页、每幕标题
src/styles.css             画布 540×960（2 倍渲染），界面样式照小程序
src/films/overview.js      总览片的九幕
src/films/overview.timing.js  时间表和音效时刻，画面和配乐共用
audio/synth.mjs            合成器
audio/overview.score.mjs   总览片的配乐
render.mjs                 渲染器
```

## 片单

| # | 片名 | 时长 | 内容 | 状态 |
|---|------|------|------|------|
| 0 | 总览片《46 秒看懂上壹课》 | 46 秒 | 提问 → 品牌 → 拍照收集 → AI 还原批改 → 错题榜 → 试卷擦除 → 导出错题本 → 学习计划 → 落版 | 已完成 |
| 1 | 拍照收集 | 约 18 秒 | 自动框选、自动拍、多页连拍、相册导入、几张合成一份 | 待做 |
| 2 | AI 还原批改 | 约 18 秒 | 后台识别（离开也不影响）、照片变电子试卷、逐题批改、学科和卷名自动识别归档 | 待做 |
| 3 | 错题榜 | 约 18 秒 | 易错题 / 知识点 / 反复错 / 空白四张榜、易错指数、详情左右滑、每周错题 | 待做 |
| 4 | 试卷擦除 | 约 15 秒 | 擦掉作答和批改、原题空白卷、导出 PDF 再做一遍 | 待做 |
| 5 | 导出错题本 | 约 15 秒 | 按知识点排好带目录、左边重做右边解析、只导新增的 | 待做 |
| 6 | 学习计划 | 约 20 秒 | 老师布置作业、微信卡片一键加入、拍照就交、批改结果回填、已阅或退回 | 待做 |

单功能短片复用总览片里的画面零件，把对应那一幕展开讲细。

## 加一条新片

1. `src/films/<名字>.js` 导出 `build(root)`，用 `makeScene` 一幕一幕加，返回 `{ id, title, duration, render(t) }`；在 `src/main.js` 的 `FILMS` 里登记。
2. `src/films/<名字>.timing.js` 写时间表；`audio/<名字>.score.mjs` 写配乐，默认导出一个返回 `master(...)` 结果的函数。
3. `node render.mjs <名字>`。

## 说明

- 界面是按小程序页面重画的示意，不是真机录屏；里面的试卷、姓名、题目、数字都是为视频编的例子。
- 文案只写了小程序里真实有的功能，改文案时请对照 `miniprogram/src/pages`。
