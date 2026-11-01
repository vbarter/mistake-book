/** 讲解动画运行环境（服务端渲染 / 以后 App 内播放共用）。
 *
 * 模型写的代码是一个 ES module：export default async function create(kit) { ...; return { title, duration, scenes, render(t) } }
 * - kit 提供 THREE、场景、相机、中文文字与 LaTeX 公式（贴图）、缓动函数、配色。
 * - render(t) 必须是「按时间直接算状态」的纯函数：可以任意跳帧，不能依赖上一帧。
 * 画面是竖屏 9:16，世界坐标宽 9、高 16，原点在中心。顶部标题栏、底部字幕栏、进度条、「AI 生成」角标由这里画，模型只管舞台区域。
 */
import * as THREE from "three";

const W = 9, H = 16;
const STAGE = { left: -4.3, right: 4.3, top: 6.2, bottom: -5.5 };
const FONT = '"Noto Sans SC", "WenQuanYi Zen Hei", sans-serif';
const COLORS = {
  bg: "#FBF7EE", ink: "#2D3047", navy: "#1F3B73", wine: "#8B1E3F", gold: "#E8A33D",
  green: "#3A9D6B", blue: "#3B7DD8", red: "#D64545", gray: "#9AA0AE", paper: "#FFFFFF", light: "#E9E4D8",
};

const params = new URLSearchParams(location.search);
const PX_W = Number(params.get("w") || 1080);
const PX_H = Math.round(PX_W * H / W);
const PX_PER_UNIT = PX_W / W;

// ---------------------------------------------------------------- 确定性：时间、随机数都由渲染器控制
let NOW = 0;
performance.now = () => NOW * 1000;
Date.now = () => 1767225600000 + NOW * 1000;
let seed = 20261101;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rafWarn = [];
window.requestAnimationFrame = () => { rafWarn.push("代码调用了 requestAnimationFrame（不会触发，动画必须写在 render(t) 里）"); return 0; };

const errors = [];
window.addEventListener("error", (e) => errors.push(`运行错误：${e.message}`));
window.addEventListener("unhandledrejection", (e) => errors.push(`未处理的 Promise 错误：${e.reason && (e.reason.stack || e.reason.message || e.reason)}`));

// ---------------------------------------------------------------- 渲染器
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(PX_W, PX_H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 实物感场景要用：阴影、色调映射（模型可以改 renderer.toneMapping）
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const ortho = (near = -100, far = 100) => new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, near, far);
let camera = ortho();
camera.position.z = 10;
const ui = new THREE.Scene();
// hud：文字 / 公式 / 计数器这类平面信息层，永远用 9×16 正交坐标，叠在 3D 场景之上（3D 场景可以用透视相机）
const hud = new THREE.Scene();
const uiCam = ortho();
uiCam.position.z = 10;

// ---------------------------------------------------------------- 文字与公式（贴图平面）
function planeFromCanvas(cv, widthUnits, kind, extra = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const h = widthUnits * cv.height / cv.width;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthUnits, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.userData = { kind, width: widthUnits, height: h, ...extra };
  return mesh;
}

function wrapLines(ctx, text, maxPx) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxPx) { out.push(line); line = ch.trim() ? ch : ""; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** 中文文字。size = 字高（世界单位，0.45 左右是正文）；返回的平面以中心为锚点（align 改变锚点）。 */
async function text(str, opts = {}) {
  const { size = 0.45, color = COLORS.ink, weight = 400, align = "center", maxWidth = 8.2, lineHeight = 1.35, bg = null, padding = 0 } = opts;
  const fontPx = Math.round(size * PX_PER_UNIT);
  const font = `${weight} ${fontPx}px ${FONT}`;
  await document.fonts.load(font, String(str));
  const cv = document.createElement("canvas");
  let ctx = cv.getContext("2d");
  ctx.font = font;
  const lines = wrapLines(ctx, str, maxWidth * PX_PER_UNIT);
  const padPx = Math.round(padding * PX_PER_UNIT);
  const wPx = Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width))) + padPx * 2 + 4;
  const hPx = Math.ceil(lines.length * fontPx * lineHeight) + padPx * 2 + 4;
  cv.width = wPx; cv.height = hPx;
  ctx = cv.getContext("2d");
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 0, 0, wPx, hPx, Math.min(hPx / 2, fontPx * 0.6)); ctx.fill(); }
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = "middle";
  ctx.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
  const x = align === "left" ? padPx + 2 : align === "right" ? wPx - padPx - 2 : wPx / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, padPx + 2 + fontPx * lineHeight * (i + 0.5)));
  const mesh = planeFromCanvas(cv, wPx / PX_PER_UNIT, "text", { text: String(str) });
  if (align === "left") mesh.geometry.translate(mesh.userData.width / 2, 0, 0);
  if (align === "right") mesh.geometry.translate(-mesh.userData.width / 2, 0, 0);
  return mesh;
}

