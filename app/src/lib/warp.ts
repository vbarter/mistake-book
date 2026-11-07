/**
 * 透视拉正 + 提亮：按四个角把斜拍的试卷拉成正的矩形，再把阴影、发灰的底色提成白纸。
 * 纯计算（输入输出都是 RGBA 像素），在 Web Worker 里跑（见 warp.worker.ts），不支持 Worker 时在主线程跑。
 */
import type { Pt, Quad } from "./docDetect";

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 解 8×8 线性方程（高斯消元，部分主元） */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** 单应矩阵：把 from 的四个点映到 to 的四个点。返回 [a,b,c,d,e,f,g,h]（i=1） */
export function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return solve(A, b);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 拉正后的尺寸：用对边的平均长度估宽高，最长边不超过 maxSide */
export function warpSize(q: Quad, maxSide: number): { width: number; height: number } {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** 透视拉正：从 src 里按 quad（src 像素坐标）取出纸，输出 width×height。双线性插值 */
export function warp(src: Pixels, q: Quad, width: number, height: number): Pixels {
  // 反向映射：输出像素 → 原图坐标
  const H = homography([[0, 0], [width, 0], [width, height], [0, height]], q);
  const [a, b, c, d, e, f, g, h] = H;
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const yy = y + 0.5;
    for (let x = 0; x < width; x++) {
      const xx = x + 0.5;
      const den = g * xx + h * yy + 1;
      let u = (a * xx + b * yy + c) / den - 0.5;
      let v = (d * xx + e * yy + f) / den - 0.5;
      if (u < 0) u = 0; else if (u > sw - 1.001) u = sw - 1.001;
      if (v < 0) v = 0; else if (v > sh - 1.001) v = sh - 1.001;
      const x0 = u | 0;
      const y0 = v | 0;
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      out[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      out[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      out[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return { data: out, width, height };
}

/**
 * 提亮：估出纸面底色（分块取亮部，平滑后插值到每个像素），每个像素按底色拉到白。
 * 阴影、灯光不均、纸发黄都会变成白底；红笔、蓝笔的颜色保留。
 */
export function enhance(p: Pixels): Pixels {
  const { width: w, height: h, data } = p;
  const B = Math.max(16, Math.round(Math.max(w, h) / 40)); // 块大小
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let n = 0;
      const y1 = Math.min(h, (gy + 1) * B);
      const x1 = Math.min(w, (gx + 1) * B);
      for (let y = gy * B; y < y1; y += 2) {
        for (let x = gx * B; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          hist[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
          n++;
        }
      }
      // 第 90 百分位当作这一块的纸面亮度（字和线只占一小部分）
      let acc = 0;
      let v = 255;
      for (let k = 255; k >= 0; k--) {
        acc += hist[k];
        if (acc >= n * 0.1) { v = k; break; }
      }
      grid[gy * gw + gx] = v;
    }
  }
  // 平滑一下网格：3×3 取最大再均值，压住整块都是字的格子
  const sm = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let mx = 0;
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy;
          const xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const v = grid[yy * gw + xx];
          if (v > mx) mx = v;
          s += v;
          c++;
        }
      }
      sm[gy * gw + gx] = Math.max(grid[gy * gw + gx], (mx + s / c) / 2);
    }
  }
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, (y + 0.5) / B - 0.5));
    const gy0 = fy | 0;
    const ty = fy - gy0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, (x + 0.5) / B - 0.5));
      const gx0 = fx | 0;
      const tx = fx - gx0;
      const gx1 = Math.min(gw - 1, gx0 + 1);
      const gy1 = Math.min(gh - 1, gy0 + 1);
      const bgv =
        sm[gy0 * gw + gx0] * (1 - tx) * (1 - ty) + sm[gy0 * gw + gx1] * tx * (1 - ty) +
        sm[gy1 * gw + gx0] * (1 - tx) * ty + sm[gy1 * gw + gx1] * tx * ty;
      const k = 250 / Math.max(60, bgv);
      const i = (y * w + x) * 4;
      // 拉白以后略加对比：接近白的推到白，字迹略加深
      for (let ch = 0; ch < 3; ch++) {
        let v = data[i + ch] * k;
        v = v > 235 ? 255 : v * 0.96;
        out[i + ch] = v;
      }
      out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** 清晰度：灰度拉普拉斯的方差（在约 512px 的小图上算）。越大越清楚 */
export function sharpness(p: Pixels): number {
  const { width: w, height: h, data } = p;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

export interface ProcessJob {
  src: Pixels;
  quad: Quad | null; // null = 整张不裁
  maxSide: number;
  enhance: boolean;
}

/** 一张照片的全套处理：拉正（或原样）→ 提亮 */
export function processPixels(job: ProcessJob): Pixels {
  let p: Pixels = job.src;
  if (job.quad) {
    const { width, height } = warpSize(job.quad, job.maxSide);
    p = warp(job.src, job.quad, width, height);
  }
  if (job.enhance) p = enhance(p);
  return p;
}
