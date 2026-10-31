/** 去重：认出重复导入的照片、重复扫描的试卷、不同试卷里的同一道题。全部在本机比对。
 *
 * 题目指纹（qKey / qSim / qNums）和卷面指纹（textSim）由服务端随扫描结果给出，只看印刷内容、不看作答；
 * 升级前扫的试卷没有指纹，打开时后台补（jobs.ts 的 printIfNeeded）。
 */
import type { DigitizedQuestion } from "../api/types";
import { validDigitized, type Folder, type FolderPage, type Paper, type PaperMatch } from "./folders";
import { hamming } from "./photoPrint";

// ---------------------------------------------------------------- 照片

export interface PhotoMatch {
  folderId: string;
  paperId: string;
  folderName: string;
  paperName: string;
  pageIndex: number;
}

/** 两张照片是不是同一张图：内容哈希相同；或差值哈希几乎一样、长宽比也一样（同一张图被重新压缩 / 缩放过） */
function samePhoto(a: FolderPage, b: FolderPage): boolean {
  if (a.sha && b.sha && a.sha === b.sha) return true;
  if (!a.dhash || !b.dhash || !a.width || !b.width) return false;
  const ra = a.height / a.width;
  const rb = b.height / b.width;
  return Math.abs(ra - rb) / rb < 0.02 && hamming(a.dhash, b.dhash) <= 2;
}

/** 新加的照片里，哪些之前已经在别的试卷里了（exceptPaperId：正在编辑的这份试卷自己不算） */
export function findPhotoMatches(folders: Folder[], pages: FolderPage[], exceptPaperId?: string | null): Map<string, PhotoMatch> {
  const out = new Map<string, PhotoMatch>();
  for (const pg of pages) {
    if (!pg.sha && !pg.dhash) continue;
    search: for (const f of folders) {
      for (const p of f.papers) {
        if (p.id === exceptPaperId) continue;
        const i = p.pages.findIndex((old) => old.id !== pg.id && samePhoto(pg, old));
        if (i >= 0) {
          out.set(pg.id, { folderId: f.id, paperId: p.id, folderName: f.name, paperName: p.name, pageIndex: i });
          break search;
        }
      }
    }
  }
  return out;
}

/** 给用户看的一句话：「有 2 张照片之前导入过：《期中 · 数学》第 1、2 页」 */
export function photoMatchText(matches: Map<string, PhotoMatch>, total: number): string {
  const list = [...matches.values()];
  if (!list.length) return "";
  const first = list[0];
  const pagesOfFirst = list.filter((m) => m.paperId === first.paperId).map((m) => m.pageIndex + 1);
  const where = `「${first.paperName}」第 ${[...new Set(pagesOfFirst)].sort((a, b) => a - b).join("、")} 页`;
  const more = list.some((m) => m.paperId !== first.paperId) ? "等" : "";
  return total === 1 || list.length === 1 ? `这张照片之前导入过，在${where}${more}` : `有 ${list.length} 张照片之前导入过，在${where}${more}`;
}

// ---------------------------------------------------------------- 题目

/** 同一道题：指纹相同；或题干 SimHash 只差几位、数字完全一样、学科题型一样（识别差了一两个字） */
export function sameQuestion(a: DigitizedQuestion, b: DigitizedQuestion): boolean {
  if (!a.qKey || !b.qKey) return false;
  if (a.qKey === b.qKey) return true;
  return a.subject === b.subject && a.questionType === b.questionType && (a.qNums ?? "") === (b.qNums ?? "") && hamming(a.qSim, b.qSim) <= 3;
}

const normAnswer = (s: string) => s.replace(/\s+/g, "").replace(/[，,。.；;]/g, "").toLowerCase();

/** 两次是不是同一次作答（重复扫描）：手写转写和批改都一样 */
export function sameAttempt(a: DigitizedQuestion, b: DigitizedQuestion): boolean {
  return normAnswer(a.studentAnswer) === normAnswer(b.studentAnswer) && a.mark === b.mark;
}

// ---------------------------------------------------------------- 试卷

