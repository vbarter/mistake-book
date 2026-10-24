/** 错题汇总：把文件夹里扫描出的判错题（含未作答）收集成统一记录，供文件夹汇总、错题库和导出使用。 */
import type { DigitizedQuestion, Mark, Subject } from "../api/types";
import { autoMark, effectiveMark, isBlank, isProblem, validDigitized, type Folder, type Paper } from "./folders";
import { unwrapLines } from "./format";
import { figuresOfQuestion, type FigureRef } from "./figures";

export type ErrorKind = "未作答" | "答错" | "半对";

export interface ErrorItem {
  key: string; // paperId:index
  folderId: string;
  folderName: string;
  paperId: string;
  paperName: string;
  scannedAt: string; // ISO
  subject: Subject;
  knowledge: string; // 考纲一级知识点（knowledgePoints[0]）
  subKnowledge: string[];
  kind: ErrorKind;
  q: DigitizedQuestion;
  parts: ErrorPart[]; // 一题多问（如 18-1、18-2）时逐问的作答 / 判定 / 答案；只有一个空时为空数组
  stem: string; // 卡片上显示的题干：短文里的空只取当前空所在的那一句（q.stemText 仍是整篇，导出合并用）
  sectionLabel: string; // 所属大题，如「Ⅳ Complete the sentences…」
  figures: FigureRef[]; // 这道题用到的插图（从原照片裁）
}

export const UNANSWERED = "未作答";

/** 一题多问里的一问 */
export interface ErrorPart {
  label: string; // （1）（2）…
  student: string;
  mark: Mark;
  answer: string;
  analysis: string;
  ai: boolean; // 老师没批改，AI 判的
}

/** 一道题对应的各个空：题号形如 18-1、18-2 的按小问拆开，标上（1）（2） */
function partsOf(paper: Paper, q: DigitizedQuestion): ErrorPart[] {
  if (q.blankIds.length < 2) return [];
  const block = validDigitized(paper.digitized)?.pages[q.sheet]?.blocks[q.blockIndex];
  if (!block) return [];
  return block.blanks
    .filter((b) => q.blankIds.includes(b.id))
    .map((b, i) => {
      const mark = autoMark(b.mark, b.student, b.answer, block.questionType);
      const sub = /-(\d+)$/.exec(b.id)?.[1] ?? String(i + 1);
      return { label: `（${sub}）`, student: b.student, mark, answer: b.answer, analysis: b.analysis, ai: Boolean(b.aiGraded) || (b.mark === "unmarked" && mark !== "unmarked") };
    });
}