/** LaTeX 公式（MathJax → SVG → 贴图）。size = 公式字高（世界单位）。 */
async function tex(latex, opts = {}) {
  const { size = 0.55, color = COLORS.ink } = opts;
  await MathJax.startup.promise;
  const node = await MathJax.tex2svgPromise(latex, { display: true });
  const svg = node.querySelector("svg");
  if (!svg) throw new Error(`公式无法解析：${latex}`);
  if (svg.querySelector("[data-mjx-error]")) throw new Error(`公式有错误：${latex}（${svg.querySelector("[data-mjx-error]").getAttribute("data-mjx-error")}）`);
  const fontPx = size * PX_PER_UNIT;
  const exPx = fontPx * 0.5;
  const wPx = Math.ceil(parseFloat(svg.getAttribute("width")) * exPx) + 4;
  const hPx = Math.ceil(parseFloat(svg.getAttribute("height")) * exPx) + 4;
  svg.setAttribute("width", wPx); svg.setAttribute("height", hPx);
  svg.setAttribute("color", color); svg.style.color = color;
  const xml = new XMLSerializer().serializeToString(svg).replaceAll("currentColor", color);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = wPx; cv.height = hPx;
  cv.getContext("2d").drawImage(img, 0, 0, wPx, hPx);
  return planeFromCanvas(cv, wPx / PX_PER_UNIT, "tex", { text: latex });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** 设置整个物体（含子物体）的不透明度 0–1 */
function fade(obj, a) {
  obj.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.userData.base === undefined) m.userData.base = m.opacity;
      m.transparent = true;
      m.opacity = m.userData.base * a;
    }
  });
  obj.visible = a > 0.001;
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const ease = {
  smooth: (x) => x * x * (3 - 2 * x),
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  pulse: (x) => Math.sin(Math.PI * clamp(x)),
};

const kit = {
  THREE, scene, W, H, STAGE, COLORS, FONT,
  get camera() { return camera; },
  useCamera(c) { camera = c; },
  hud, renderer,
  text, tex, fade, clamp, seg, lerp, ease,
  color: (c) => new THREE.Color(c),
};

// ---------------------------------------------------------------- 标题栏 / 字幕栏 / 进度条
let spec = null;
const captionMeshes = [];
let progress = null;

async function buildUI() {
  ui.clear();
  const top = await text("知错本 · 动画讲解", { size: 0.28, color: COLORS.gray, weight: 700 });
  top.position.set(0, 7.45, 0); ui.add(top);
  const title = await text(spec.title || "", { size: 0.46, color: COLORS.navy, weight: 700, maxWidth: 8.2 });
  title.position.set(0, 6.85 - Math.max(0, title.userData.height - 0.7) / 2, 0); ui.add(title);
  const ai = await text("AI 生成", { size: 0.22, color: "#FFFFFF", bg: "rgba(45,48,71,0.45)", padding: 0.08 });
  ai.position.set(W / 2 - 0.15 - ai.userData.width / 2, H / 2 - 0.2 - ai.userData.height / 2, 1); ui.add(ai);
  const band = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.3), new THREE.MeshBasicMaterial({ color: COLORS.navy }));
  band.position.set(0, -H / 2 + 1.15, -1); ui.add(band);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 0.06), new THREE.MeshBasicMaterial({ color: "#4B6396" }));
  track.position.set(0, -7.7, 0); ui.add(track);
  progress = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 0.06), new THREE.MeshBasicMaterial({ color: COLORS.gold }));
  progress.geometry.translate(4.1, 0, 0); progress.position.set(-4.1, -7.7, 0.1); ui.add(progress);
  captionMeshes.length = 0;
  for (const s of spec.scenes) {
    const m = await text(s.caption || "", { size: 0.4, color: "#FFFFFF", weight: 700, maxWidth: 8.2, lineHeight: 1.4 });
    m.position.set(0, -6.75, 0); m.visible = false; ui.add(m); captionMeshes.push(m);
  }
}

function sceneIndexAt(t) {
  const i = spec.scenes.findIndex((s) => t >= s.from && t < s.to);
  return i >= 0 ? i : t >= spec.duration ? spec.scenes.length - 1 : 0;
}

function draw(t) {
  NOW = t;
  try { spec.render(t); } catch (e) { errors.push(`render(${t.toFixed(2)}) 出错：${e.stack || e.message}`); throw e; }
  const idx = sceneIndexAt(t);
  captionMeshes.forEach((m, i) => {
    const s = spec.scenes[i];
    const a = Math.min(seg(t, s.from, s.from + 0.3), 1 - seg(t, s.to - 0.2, s.to));
    m.visible = i === idx; fade(m, i === idx ? Math.max(a, i === spec.scenes.length - 1 && t >= s.to ? 1 : 0) : 0);
  });
  progress.scale.x = Math.max(0.0001, clamp(t / spec.duration));
  renderer.setClearColor(COLORS.bg, 1);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(hud, uiCam);
  renderer.clearDepth();
  renderer.render(ui, uiCam);
}

