/**
 * 找试卷四边：在一帧缩小的画面里找出纸的四个角。纯计算，不依赖 DOM，相机取景（每秒约 8 次）和「重新识别」都用它。
 *
 * 做法：灰度 → 模糊 → Sobel 边缘 → 自适应阈值 → 膨胀补断线 → 从画面四周往里灌水，
 * 灌不进去的最大一块封闭区域就是纸；取它的外轮廓找面积最大的四边形。
 * 边缘法找不到（纸和桌面颜色接近、边断了）时再按亮度找：纸一般比桌面亮。
 * 找到的框要过几道检查（够大、是凸四边形、角度不怪、区域基本填满四边形），不像纸的一律当作没找到。
 */

export type Pt = [number, number];
/** 四个角，顺序固定：左上、右上、右下、左下 */
export type Quad = [Pt, Pt, Pt, Pt];

/** 取景时检测用的帧长边（像素） */
export const DETECT_SIDE = 240;

/** RGBA 像素 → 灰度 */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return out;
}

/** 3×3 均值模糊 */
function blur(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < w - 1 ? x + 1 : x;
      const s =
        src[y0 * w + x0] + src[y0 * w + x] + src[y0 * w + x1] +
        src[y * w + x0] + src[y * w + x] + src[y * w + x1] +
        src[y1 * w + x0] + src[y1 * w + x] + src[y1 * w + x1];
      out[y * w + x] = (s / 9) | 0;
    }
  }
  return out;
}

/** 大津阈值：按直方图找把两类分得最开的阈值 */
function otsu(hist: Uint32Array | number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** 饱和度（max − min）：白纸接近 0，木桌、彩色桌布更高。纸和桌面亮度差不多时靠它分开 */
function toSat(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    out[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return out;
}

function sobel(g: Uint8Array, i: number, w: number): number {
  const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
  const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
  return Math.abs(gx) + Math.abs(gy);
}

/** 边缘图：亮度和饱和度的 Sobel 幅值取大，过自适应阈值；thick 再膨胀一圈补上断开的边 */
function edgeMask(g: Uint8Array, w: number, h: number, sat?: Uint8Array): { raw: Uint8Array; thick: Uint8Array } {
  const mag = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let m = sobel(g, i, w);
      if (sat) m = Math.max(m, sobel(sat, i, w) * 1.5);
      m = Math.min(255, m >> 2);
      mag[i] = m;
      hist[m]++;
    }
  }
  const thr = Math.max(10, Math.round(otsu(hist, (w - 2) * (h - 2)) * 0.6));
  const edge = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) if (mag[i] >= thr) edge[i] = 1;
  // 膨胀：3×3
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && edge[yy * w + xx]) { on = 1; break; }
        }
      }
      out[y * w + x] = on;
    }
  }
  return { raw: edge, thick: out };
}

/** 从画面四周灌水：wall 为 1 的像素挡水。返回灌到的（背景）标记 */
function floodFromBorder(wall: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i: number) => {
    if (!seen[i] && !wall[i]) {
      seen[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return seen;
}

/** 选中像素里最大的四连通块：返回每行最左、最右的 x（没有为 -1）和块的面积 */
function largestBlob(on: Uint8Array, w: number, h: number): { left: Int32Array; right: Int32Array; area: number; touches: number } | null {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestArea = 0;
  let bestLabel = 0;
  let next = 1;
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || label[s]) continue;
    const id = next++;
    let sp = 0;
    let area = 0;
    label[s] = id;
    stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && on[j] && !label[j]) {
          label[j] = id;
          stack[sp++] = j;
        }
      }
    }
    if (area > bestArea) {
      bestArea = area;
      bestLabel = id;
    }
  }
  if (!bestLabel) return null;
  const left = new Int32Array(h).fill(-1);
  const right = new Int32Array(h).fill(-1);
  let touches = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== bestLabel) continue;
      if (left[y] < 0) left[y] = x;
      right[y] = x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches++;
    }
  }
  return { left, right, area: bestArea, touches };
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** 凸包（单调链），逆时针 */
function hull(pts: Pt[]): Pt[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
    if (Math.abs(c) < 1e-9) return false;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** 每个内角都在 50°–130° 之间（俯拍的纸不会更歪） */
function anglesOk(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4];
    const c = q[i];
    const n = q[(i + 1) % 4];
    const ax = p[0] - c[0];
    const ay = p[1] - c[1];
    const bx = n[0] - c[0];
    const by = n[1] - c[1];
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (deg < 50 || deg > 130) return false;
  }
  return true;
}

