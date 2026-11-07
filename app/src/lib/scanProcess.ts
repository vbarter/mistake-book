/**
 * 连拍扫描的照片处理：拉正 + 提亮（后台 Worker 里排队做）、清晰度、在一张图里重新找四边。
 * 四个角都用 0–1 的相对坐标（相对原图宽高），原图换分辨率也通用。
 */
import { DETECT_SIDE, detectQuad, type Quad } from "./docDetect";
import { loadImage, releaseCanvas } from "./native";
import { processPixels, sharpness, type Pixels, type ProcessJob } from "./warp";
import WarpWorker from "./warp.worker?worker";

/** 拉正后存的最长边：和相册导入的照片一样（PHOTO_MAX_SIDE） */
export const SCAN_MAX_SIDE = 2400;

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map<number, { resolve: (p: Pixels) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new WarpWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; out?: Pixels; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.out) w.resolve(e.data.out);
      else w.reject(new Error(e.data.error || "处理失败"));
    };
    worker.onerror = () => {
      // Worker 起不来（个别 WebView）：之后都在主线程做，已经排着的也交回主线程
      workerBroken = true;
      worker = null;
      for (const [, w] of waiting) w.reject(new Error("worker"));
      waiting.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function runJob(job: ProcessJob): Promise<Pixels> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<Pixels>((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        w.postMessage({ id, job }, [job.src.data.buffer]);
      });
    } catch (e) {
      if ((e as Error).message !== "worker") throw e;
      throw new Error("retry"); // 像素已经转交给 Worker 了，交给调用方重新读一遍图
    }
  }
  return processPixels(job);
}

function pixelsOf(img: CanvasImageSource, w: number, h: number): Pixels {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  releaseCanvas(c);
  return { data: d.data, width: w, height: h };
}

/** 像素 → JPEG dataURL，顺手按 turns（顺时针 90° 的次数）转好 */
function toDataUrl(p: Pixels, turns: number, quality = 0.9): string {
  const a = document.createElement("canvas");
  a.width = p.width;
  a.height = p.height;
  a.getContext("2d")!.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  const t = ((turns % 4) + 4) % 4;
  if (!t) {
    const out = a.toDataURL("image/jpeg", quality);
    releaseCanvas(a);
    return out;
  }
  const b = document.createElement("canvas");
  b.width = t % 2 ? p.height : p.width;
  b.height = t % 2 ? p.width : p.height;
  const ctx = b.getContext("2d")!;
  ctx.translate(b.width / 2, b.height / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(a, -p.width / 2, -p.height / 2);
  const out = b.toDataURL("image/jpeg", quality);
  releaseCanvas(a);
  releaseCanvas(b);
  return out;
}

/**
 * 处理一张：按四个角（相对坐标，null = 整张不裁）拉正，提亮，转方向。返回 JPEG dataURL 和清晰度。
 * 没裁、没提亮、没转时原样返回，不重新压缩。
 */
export async function processShot(raw: string, quad: Quad | null, turns: number, doEnhance: boolean): Promise<{ src: string; sharp: number }> {
  const img = await loadImage(raw);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, (SCAN_MAX_SIDE * 1.25) / Math.max(W, H)); // 原图特别大时先缩一点再拉，省内存
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);
  const q = quad ? (quad.map(([x, y]) => [x * sw, y * sh]) as Quad) : null;
  let out: Pixels;
  if (!q && !doEnhance && !turns) {
    return { src: raw, sharp: await sharpnessOf(raw) };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      out = await runJob({ src: pixelsOf(img, sw, sh), quad: q, maxSide: SCAN_MAX_SIDE, enhance: doEnhance });
      break;
    } catch (e) {
      if ((e as Error).message === "retry" && attempt === 0) continue;
      throw e;
    }
  }
  const sharp = sharpnessFromPixels(out);
  return { src: toDataUrl(out, turns), sharp };
}

function sharpnessFromPixels(p: Pixels): number {
  // 缩到约 512px 再算：不同分辨率的照片可以比
  const s = Math.min(1, 512 / Math.max(p.width, p.height));
  if (s >= 1) return sharpness(p);
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  c.getContext("2d")!.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  const small = pixelsOf(c, Math.round(p.width * s), Math.round(p.height * s));
  releaseCanvas(c);
  return sharpness(small);
}

export async function sharpnessOf(src: string): Promise<number> {
  const img = await loadImage(src);
  const s = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  return sharpness(pixelsOf(img, Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s)));
}

/** 在一张（已经拍下的）图里重新找四边，返回相对坐标 */
export async function detectInImage(src: string): Promise<Quad | null> {
  const img = await loadImage(src);
  const s = DETECT_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  const q = detectQuad(pixelsOf(img, w, h).data, w, h);
  return q ? (q.map(([x, y]) => [x / w, y / h]) as Quad) : null;
}

/** 本批里哪些照片可能不用要：和前一张几乎一样（同一页拍了两次）、明显比别的糊 */
export function findIssues(shots: { id: string; dhash?: string; sharp?: number }[], hamming: (a?: string, b?: string) => number): Map<string, { kind: "dup" | "blur"; of?: number }> {
  const out = new Map<string, { kind: "dup" | "blur"; of?: number }>();
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1];
    const b = shots[i];
    if (a.dhash && b.dhash && hamming(a.dhash, b.dhash) <= 5) out.set(b.id, { kind: "dup", of: i - 1 });
  }
  const sharp = shots.map((s) => s.sharp ?? 0).filter((v) => v > 0).sort((x, y) => x - y);
  const median = sharp.length ? sharp[Math.floor(sharp.length / 2)] : 0;
  for (const s of shots) {
    if (out.has(s.id) || !s.sharp) continue;
    const veryLow = s.sharp < BLUR_ABS;
    const relLow = sharp.length >= 3 && s.sharp < median * 0.35;
    if (veryLow || relLow) out.set(s.id, { kind: "blur" });
  }
  return out;
}

/** 低于这个清晰度直接算糊（512px 小图上的拉普拉斯方差；清楚的试卷一般在几百以上） */
export const BLUR_ABS = 80;
