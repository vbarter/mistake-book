/** 照片指纹：加照片时算，用来认出「这张图之前导入过」。不依赖网络，不上传。 */

/** 差值哈希：缩成 9×8 灰度，逐行比较相邻像素，得到 64 位（16 位十六进制）。缩放、重新压缩后基本不变 */
export function dhashOf(img: CanvasImageSource): string {
  // 先缩到 72×64 再缩到 9×8：大图一步缩到 9×8 只采到零星几个像素，同一张图压缩一下结果就变
  const mid = document.createElement("canvas");
  mid.width = 72;
  mid.height = 64;
  const mctx = mid.getContext("2d");
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !mctx) return "";
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(img, 0, 0, 72, 64);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  mid.width = mid.height = canvas.width = canvas.height = 0; // 马上还掉画布内存（iOS 对画布总内存有上限）
  const gray = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  };
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray(x, y) > gray(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** 原图 dataURL 的 SHA-256 前 16 位；环境不支持时返回空串 */
export async function shaOf(src: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
    return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

const POP = (n: number) => {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};

/** 两个 16 位十六进制哈希的汉明距离；有一个为空时返回 64（当作完全不同） */
export function hamming(a?: string, b?: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 8) d += POP((parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0);
  return d;
}
