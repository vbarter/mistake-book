/** 框选工具：裁剪与自动分段。坐标均为图片原始像素。 */
import { loadImage } from "./native";

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function clampBox(b: Box, W: number, H: number, min = 40): Box {
  const w = Math.max(min, Math.min(b.w, W));
  const h = Math.max(min, Math.min(b.h, H));
  const x = Math.max(0, Math.min(b.x, W - w));
  const y = Math.max(0, Math.min(b.y, H - h));
  return { ...b, x, y, w, h };
}

export async function cropToDataUrl(src: string, box: Box, maxW = 1200): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxW / box.w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.w * scale);
  canvas.height = Math.round(box.h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * 自动分段（AI 预框的本地替代）：按行墨迹投影把试卷切成题块。
 * 把图缩到 400px 宽，统计每行深色像素数，连续有字的行合并为块，空白行超过阈值即分段。
 */
export async function autoSegment(src: string, maxBoxes = 6): Promise<Box[]> {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const sw = 400;
  const sh = Math.max(1, Math.round((H / W) * sw));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  // 自适应阈值：取全图亮度中位数的 70%
  const lum = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  }
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length / 2)] * 0.7;

  const rows = new Array<number>(sh).fill(0);
  let left = sw;
  let right = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (lum[y * sw + x] < threshold) {
        rows[y]++;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  const inkRow = (y: number) => rows[y] >= 3;
  const gapRows = Math.max(8, Math.round(sh * 0.016)); // 空白超过约 1.6% 高度视为题间距（同题行距通常小于此值）
  const blocks: { y0: number; y1: number }[] = [];
  let y = 0;
  while (y < sh) {
    if (!inkRow(y)) { y++; continue; }
    const y0 = y;
    let lastInk = y;
    while (y < sh && y - lastInk <= gapRows) {
      if (inkRow(y)) lastInk = y;
      y++;
    }
    const y1 = lastInk;
    // 单行文字也要保留（WebKit 下字形更矮），只过滤明显的噪点
    if (y1 - y0 >= Math.max(5, sh * 0.008)) blocks.push({ y0, y1 });
  }
  // 先剔除卷头（页面顶部 10% 内的块：标题、姓名、班级），保护隐私也避免把卷头当题目
  while (blocks.length > 1 && blocks[0].y1 < sh * 0.1) blocks.shift();
  // 块太多时合并最接近的相邻块，直到不超过 maxBoxes
  while (blocks.length > maxBoxes) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < blocks.length - 1; i++) {
      const gap = blocks[i + 1].y0 - blocks[i].y1;
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    blocks.splice(best, 2, { y0: blocks[best].y0, y1: blocks[best + 1].y1 });
  }
  const scale = W / sw;
  const padX = Math.round(8 * scale);
  const padY = Math.round(5 * scale);
  const x0 = Math.max(0, Math.round(left * scale) - padX);
  const x1 = Math.min(W, Math.round((right + 1) * scale) + padX);
  return blocks.map((b) =>
    clampBox(
      { id: newId(), x: x0, y: Math.round(b.y0 * scale) - padY, w: x1 - x0, h: Math.round((b.y1 - b.y0 + 1) * scale) + padY * 2 },
      W,
      H,
    ),
  );
}