/** 按左上、右上、右下、左下排好 */
export function orderQuad(q: Pt[]): Quad {
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length;
  const cy = q.reduce((s, p) => s + p[1], 0) / q.length;
  const sorted = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // atan2 从 -π 开始：左上象限的点在最前；找 x+y 最小的作为起点
  let start = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  const r = [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]);
  return r as Quad;
}

/** 8 连通的边缘块：每块返回包围盒和每行最左、最右的 x */
function edgeComponents(on: Uint8Array, w: number, h: number, minW: number, minH: number) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const out: { left: Int32Array; right: Int32Array; area: number; touches: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  let next = 1;
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || label[s]) continue;
    const id = next++;
    let sp = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    label[s] = id;
    stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (on[j] && !label[j]) { label[j] = id; stack[sp++] = j; }
        }
      }
    }
    if (x1 - x0 + 1 < minW || y1 - y0 + 1 < minH) continue;
    const left = new Int32Array(h).fill(-1);
    const right = new Int32Array(h).fill(-1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (label[y * w + x] !== id) continue;
        if (left[y] < 0) left[y] = x;
        right[y] = x;
      }
    }
    out.push({ left, right, area, touches: 0, x0, y0, x1, y1 });
  }
  return out;
}

/** 四条边上有多少落在边缘线上（0–1），返回最弱的一条和平均值。edge 用膨胀过的边缘图，容得下一两个像素的偏差 */
function sideSupport(q: Quad, edge: Uint8Array, w: number, h: number): { min: number; mean: number } {
  let min = 1;
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k];
    const b = q[(k + 1) % 4];
    const n = 32;
    let hit = 0;
    for (let t = 1; t < n; t++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * t) / n);
      const y = Math.round(a[1] + ((b[1] - a[1]) * t) / n);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; // 贴着画面边的不算（纸出画了）
      const i = y * w + x;
      if (edge[i] || edge[i - 1] || edge[i + 1] || edge[i - w] || edge[i + w]) hit++;
    }
    const r = hit / (n - 1);
    min = Math.min(min, r);
    sum += r;
  }
  return { min, mean: sum / 4 };
}

/** 有角压在画面边上：纸多半出画了，不算 */
function touchesBorder(q: Quad, w: number, h: number): boolean {
  return q.some(([x, y]) => x < 1.5 || y < 1.5 || x > w - 1.5 || y > h - 1.5);
}

/** 道格拉斯–普克简化闭合多边形 */
function simplify(poly: Pt[], eps: number): Pt[] {
  if (poly.length <= 4) return poly;
  const dp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let far = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(cross(a, b, pts[i])) / len;
      if (d > far) { far = d; at = i; }
    }
    if (far <= eps) return [a, b];
    return dp(pts.slice(0, at + 1)).slice(0, -1).concat(dp(pts.slice(at)));
  };
  // 从离第一个点最远的点切成两半，各自简化
  let i1 = 0;
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
    if (d > best) { best = d; i1 = i; }
  }
  const first = poly.slice(0, i1 + 1);
  const second = poly.slice(i1).concat([poly[0]]);
  return dp(first).slice(0, -1).concat(dp(second).slice(0, -1));
}

/**
 * 从一块区域（每行左右端点）找最像纸的四边形：取凸包、简化到十几个点，
 * 枚举其中任意四个点组成的四边形，过形状检查，按「面积 × 四边贴着边缘线的程度」打分。
 * 纸边上粘着笔、手指之类的东西时，凸包会多出一个角，枚举能绕开它。
 */
function bestOnBlob(left: Int32Array, right: Int32Array, w: number, h: number, edge: Uint8Array, dbg?: string[]): { q: Quad; score: number } | null {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    if (left[y] < 0) continue;
    pts.push([left[y], y], [right[y] + 1, y]);
  }
  const full = hull(pts);
  let hl = full;
  let eps = 1.2;
  while (hl.length > 14 && eps < 24) { hl = simplify(full, eps); eps *= 1.5; }
  const n = hl.length;
  if (n < 4) return null;
  let best: { q: Quad; score: number } | null = null;
  const minArea = w * h * 0.12;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q: Quad = [hl[a], hl[b], hl[c], hl[d]];
          const area = quadArea(q);
          if (area < minArea || area > w * h * 0.985) continue;
          if (best && area < best.score) continue; // 贴边程度最多是 1，面积不够大就不用再算
          if (!isConvex(q) || !anglesOk(q) || touchesBorder(q, w, h)) continue;
          const sup = sideSupport(q, edge, w, h);
          if (sup.min < 0.5 || sup.mean < 0.7) continue;
          const score = area * sup.mean * sup.mean;
          if (!best || score > best.score) best = { q: orderQuad(q), score };
        }
  dbg?.push(best ? `blob ok area=${(quadArea(best.q) / w / h).toFixed(2)}` : `blob none n=${n}`);
  return best;
}

