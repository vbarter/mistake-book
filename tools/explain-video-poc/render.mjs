// 把模型写的 three.js 讲解动画渲染成竖屏 MP4，或只做检查。
// 用法：node render.mjs <scene.js> [--out out.mp4] [--check] [--w 1080] [--fps 30]
// 检查模式输出 JSON：{ ok, errors[], issues[], meta }，生成脚本据此让模型修代码。
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const scenePath = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const CHECK = args.includes("--check");
const WIDTH = Number(opt("--w", 1080));
const FPS = Number(opt("--fps", 30));
const OUT = opt("--out", scenePath.replace(/\.js$/, "") + ".mp4");
const code = readFileSync(scenePath, "utf8");

// 只在本机回环上提供运行环境需要的静态文件（three、MathJax、字体、harness）
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = resolve(join(ROOT, p));
  const allowed = file.startsWith(join(ROOT, "runtime")) || file.startsWith(join(ROOT, "node_modules"));
  if (!allowed || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const t0 = Date.now();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
// 沙箱：除了本机运行环境，所有网络请求一律拒绝
await page.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

const result = { ok: false, errors: [], issues: [], meta: null, timing: {} };
try {
  await page.goto(`${base}/runtime/index.html?w=${WIDTH}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  result.meta = await page.evaluate((c) => window.__load(c), code);
  result.timing.loadMs = Date.now() - t0;

  // 每一幕抽 3 个时刻检查
  const times = [];
  for (const s of result.meta.scenes) {
    const d = s.to - s.from;
    times.push(s.from + Math.min(0.6, d * 0.2), s.from + d * 0.55, s.to - Math.min(0.25, d * 0.1));
  }
  for (const t of times) {
    const issues = await page.evaluate((tt) => window.__check(tt), t);
    for (const i of issues) result.issues.push(`t=${t.toFixed(1)}s：${i}`);
  }
  result.issues = [...new Set(result.issues)];

  if (!CHECK) {
    const frames = Math.round(result.meta.duration * FPS);
    mkdirSync(dirname(resolve(OUT)), { recursive: true });
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
    // ffmpeg 提前退出（打不开输出文件等）时立刻报错，不要一直等写入
    const ffDone = new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error("ffmpeg exit " + c)))));
    let ffFailed = null;
    ffDone.catch((e) => { ffFailed = e; });
    ff.stdin.on("error", () => {});
    const tr = Date.now();
    for (let i = 0; i < frames; i++) {
      if (ffFailed) throw ffFailed;
      const b64 = await page.evaluate((t) => window.__frame(t), i / FPS);
      if (!ff.stdin.write(Buffer.from(b64, "base64"))) await Promise.race([new Promise((r) => ff.stdin.once("drain", r)), ffDone]);
    }
    ff.stdin.end();
    await ffDone;
    result.timing.frames = frames;
    result.timing.renderMs = Date.now() - tr;
    result.timing.msPerFrame = Math.round((Date.now() - tr) / frames);
    // 封面：第二幕中间
    const s = result.meta.scenes[Math.min(1, result.meta.scenes.length - 1)];
    const poster = await page.evaluate((t) => window.__frame(t, 0.9), (s.from + s.to) / 2);
    writeFileSync(OUT.replace(/\.mp4$/, ".jpg"), Buffer.from(poster, "base64"));
    writeFileSync(OUT.replace(/\.mp4$/, ".json"), JSON.stringify(result.meta, null, 2));
    result.out = OUT;
  }
} catch (e) {
  result.errors.push(String(e && e.message || e).split("\n").slice(0, 6).join("\n"));
}
try { result.errors.push(...(await page.evaluate(() => window.__errors ? window.__errors() : []))); } catch {}
result.errors.push(...consoleErrors.filter((m) => !result.errors.some((e) => e.includes(m))));
result.errors = [...new Set(result.errors)];
result.ok = result.errors.length === 0 && result.issues.length === 0;
result.timing.totalMs = Date.now() - t0;
await browser.close();
server.close();
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 2 : 0);