/** 短文（完形 / 选词填空）里的一个空：整篇短文只取包含当前空（裸「____」）的那一句，别的空仍带编号；不是短文或找不到就原样返回 */
export function focusSentence(stem: string): string {
  if (!/\(\d+\)____/.test(stem)) return stem;
  const m = /(^|[^)])____/.exec(stem);
  if (!m) return stem;
  const at = m.index + m[1].length;
  // 句号后面跟空格 / 引号 / 结尾才算句子结束；数字后的点（3.5）不算
  const isEnd = (i: number) => /[.!?。！？]/.test(stem[i]) && !/\d/.test(stem[i - 1] ?? "") && (i + 1 >= stem.length || /[\s"”’)]/.test(stem[i + 1]));
  let start = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (stem[i] === "\n" || isEnd(i)) {
      start = i + 1;
      break;
    }
  }
  let end = stem.length;
  for (let i = at; i < stem.length; i++) {
    if (stem[i] === "\n") {
      end = i;
      break;
    }
    if (isEnd(i)) {
      end = i + 1;
      while (end < stem.length && /["”’)]/.test(stem[end])) end++;
      break;
    }
  }
  return stem.slice(start, end).trim() || stem;
}

export function kindOf(q: DigitizedQuestion): ErrorKind {
  if (isBlank(q)) return "未作答";
  return effectiveMark(q) === "partial" ? "半对" : "答错";
}

function sectionOf(paper: Paper, q: DigitizedQuestion): string {
  const sheet = validDigitized(paper.digitized)?.pages[q.sheet];
  if (!sheet) return "";
  for (let j = Math.min(q.blockIndex, sheet.blocks.length - 1); j >= 0; j--) {
    const b = sheet.blocks[j];
    if (b.type === "section") return [b.label, b.title].filter(Boolean).join(" ");
  }
  return "";
}

export function paperErrors(folder: Folder, paper: Paper): ErrorItem[] {
  const d = validDigitized(paper.digitized);
  if (!d) return [];
  return d.questions.filter(isProblem).map((q) => ({
    key: `${paper.id}:${q.index}`,
    folderId: folder.id,
    folderName: folder.name,
    paperId: paper.id,
    paperName: paper.name,
    scannedAt: paper.scannedAt ?? paper.updatedAt,
    subject: q.subject,
    knowledge: q.knowledgePoints[0] || "（未标注知识点）",
    subKnowledge: q.knowledgePoints.slice(1),
    kind: kindOf(q),
    q,
    parts: partsOf(paper, q),
    stem: focusSentence(unwrapLines(q.stemText)),
    sectionLabel: sectionOf(paper, q),
    figures: figuresOfQuestion(paper, q),
  }));
}

export function folderErrors(folder: Folder): ErrorItem[] {
  return folder.papers.flatMap((p) => paperErrors(folder, p));
}

export function allErrors(folders: Folder[]): ErrorItem[] {
  return folders.flatMap(folderErrors);
}

/** 按知识点分组，错得多的在前 */
export function groupByKnowledge(items: ErrorItem[]): [string, ErrorItem[]][] {
  const map = new Map<string, ErrorItem[]>();
  for (const it of items) map.set(it.knowledge, [...(map.get(it.knowledge) ?? []), it]);
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** 按所属大题分组，保持试卷顺序（和「作答」页一致）；没有大题的放在它们出现的位置 */
export function groupBySection(items: ErrorItem[]): [string, ErrorItem[]][] {
  const out: [string, ErrorItem[]][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last[0] === it.sectionLabel) last[1].push(it);
    else out.push([it.sectionLabel, [it]]);
  }
  return out;
}

/** 按月份分组（新的在前），组内按文件夹 */
export function groupByMonth(items: ErrorItem[]): [string, ErrorItem[]][] {
  const map = new Map<string, ErrorItem[]>();
  for (const it of [...items].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))) {
    const d = new Date(it.scannedAt);
    const k = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()];
}

export function groupBySubject(items: ErrorItem[]): [Subject, ErrorItem[]][] {
  const map = new Map<Subject, ErrorItem[]>();
  for (const it of items) map.set(it.subject, [...(map.get(it.subject) ?? []), it]);
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** 导出错题本用：短文里的几个空合成一道，题干只出现一次 */
export interface BookItem {
  number: string;
  stem: string;
  options: string[];
  knowledge: string;
  source: string;
  answers: { number: string; student: string; answer: string; analysis: string; kind: ErrorKind; tip: string; sub: string }[];
  figures: FigureRef[]; // 导出前换成 { title, text, image }
}

export function toBookItems(items: ErrorItem[]): BookItem[] {
  const out: BookItem[] = [];
  const byBlock = new Map<string, BookItem>();
  for (const it of items) {
    const q = it.q;
    const isPassageBlank = q.blankIds.length === 1 && /\(\d+\)____/.test(q.stemText);
    const answer = { number: q.number, student: q.studentAnswer, answer: q.correctAnswer, analysis: q.analysis, kind: it.kind, tip: q.tip, sub: it.subKnowledge.join("、") };
    const source = `${it.folderName} · ${it.paperName}`;
    if (isPassageBlank) {
      const key = `${it.paperId}:${q.sheet}:${q.blockIndex}`;
      const existing = byBlock.get(key);
      if (existing) {
        existing.answers.push(answer);
        existing.number = `${existing.answers[0].number}–${q.number}`;
        continue;
      }
      // 短文：把当前空的「____」也标上编号，整篇只放一次
      const stem = unwrapLines(q.stemText).replace(/(^|[^)])____/, `$1(${q.number})____`);
      const item: BookItem = { number: q.number, stem, options: q.options, knowledge: it.knowledge, source, answers: [answer], figures: it.figures };
      byBlock.set(key, item);
      out.push(item);
      continue;
    }
    out.push({ number: q.number, stem: unwrapLines(q.stemText), options: q.options, knowledge: it.knowledge, source, answers: [answer], figures: it.figures });
  }
  return out;
}
