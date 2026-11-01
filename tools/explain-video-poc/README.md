# 动画讲解视频 · 技术验证（PoC）

这一版由模型直接写 three.js 代码，渲染出来是竖屏 1080×1920、无声的视频。方案说明见 项目共享文件夹里的 `reports/动画讲解视频方案.md`。

## 目录

| 文件 | 作用 |
|---|---|
| `prompt.md` | 给 claude-opus-5-5 的 system prompt，写明代码接口、坐标、硬规则和讲题要求 |
| `generate.py` | 通过 tu-zi 调模型拿到代码，然后自动检查。检查不通过就把问题发回模型修，最多修 2 轮，通过后渲染成 MP4，并记录 token 和耗时 |
| `render.mjs` | 用 Playwright 驱动无头 Chromium 逐帧渲染，再交给 ffmpeg 编码成 MP4。`--check` 只做检查 |
| `runtime/` | 运行环境，包括 three.js、中文字体（思源黑体）、LaTeX 公式（MathJax 输出 SVG 后转成贴图），以及标题栏、字幕栏、进度条和「AI 生成」角标 |
| `questions/` | 5 道测试题：鸡兔同笼、分数比大小、三角形内角和（知识点）、二次函数顶点、英语过去进行时 |
| `samples/chicken-rabbit.js` | 样例代码，用来验证管线（说明见下） |
| `out/` | 样例渲染结果：MP4、封面、讲解词 JSON、关键帧拼图 |

## 运行

```bash
npm install
npx playwright install chromium        # 本机没有 Chromium 时
pip install "anthropic>=0.80"

# 只渲染现成的代码
node render.mjs samples/chicken-rabbit.js --out out/chicken-rabbit.mp4

# 让模型写代码，经过检查和修复后渲染（需要 tu-zi 的 key）
# 没设环境变量时自动读取 server/.env 里的 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
export ANTHROPIC_API_KEY=sk-...  ANTHROPIC_BASE_URL=https://api.tu-zi.com
python3 generate.py questions/*.json
```

## 已验证的部分（云端容器，4 核，无 GPU，软件渲染）

- 鸡兔同笼的样例视频 64 秒，共 1920 帧，**每帧 85ms，渲染加编码共 2 分 46 秒**，文件 1.1MB。
- 检查器能发现：运行报错、render 出错、文字或公式超出舞台、压到标题栏或字幕栏、文字互相重叠、画面空白、字幕时长不够读，以及代码用了 requestAnimationFrame。
- 渲染环境锁死了时间和随机数（`performance.now`、`Date.now`、`Math.random`），只允许请求本机，其他网络请求一律拒绝。

## 还没验证的部分

这个容器的网络策略不允许访问 api.tu-zi.com，所以**还没有真正经过 tu-zi 调用 claude-opus-5-5**。`samples/chicken-rabbit.js` 是这个会话里的 Claude 按 `prompt.md` 的接口手写的，作用是验证运行环境、检查器和渲染管线能跑通。它不能代表线上模型首次生成的通过率和画面质量，这两项要用 `generate.py` 跑完 5 道测试题之后才知道。