const MIN_QUESTIONS = 3; // 题太少的试卷不判，免得一两道题碰巧相同就说是同一份
const SAME_PAPER = 0.8; // 这份试卷 80% 以上的题都在另一份里
const SAME_ANSWERS = 0.85; // 重合的题里 85% 以上作答一样：重复扫描，不是重做

const fingerprinted = (p: Paper) => (validDigitized(p.digitized)?.questions ?? []).filter((q) => q.qKey);

/** 扫描完成后：这份试卷是不是本机另一份试卷重复扫的 / 重做的 / 其中几页。找不到返回 null */
export function findPaperMatch(folders: Folder[], paper: Paper): PaperMatch | null {
  const mine = fingerprinted(paper);
  if (mine.length < MIN_QUESTIONS) return null;
  const skip = new Set(paper.notDuplicateOf ?? []);
  // 只和比它早扫的比：先扫的是原卷，后扫的才是重复的；老试卷补指纹时两份也不会互相标成对方的重复
  const when = (p: Paper) => `${p.scannedAt ?? p.updatedAt}|${p.id}`;
  const mineAt = when(paper);
  let best: (PaperMatch & { at: string }) | null = null;
  for (const f of folders) {
    for (const other of f.papers) {
      // 本身就是重复扫描的那份不当原卷（指向它的原卷）
      if (other.id === paper.id || skip.has(other.id) || when(other) >= mineAt || (other.duplicateOf && other.duplicateOf.kind !== "retake")) continue;
      const theirs = fingerprinted(other);
      if (theirs.length < MIN_QUESTIONS) continue;
      const pairs: [DigitizedQuestion, DigitizedQuestion][] = [];
      for (const q of mine) {
        const hit = theirs.find((t) => sameQuestion(q, t));
        if (hit) pairs.push([q, hit]);
      }
      const overlap = pairs.length / mine.length;
      if (overlap < SAME_PAPER) continue;
      const answered = pairs.filter(([q]) => q.studentAnswer.trim());
      const same = answered.length ? answered.filter(([q, t]) => sameAttempt(q, t)).length / answered.length : 0;
      // 这份只有那份的一部分题（只拍了其中几页）；作答一样才算补拍，作答不同的是重做
      const kind: PaperMatch["kind"] = same >= SAME_ANSWERS ? (mine.length < theirs.length * 0.7 ? "partial" : "same") : "retake";
      const at = other.scannedAt ?? other.updatedAt;
      // 优先认作答一样的（重复扫描），再看重合度，最后取最近的一份
      const rankOf = (m: { kind: PaperMatch["kind"]; overlap: number; at: string }) => [m.kind === "retake" ? 0 : 1, m.overlap, m.at] as const;
      const a = rankOf({ kind, overlap, at });
      const b = best ? rankOf(best) : null;
      if (!b || a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
        best = { folderId: f.id, paperId: other.id, folderName: f.name, paperName: other.name, kind, overlap: Math.round(overlap * 100) / 100, shared: pairs.length, at };
      }
    }
  }
  if (!best) return null;
  const { at: _at, ...match } = best;
  return match;
}

/** 这份试卷的错题要不要计入文件夹、错题库、错题榜的汇总：重复扫描（或重拍的其中几页）不计，免得同一次作答算两遍。
 * 用户点「不是同一份」会清掉 duplicateOf，就又计入了；重做的照常计入，同一道题合并成「错过 N 次」 */
export const countsInSummary = (p: Paper) => !(p.duplicateOf && p.duplicateOf.kind !== "retake");

/** 加照片时提示「之前导入过」：不拦着，给一个「去看看」。查不了（读不到本机数据）就不提示 */
export async function warnPhotoDuplicates(pages: FolderPage[], exceptPaperId: string | null | undefined, open: (folderId: string, paperId: string) => void): Promise<void> {
  try {
    const { listFolders } = await import("./folders");
    const { useBanner } = await import("../store/banner");
    const matches = findPhotoMatches(await listFolders(), pages, exceptPaperId);
    if (!matches.size) return;
    const first = [...matches.values()][0];
    useBanner.getState().show(photoMatchText(matches, pages.length), { action: { label: "去看看", onClick: () => open(first.folderId, first.paperId) }, duration: 6000 });
  } catch {
    /* ignore */
  }
}
