// 把一条片子渲染成竖屏 MP4：esbuild 打包 → 无头浏览器逐帧截图 → ffmpeg 编码并合上配乐。
// 用法：node render.mjs <片名> [--fps 30] [--scale 2] [--out out/x.mp4] [--workers 4]
//       node render.mjs <片名> --stills 1.5,9.2,22   只截几帧看画面（存到 out/stills/）
//       node render.mjs <片名> --serve                只打包并起本地预览
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const film = args.find((a) => !a.startsWith("--")) || "overview";
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const FPS = Number(opt("--fps", 30));
const SCALE = Number(opt("--scale", 2));
const WORKERS = Number(opt("--workers", 4));
const OUT = resolve(opt("--out", join(ROOT, "out", `${film}.mp4`)));
const DIST = join(ROOT, "dist");

await build({
  entryPoints: [join(ROOT, "src/main.js")],
  bundle: true,
  outdir: DIST,
  format: "iife",
  target: "chrome120",
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "fonts/[name]",
  logLevel: "warning",
});
copyFileSync(join(ROOT, "src/index.html"), join(DIST, "index.html"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = resolve(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(args.includes("--serve") ? 4173 : 0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
if (args.includes("--serve")) { console.log(`预览：${base}/?film=${film}（加 &t=20 从第 20 秒开始）`); await new Promise(() => {}); }

const { chromium } = require("playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: SCALE });
const open = async () => {
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.error("页面报错：", e.message); process.exitCode = 1; });
  await page.goto(`${base}/?film=${film}&render=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
};

try {
  const first = await open();
  const meta = await first.evaluate(() => window.__film);

  if (args.includes("--stills")) {
    const dir = join(ROOT, "out", "stills");
    mkdirSync(dir, { recursive: true });
    for (const t of opt("--stills", "1").split(",").map(Number)) {
      await first.evaluate((tt) => window.__seek(tt), t);
      await first.screenshot({ path: join(dir, `${film}-${t.toFixed(2).padStart(5, "0")}.png`) });
    }
    console.log(`截好了：${dir}`);
  } else {
    const frames = join(ROOT, ".frames", film);
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const total = Math.round(meta.duration * FPS);
    const pages = [first, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, open)))];
    let next = 0, done = 0;
    const t0 = Date.now();
    await Promise.all(pages.map(async (page) => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        await page.evaluate((tt) => window.__seek(tt), i / FPS);
        await page.screenshot({ path: join(frames, `${String(i).padStart(5, "0")}.png`) });
        if (++done % 150 === 0) console.log(`${done}/${total} 帧，${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
      }
    }));
    // 配乐：没有现成的就先合成
    const wav = join(ROOT, "out", `${film}.wav`);
    if (!existsSync(wav) || args.includes("--music")) {
      const r = spawnSync(process.execPath, [join(ROOT, "audio/build.mjs"), film], { stdio: "inherit" });
      if (r.status !== 0) throw new Error("配乐合成失败");
    }
    mkdirSync(dirname(OUT), { recursive: true });
    const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "%05d.png"), "-i", wav,
      "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", OUT], { stdio: "inherit" });
    if (ff.status !== 0) throw new Error("ffmpeg 编码失败");
    writeFileSync(OUT.replace(/\.mp4$/, ".json"), JSON.stringify({ film: meta.id, title: meta.title, duration: meta.duration, fps: FPS, width: 540 * SCALE, height: 960 * SCALE }, null, 2));
    console.log(`完成：${OUT}（${540 * SCALE}×${960 * SCALE}，${meta.duration} 秒，${FPS} 帧/秒，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  }
} finally {
  await browser.close();
  server.close();
}
