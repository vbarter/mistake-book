/** 错题汇总：把文件夹里扫描出的判错题（含未作答）收集成统一记录，供文件夹汇总、错题库和导出使用。 */
import type { DigitizedQuestion, Mark, Subject } from "./types";
import { autoMark, effectiveMark, isBlank, isProblem, validDigitized } from "./logic";
import type { Folder, Paper } from "./store";
import { stripLeadingNumber, unwrapLines } from "./format";
import { figuresOfQuestion, type FigureRef } from "./figures";
import { countsInSummary, sameQuestion } from "./dedup";

export type ErrorKind = "未作答" | "答错" | "半对";

export interface ErrorItem {
  key: string; // paperId:index
  folderId: string;
  folderName: string;
  paperId: string;
  paperName: string;
  scannedAt: string; // ISO
  subject: Subject;
  knowledge: string; // 归类用的一级知识点：图谱知识点所在的章（topic.chapter），没标上图谱时是 knowledgePoints[0]
  subKnowledge: string[]; // 细分点：图谱知识点名在前
  topicId?: string; // 图谱知识点 id（有才有）
  kind: ErrorKind;
  q: DigitizedQuestion;
  parts: ErrorPart[]; // 一题多问（如 18-1、18-2）时逐问的作答 / 判定 / 答案；只有一个空时为空数组
  stem: string; // 卡片上显示的题干：短文里的空只取当前空所在的那一句（q.stemText 仍是整篇，导出合并用）
  sectionLabel: string; // 所属大题，如「Ⅳ Complete the sentences…」
  figures: FigureRef[]; // 这道题用到的插图（从原照片裁）
  repeats?: ErrorItem[]; // 汇总时合并进来的、别的试卷里的同一道题（较早的几次）；只有汇总列表里才有
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

/** 一级知识点：标上了图谱知识点就用它的章（同一章不管模型怎么写都归到一起），否则用识别时写的第一项 */
export function knowledgeOf(q: DigitizedQuestion): string {
  return q.topic?.chapter || q.knowledgePoints[0] || "（未标注知识点）";
}

/** 细分点：图谱知识点名在前，再接识别时写的细分点（去掉和章、知识点名重复的） */
export function subKnowledgeOf(q: DigitizedQuestion): string[] {
  const t = q.topic;
  if (!t) return q.knowledgePoints.slice(1);
  return [t.name, ...q.knowledgePoints.filter((k) => k !== t.name && k !== t.chapter)].slice(0, 3);
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
    knowledge: knowledgeOf(q),
    subKnowledge: subKnowledgeOf(q),
    topicId: q.topic?.id,
    kind: kindOf(q),
    q,
    parts: partsOf(paper, q),
    stem: focusSentence(stripLeadingNumber(unwrapLines(q.stemText), q.number)),
    sectionLabel: sectionOf(paper, q),
    figures: figuresOfQuestion(paper, q),
  }));
}

/** 文件夹里的错题：重复扫描的试卷不计，不同试卷里的同一道题合成一条 */
export function folderErrors(folder: Folder): ErrorItem[] {
  return mergeRepeats(folder.papers.filter(countsInSummary).flatMap((p) => paperErrors(folder, p)));
}

/** 全部错题（错题库、错题榜、首页）：同上，跨文件夹合并 */
export function allErrors(folders: Folder[]): ErrorItem[] {
  return mergeRepeats(folders.flatMap((f) => f.papers.filter(countsInSummary).flatMap((p) => paperErrors(f, p))));
}

/** 同一道题错过几次：这一条加上合并进来的 */
export const timesWrong = (e: ErrorItem) => 1 + (e.repeats?.length ?? 0);

/** 这道题出现在哪几份试卷（含合并进来的） */
export const paperIdsOf = (e: ErrorItem) => [e.paperId, ...(e.repeats ?? []).map((r) => r.paperId)];

/** 把不同试卷里的同一道题合成一条：留最近扫的那次，较早的放进 repeats。顺序按留下的那条第一次出现的位置 */
export function mergeRepeats(items: ErrorItem[]): ErrorItem[] {
  const groups: ErrorItem[][] = [];
  const byKey = new Map<string, ErrorItem[]>();
  const buckets = new Map<string, ErrorItem[][]>(); // 学科 + 数字相同的组，给模糊匹配用
  for (const it of items) {
    const q = it.q;
    if (!q.qKey) {
      groups.push([it]);
      continue;
    }
    let group = byKey.get(q.qKey);
    if (!group) {
      const bucket = `${q.subject}|${q.qNums ?? ""}`;
      group = (buckets.get(bucket) ?? []).find((g) => g[0].paperId !== it.paperId && sameQuestion(g[0].q, q));
      if (!group) {
        group = [];
        groups.push(group);
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), group]);
      }
      byKey.set(q.qKey, group);
    }
    // 同一份试卷里指纹相同的（同一道题印了两遍、或题干太像）不合并
    if (group.length && group.some((g) => g.paperId === it.paperId)) {
      groups.push([it]);
      continue;
    }
    group.push(it);
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    const sorted = [...g].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return { ...sorted[0], repeats: sorted.slice(1) };
  });
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
    const source = [it, ...(it.repeats ?? [])].map((r) => `${r.folderName} · ${r.paperName}`).filter((v, i, a) => a.indexOf(v) === i).join("；");
    if (isPassageBlank) {
      const key = `${it.paperId}:${q.sheet}:${q.blockIndex}`;
      const existing = byBlock.get(key);
      if (existing) {
        existing.answers.push(answer);
        existing.number = `${existing.answers[0].number}–${q.number}`;
        continue;
      }
      // 短文：把当前空的「____」也标上编号，整篇只放一次
      const stem = stripLeadingNumber(unwrapLines(q.stemText), q.number).replace(/(^|[^)])____/, `$1(${q.number})____`);
      const item: BookItem = { number: q.number, stem, options: q.options, knowledge: it.knowledge, source, answers: [answer], figures: it.figures };
      byBlock.set(key, item);
      out.push(item);
      continue;
    }
    out.push({ number: q.number, stem: stripLeadingNumber(unwrapLines(q.stemText), q.number), options: q.options, knowledge: it.knowledge, source, answers: [answer], figures: it.figures });
  }
  return out;
}