// ---------------------------------------------------------------- 给渲染器调用的接口
window.__load = async (code) => {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const mod = await import(url);
  if (typeof mod.default !== "function") throw new Error("模块没有 export default async function create(kit)");
  const s = await mod.default(kit);
  const problems = [];
  if (!s || typeof s.render !== "function") problems.push("create(kit) 没有返回 render(t)");
  if (!(s.duration >= 15 && s.duration <= 180)) problems.push(`duration=${s && s.duration}，必须在 15–180 秒之间`);
  if (!Array.isArray(s.scenes) || !s.scenes.length) problems.push("scenes 必须是非空数组");
  else {
    s.scenes.forEach((sc, i) => {
      if (!(sc.to > sc.from)) problems.push(`scenes[${i}] 的 to 必须大于 from`);
      if (i && Math.abs(sc.from - s.scenes[i - 1].to) > 0.05) problems.push(`scenes[${i}] 和上一幕时间不衔接`);
      if ((sc.caption || "").length > 40) problems.push(`scenes[${i}].caption 超过 40 字`);
      const minDur = 2 + (sc.caption || "").length / 5;
      if (sc.to - sc.from < minDur) problems.push(`scenes[${i}] 只有 ${(sc.to - sc.from).toFixed(1)} 秒，字幕读不完（至少 ${minDur.toFixed(1)} 秒）`);
    });
    if (Math.abs(s.scenes[s.scenes.length - 1].to - s.duration) > 0.05) problems.push("最后一幕的 to 必须等于 duration");
  }
  if (problems.length) throw new Error(problems.join("；"));
  spec = s;
  await buildUI();
  return { title: s.title, duration: s.duration, scenes: s.scenes.map(({ from, to, caption, narration }) => ({ from, to, caption, narration })) };
};

window.__seek = (t) => { draw(t); return true; };
window.__frame = (t, quality = 0.92) => { draw(t); return canvas.toDataURL("image/jpeg", quality).slice(23); };

/** 检查某一时刻：出画、和字幕栏 / 标题栏重叠、文字互相遮挡、画面空白 */
window.__check = (t) => {
  draw(t);
  const issues = [];
  const boxes = [];
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const alpha = (o) => (o.material && o.material.transparent ? o.material.opacity : 1);
  scene.updateMatrixWorld(true);
  hud.updateMatrixWorld(true);
  // 正交相机下 3D 场景里的文字也按世界坐标检查；透视相机下只检查 hud 层
  const layers = camera.isOrthographicCamera ? [scene, hud] : [hud];
  for (const layer of layers) layer.traverse((o) => {
    if (!o.isMesh || !o.userData.kind || !shown(o) || alpha(o) < 0.3) return;
    const b = new THREE.Box3().setFromObject(o);
    const sz = b.getSize(new THREE.Vector3());
    if (sz.x < 0.05 || sz.y < 0.05) return;
    const label = `${o.userData.kind === "tex" ? "公式" : "文字"}「${o.userData.text.slice(0, 16)}」`;
    const tol = 0.08;
    if (b.min.x < STAGE.left - tol || b.max.x > STAGE.right + tol) issues.push(`${label} 左右超出舞台（x ${b.min.x.toFixed(2)}–${b.max.x.toFixed(2)}，舞台 ${STAGE.left}–${STAGE.right}）`);
    if (b.max.y > STAGE.top + tol) issues.push(`${label} 压到顶部标题栏（上沿 y=${b.max.y.toFixed(2)}，舞台上沿 ${STAGE.top}）`);
    if (b.min.y < STAGE.bottom - tol) issues.push(`${label} 压到底部字幕栏（下沿 y=${b.min.y.toFixed(2)}，舞台下沿 ${STAGE.bottom}）`);
    boxes.push({ b, label });
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].b, c = boxes[j].b;
    const ix = Math.min(a.max.x, c.max.x) - Math.max(a.min.x, c.min.x);
    const iy = Math.min(a.max.y, c.max.y) - Math.max(a.min.y, c.min.y);
    if (ix <= 0 || iy <= 0) continue;
    const area = (bb) => (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y);
    if ((ix * iy) / Math.min(area(a), area(c)) > 0.2) issues.push(`${boxes[i].label} 和 ${boxes[j].label} 重叠`);
  }
  // 舞台区域是否几乎空白（只有背景色）
  const small = document.createElement("canvas"); small.width = 45; small.height = 80;
  const sctx = small.getContext("2d"); sctx.drawImage(canvas, 0, 0, 45, 80);
  const px = sctx.getImageData(0, 12, 45, 50).data;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { const l = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]; sum += l; sum2 += l * l; n++; }
  const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
  if (sd < 2) issues.push("舞台几乎是空白的");
  return issues;
};
window.__errors = () => [...errors, ...new Set(rafWarn)];
window.__ready = true;
