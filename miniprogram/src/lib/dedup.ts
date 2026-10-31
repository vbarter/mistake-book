/** 去重：认出重复导入的照片、重复扫描的试卷、不同试卷里的同一道题。全部在本机比对（和 App 的 lib/dedup.ts 同一套规则）。
 *
 * 题目指纹（qKey / qSim / qNums）由服务端随扫描结果给出，只看印刷内容、不看作答；
 * 升级前扫的试卷没有指纹，打开时后台补（jobs.ts 的 printIfNeeded）。
 */
import type { DigitizedQuestion } from "./types";
import { validDigitized } from "./logic";
import type { Folder, FolderPage, Paper, PaperMatch } from "./store";

const pop = (n: number) => {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};

/** 两个 16 位十六进制哈希的汉明距离；有一个为空时返回 64 */
export function hamming(a?: string, b?: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 8) d += pop((parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0);
  return d;
}

// ---------------------------------------------------------------- 照片

export interface PhotoMatch {
  folderId: string;
  paperId: string;
  folderName: string;
  paperName: string;
  pageIndex: number;
}

/** 新存的照片里，哪些和别的试卷里的照片是同一个文件（exceptPaperIds：刚建的这几份自己不算） */
export function findPhotoMatches(folders: Folder[], pages: FolderPage[], exceptPaperIds: string[] = []): Map<string, PhotoMatch> {
  const out = new Map<string, PhotoMatch>();
  for (const pg of pages) {
    if (!pg.sha) continue;
    search: for (const f of folders) {
      for (const p of f.papers) {
        if (exceptPaperIds.includes(p.id)) continue;
        const i = p.pages.findIndex((old) => old.id !== pg.id && old.sha === pg.sha);
        if (i >= 0) {
          out.set(pg.id, { folderId: f.id, paperId: p.id, folderName: f.name, paperName: p.name, pageIndex: i });
          break search;
        }
      }
    }
  }
  return out;
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

const MIN_QUESTIONS = 3; // 题太少的试卷不判
const SAME_PAPER = 0.8; // 这份试卷 80% 以上的题都在另一份里
const SAME_ANSWERS = 0.85; // 重合的题里 85% 以上作答一样：重复扫描，不是重做

const fingerprinted = (p: Paper) => (validDigitized(p.digitized)?.questions ?? []).filter((q) => q.qKey);

/** 扫描完成后：这份试卷是不是本机另一份（更早扫的）试卷重复扫的 / 重做的 / 其中几页。找不到返回 null */
export function findPaperMatch(folders: Folder[], paper: Paper): PaperMatch | null {
  const mine = fingerprinted(paper);
  if (mine.length < MIN_QUESTIONS) return null;
  const skip = new Set(paper.notDuplicateOf ?? []);
  const when = (p: Paper) => `${p.scannedAt ?? p.updatedAt}|${p.id}`;
  const mineAt = when(paper);
  let best: (PaperMatch & { at: string }) | null = null;
  for (const f of folders) {
    for (const other of f.papers) {
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
      const kind: PaperMatch["kind"] = same >= SAME_ANSWERS ? (mine.length < theirs.length * 0.7 ? "partial" : "same") : "retake";
      const at = other.scannedAt ?? other.updatedAt;
      const score = (m: { kind: PaperMatch["kind"]; overlap: number; at: string }) => [m.kind === "retake" ? 0 : 1, m.overlap, m.at] as const;
      const a = score({ kind, overlap, at });
      const b = best ? score(best) : null;
      if (!b || a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
        best = { folderId: f.id, paperId: other.id, folderName: f.name, paperName: other.name, kind, overlap, shared: pairs.length, at };
      }
    }
  }
  if (!best) return null;
  const { at: _at, ...match } = best;
  return { ...match, overlap: Math.round(match.overlap * 100) / 100 };
}

/** 这份试卷的错题要不要计入文件夹、错题库的汇总：重复扫描（或重拍的其中几页）不计；重做的照常计入，同一道题合并成「错过 N 次」 */
export const countsInSummary = (p: Paper) => !(p.duplicateOf && p.duplicateOf.kind !== "retake");
