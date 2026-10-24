/** 插图：识别结果里的 figure 块只有位置（bbox，相对原照片 0–1），图本身从本机保存的原照片里裁出来。
 *  照片拍倒了时（rotation：内容逆时针转了几个 90°）裁完再转正。裁好的图缓存在内存里。 */
import type { DigitizedBlock, DigitizedQuestion } from "../api/types";
import { validDigitized, type Paper } from "./folders";
import { loadImage } from "./native";

export interface FigureRef {
  key: string;
  src: string; // 原照片
  bbox: number[];
  rotation: number;
  title: string;
  label: string; // 图片选项的字母 / 配对图标号（"A"），普通插图为空
  text: string; // 文字说明（图裁不出来时显示）
}

/** 选择 / 配对题作答里的标号：只看很短的作答（如「B」「AC」「③」），免得把英文单词里的大写字母当成标号 */
export function answerLabels(s: string): string[] {
  const t = (s || "").replace(/[\s,，、;；.。()（）]/g, "").toUpperCase();
  if (!t || t.length > 4) return [];
  return t.match(/[A-H]|[①-⑩]/g) ?? [];
}

const baseNumber = (n: string) => (n || "").replace(/[（(].*$/, "").split("-")[0].trim();

function refOf(paper: Paper, sheetIndex: number, blockIndex: number, block: DigitizedBlock): FigureRef | null {
  const d = validDigitized(paper.digitized);
  const sheet = d?.pages[sheetIndex];
  const photo = sheet ? paper.pages[sheet.page] : undefined;
  const src = photo?.src;
  if (!sheet || !photo || !src || block.type !== "figure" || block.bbox.length !== 4) return null;
  // 照片 id 也进 key：重拍后同样位置的图不会用到旧照片的裁图
  return { key: `${paper.id}:${photo.id}:${sheetIndex}:${blockIndex}:${block.bbox.map((v) => v.toFixed(3)).join(",")}`, src, bbox: block.bbox, rotation: sheet.rotation ?? 0, title: block.title, label: (block.label || "").trim(), text: block.text };
}

/** 试卷页上某个 figure 块 */
export function figureAt(paper: Paper, sheetIndex: number, blockIndex: number): FigureRef | null {
  const block = validDigitized(paper.digitized)?.pages[sheetIndex]?.blocks[blockIndex];
  return block ? refOf(paper, sheetIndex, blockIndex, block) : null;
}

/** 一道题用到的插图：先找标了本题题号的图；没有标题号、题干又提到图表时，取紧挨着这道题（中间只隔说明文字）的图 */
export function figuresOfQuestion(paper: Paper, q: DigitizedQuestion): FigureRef[] {
  const sheet = validDigitized(paper.digitized)?.pages[q.sheet];
  if (!sheet) return [];
  const own = baseNumber(q.number);
  const byNumber = sheet.blocks.flatMap((b, i) => (b.type === "figure" && own && baseNumber(b.number) === own ? [refOf(paper, q.sheet, i, b)] : []));
  const found = byNumber.filter((f): f is FigureRef => Boolean(f));
  if (found.length) return found;
  // 图文配对：共用的标号图（没写题号），取作答和答案里出现的标号
  const marks = new Set([q.correctAnswer, q.studentAnswer].flatMap(answerLabels));
  if (marks.size) {
    const matched = sheet.blocks
      .map((b, i) => (b.type === "figure" && !b.number && b.label && marks.has(b.label.trim().toUpperCase()) ? refOf(paper, q.sheet, i, b) : null))
      .filter((f): f is FigureRef => Boolean(f));
    if (matched.length) return matched;
  }
  if (!/图|表|如下/.test(q.stemText)) return [];
  const near = (step: 1 | -1) => {
    const out: FigureRef[] = [];
    for (let i = q.blockIndex + step; i >= 0 && i < sheet.blocks.length; i += step) {
      const b = sheet.blocks[i];
      if (b.type === "figure") {
        if ((!b.number || baseNumber(b.number) === own) && !b.label) {
          const r = refOf(paper, q.sheet, i, b);
          if (r) out.push(r);
        }
        continue;
      }
      if (b.type !== "text") break;
    }
    return step === -1 ? out.reverse() : out;
  };
  const after = near(1);
  return after.length ? after : near(-1);
}

const cache = new Map<string, Promise<string>>();

/** 裁图：四周留 1.5% 边，最长边不超过 1400，转正后输出 JPEG dataURL */
export function cropFigure(f: FigureRef): Promise<string> {
  const hit = cache.get(f.key);
  if (hit) return hit;
  const job = (async () => {
    const img = await loadImage(f.src);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const pad = 0.015;
    const x0 = Math.max(0, f.bbox[0] - pad) * W;
    const y0 = Math.max(0, f.bbox[1] - pad) * H;
    const x1 = Math.min(1, f.bbox[2] + pad) * W;
    const y1 = Math.min(1, f.bbox[3] + pad) * H;
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const scale = Math.min(1, 1400 / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const turns = ((f.rotation % 4) + 4) % 4; // 内容逆时针转了几个 90°，这里顺时针转回去
    const canvas = document.createElement("canvas");
    canvas.width = turns % 2 ? h : w;
    canvas.height = turns % 2 ? w : h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, x0, y0, sw, sh, -w / 2, -h / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.88);
  })();
  cache.set(f.key, job);
  job.catch(() => cache.delete(f.key));
  return job;
}

/** 导出 PDF 用：带上裁好的图；裁不出来就只给文字说明 */
export async function figurePayload(f: FigureRef): Promise<{ title: string; label: string; text: string; image?: string }> {
  try {
    return { title: f.title, label: f.label, text: f.text, image: await cropFigure(f) };
  } catch {
    return { title: f.title, label: f.label, text: f.text };
  }
}