/** 直线 x·cosθ + y·sinθ = ρ */
interface Line { t: number; r: number; votes: number }

/** 霍夫变换找最长的几条直线（θ 每 2°，ρ 每 2px），做非极大值抑制 */
function houghLines(edge: Uint8Array, w: number, h: number, max: number): Line[] {
  const NT = 90;
  const RS = 2;
  const diag = Math.ceil(Math.hypot(w, h));
  const NR = Math.ceil((2 * diag) / RS) + 1;
  const acc = new Uint16Array(NT * NR);
  const cos = new Float32Array(NT);
  const sin = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    cos[t] = Math.cos((t * Math.PI) / NT);
    sin[t] = Math.sin((t * Math.PI) / NT);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      for (let t = 0; t < NT; t++) {
        const r = Math.round((x * cos[t] + y * sin[t] + diag) / RS);
        acc[t * NR + r]++;
      }
    }
  }
  const minVotes = Math.min(w, h) * 0.25;
  const peaks: Line[] = [];
  for (let t = 0; t < NT; t++) {
    for (let r = 1; r < NR - 1; r++) {
      const v = acc[t * NR + r];
      if (v < minVotes) continue;
      let peak = true;
      for (let dt = -1; dt <= 1 && peak; dt++) {
        const tt = (t + dt + NT) % NT;
        for (let dr = -1; dr <= 1; dr++) {
          if (!dt && !dr) continue;
          if (acc[tt * NR + r + dr] > v) { peak = false; break; }
        }
      }
      if (peak) peaks.push({ t: (t * Math.PI) / NT, r: r * RS - diag, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const out: Line[] = [];
  for (const p of peaks) {
    // 和已选的线太像（角度差 < 6°、距离差 < 6px）就跳过
    if (out.some((o) => Math.abs(o.t - p.t) < 0.105 && Math.abs(o.r - p.r) < 6)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

function intersect(a: Line, b: Line): Pt | null {
  const c1 = Math.cos(a.t), s1 = Math.sin(a.t), c2 = Math.cos(b.t), s2 = Math.sin(b.t);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return [(a.r * s2 - b.r * s1) / det, (c1 * b.r - c2 * a.r) / det];
}

/** 用直线拼四边形：两条偏横的（上、下）× 两条偏竖的（左、右），交点组成四个角 */
function bestFromLines(raw: Uint8Array, thick: Uint8Array, w: number, h: number, dbg?: string[]): { q: Quad; score: number } | null {
  const lines = houghLines(raw, w, h, 24);
  // θ 是法线角：法线接近竖直（θ≈90°）的是横线
  const hz = lines.filter((l) => Math.abs(l.t - Math.PI / 2) < Math.PI / 4.5);
  const vt = lines.filter((l) => Math.abs(l.t - Math.PI / 2) > Math.PI / 3.6);
  let best: { q: Quad; score: number } | null = null;
  const minArea = w * h * 0.12;
  const inFrame = (p: Pt | null) => !!p && p[0] >= -2 && p[1] >= -2 && p[0] <= w + 2 && p[1] <= h + 2;
  for (let i = 0; i < hz.length; i++)
    for (let j = i + 1; j < hz.length; j++)
      for (let k = 0; k < vt.length; k++)
        for (let m = k + 1; m < vt.length; m++) {
          const ps = [intersect(hz[i], vt[k]), intersect(hz[i], vt[m]), intersect(hz[j], vt[m]), intersect(hz[j], vt[k])];
          if (!ps.every(inFrame)) continue;
          const q = orderQuad(ps as Pt[]);
          const area = quadArea(q);
          if (area < minArea || area > w * h * 0.985) continue;
          if (best && area < best.score) continue;
          if (!isConvex(q) || !anglesOk(q) || touchesBorder(q, w, h)) continue;
          const sup = sideSupport(q, thick, w, h);
          if (sup.min < 0.5 || sup.mean < 0.7) continue;
          const score = area * sup.mean * sup.mean;
          if (!best || score > best.score) best = { q, score };
        }
  dbg?.push(best ? `lines ok area=${(quadArea(best.q) / w / h).toFixed(2)} (${hz.length}h ${vt.length}v)` : `lines none (${hz.length}h ${vt.length}v)`);
  return best;
}

/**
 * 在一帧里找纸的四个角（坐标是这一帧的像素）。rgba 是 w×h 的 RGBA 像素。找不到返回 null。
 *
 * 候选区域有三个来源：大块的边缘线（纸的轮廓一般连成一圈）、边缘围起来的封闭区域、比桌面亮的区域。
 * 每块里找的四边形都要四条边基本压在边缘线上（纸边露出来了），选「面积 × 贴边程度」最大的。
 * 纸有一边出了画面时那条边没有边缘线，不算找到。
 */
export function detectQuad(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, dbg?: string[]): Quad | null {
  const g = blur(blur(toGray(rgba, w, h), w, h), w, h);
  const sat = blur(blur(toSat(rgba, w, h), w, h), w, h);
  const { raw, thick } = edgeMask(g, w, h, sat);
  let best: { q: Quad; score: number } | null = null;
  const take = (r: { q: Quad; score: number } | null) => {
    if (r && (!best || r.score > best.score)) best = r;
  };
  // 1. 大块边缘线的外轮廓
  for (const c of edgeComponents(thick, w, h, w * 0.3, h * 0.3)) take(bestOnBlob(c.left, c.right, w, h, thick, dbg));
  // 2. 边缘围起来、从四周灌不进去的最大区域
  const bg = floodFromBorder(thick, w, h);
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = !bg[i] && !thick[i] ? 1 : 0;
  const blob = largestBlob(inside, w, h);
  if (blob && blob.area > w * h * 0.1) take(bestOnBlob(blob.left, blob.right, w, h, thick, dbg));
  // 3. 比阈值亮的最大一块
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const thr = otsu(hist, g.length);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) bright[i] = g[i] > thr ? 1 : 0;
  const b2 = largestBlob(bright, w, h);
  if (b2 && b2.area > w * h * 0.1) take(bestOnBlob(b2.left, b2.right, w, h, thick, dbg));
  // 4. 直线拼框：纸边粘着别的东西（笔、手指、本子的搭扣）时，轮廓不是四边形，靠四条边的直线
  take(bestFromLines(raw, thick, w, h, dbg));
  const found = best as { q: Quad; score: number } | null;
  if (!found) return null;
  // 边缘线有一两个像素宽：往里收半个像素，宁可少裁一点纸边，也不要带进桌面
  const q = found.q;
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [Math.max(0, Math.min(w, x - (dx / d) * 0.5)), Math.max(0, Math.min(h, y - (dy / d) * 0.5))];
  }) as Quad;
}

/**
 * 取景时让绿框不抖：新框和上一帧差不多时做平滑；记录框稳定了多久（自动拍用）。
 * 连续几帧找不到才真的放掉框，偶尔一帧没找到不闪。
 */
export class QuadTracker {
  quad: Quad | null = null;
  stableSince = 0;
  private misses = 0;

  update(found: Quad | null, now: number, diag: number): Quad | null {
    if (!found) {
      this.misses++;
      if (this.misses >= 3) {
        this.quad = null;
        this.stableSince = 0;
      }
      return this.quad;
    }
    this.misses = 0;
    if (!this.quad) {
      this.quad = found;
      this.stableSince = now;
      return this.quad;
    }
    const move = Math.max(...found.map((p, i) => Math.hypot(p[0] - this.quad![i][0], p[1] - this.quad![i][1])));
    if (move > diag * 0.04) this.stableSince = now; // 动得多：重新计时
    const k = move > diag * 0.12 ? 1 : 0.45;
    this.quad = this.quad.map((p, i) => [p[0] + (found[i][0] - p[0]) * k, p[1] + (found[i][1] - p[1]) * k]) as Quad;
    return this.quad;
  }

  reset() {
    this.quad = null;
    this.stableSince = 0;
    this.misses = 0;
  }
}

/** 调试用：一帧的边缘图（1 = 边缘） */
export function edgeMapForDebug(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  return edgeMask(blur(blur(toGray(rgba, w, h), w, h), w, h), w, h, blur(blur(toSat(rgba, w, h), w, h), w, h)).raw;
}
