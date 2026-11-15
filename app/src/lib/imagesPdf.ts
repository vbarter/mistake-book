import { downscale, loadImage } from "./native";

/**
 * 把几张照片合成一份 PDF（每张照片一页）。
 * 知识库的上传接口一次只收一个文件，多页试卷得先在本机拼好。不引第三方库：PDF 里直接放 JPEG 原始数据（DCTDecode），
 * 每页一个图片对象 + 一句「把它铺满整页」的内容流。
 */

const enc = new TextEncoder();

function dataUrlBytes(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** JPEG 的颜色分量数（1 灰度 / 3 彩色 / 4 CMYK）：从 SOF 段里读，读不到按彩色算 */
function jpegComponents(b: Uint8Array): number {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return b[i + 9] || 3;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return 3;
}

export interface PdfPageInput { src: string; width?: number; height?: number }

/** 页数多的时候把每页缩小一点，免得超过上传上限 */
const sideFor = (count: number) => (count > 30 ? 1400 : count > 12 ? 1800 : 2400);

export async function imagesToPdf(pages: PdfPageInput[]): Promise<Blob> {
  const maxSide = sideFor(pages.length);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%âãÏÓ\n");
  // 对象编号：1 目录、2 页树，之后每页占三个（页、内容流、图片）
  const kids: string[] = [];
  let id = 3;
  for (const p of pages) {
    let src = p.src;
    let w = p.width ?? 0;
    let h = p.height ?? 0;
    // 不是 JPEG、不知道尺寸、或者太大：过一遍画布统一成 JPEG
    if (!src.startsWith("data:image/jpeg") || !w || !h || Math.max(w, h) > maxSide) {
      src = await downscale(src, maxSide, 0.82);
      const img = await loadImage(src);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
    const jpeg = dataUrlBytes(src);
    const n = jpegComponents(jpeg);
    const space = n === 1 ? "/DeviceGray" : n === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    // 页面按 A4 的宽（595pt）定，高度跟着照片比例走
    const pw = 595;
    const ph = Math.max(1, Math.round((h / w) * pw));
    const pageId = id, contentId = id + 1, imageId = id + 2;
    id += 3;
    kids.push(`${pageId} 0 R`);
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
    obj(contentId, `<< /Length ${content.length} >>`, content);
    obj(imageId, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  }
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>`);

  const xref = length;
  let table = `xref\n0 ${id}\n0000000000 65535 f \n`;
  for (let i = 1; i < id; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${id} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** 单张照片不用包成 PDF，直接当 JPEG 传 */
export async function imageToJpeg(src: string): Promise<Blob> {
  const jpeg = src.startsWith("data:image/jpeg") ? src : await downscale(src, 2400, 0.85);
  return new Blob([dataUrlBytes(jpeg) as BlobPart], { type: "image/jpeg" });
}
