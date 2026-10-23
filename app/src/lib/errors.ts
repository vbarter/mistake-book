/** 错题汇总：把文件夹里扫描出的判错题（含未作答）收集成统一记录，供文件夹汇总、错题库和导出使用。 */
import type { DigitizedQuestion, Subject } from "../api/types";
import { isBlank, isProblem, validDigitized, type Folder, type Paper } from "./folders";

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
  corrected: boolean;
  correctedAt?: string;
  q: DigitizedQuestion;
  sectionLabel: string; // 所属大题，如「Ⅳ Complete the sentences…」
}

export const UNANSWERED = "未作答";

export function kindOf(q: DigitizedQuestion): ErrorKind {
  if (isBlank(q)) return "未作答";
  return q.mark === "partial" ? "半对" : "答错";
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
    corrected: Boolean(paper.corrected?.[String(q.index)]),
    correctedAt: paper.corrected?.[String(q.index)],
    q,
    sectionLabel: sectionOf(paper, q),
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
      const stem = q.stemText.replace(/(^|[^)])____/, `$1(${q.number})____`);
      const item: BookItem = { number: q.number, stem, options: q.options, knowledge: it.knowledge, source, answers: [answer] };
      byBlock.set(key, item);
      out.push(item);
      continue;
    }
    out.push({ number: q.number, stem: q.stemText, options: q.options, knowledge: it.knowledge, source, answers: [answer] });
  }
  return out;
}
