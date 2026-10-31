/** 错题榜：把一段时间里的错题排成几张榜单。易错指数 0–100，越高越该先复习，全部在本机算。 */
import type { Subject } from "../api/types";
import type { ErrorItem } from "./errors";

export type Board = "question" | "knowledge" | "repeat" | "blank";

export const BOARDS: { id: Board; title: string; slogan: string }[] = [
  { id: "question", title: "易错题榜", slogan: "最该重做" },
  { id: "knowledge", title: "知识点榜", slogan: "哪里最弱" },
  { id: "repeat", title: "反复错榜", slogan: "一错再错" },
  { id: "blank", title: "空白榜", slogan: "没有思路" },
];

export interface RankRow {
  key: string;
  title: string; // 题干摘要 / 知识点名
  subject: Subject;
  score: number; // 易错指数
  meta: string[]; // 灰色小字
  quote: string; // 引号里的一句
  items: ErrorItem[]; // 点开看的题
}

const DAY = 86400000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const kindWeight = (e: ErrorItem) => (e.kind === "答错" ? 1 : e.kind === "未作答" ? 0.8 : 0.6);
const recency = (e: ErrorItem, now: number) => Math.max(0, 1 - (now - new Date(e.scannedAt).getTime()) / (30 * DAY));
const snippet = (t: string, n = 40) => {
  const s = t.replace(/\[\[[^\]]*\]\]/g, "____").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s || "（无题干）";
};

function byKnowledge(items: ErrorItem[]): Map<string, ErrorItem[]> {
  const m = new Map<string, ErrorItem[]>();
  for (const e of items) m.set(e.knowledge, [...(m.get(e.knowledge) ?? []), e]);
  return m;
}

/** 一道题的易错指数：同知识点错得越多、越是真错（不是半对）、越近，分越高 */
function questionScore(e: ErrorItem, kpCount: number, maxKp: number, now: number): number {
  return round1(52 + 24 * (kpCount / maxKp) + 12 * kindWeight(e) + 9 * recency(e, now) - (e.q.tip ? 0 : 0.5));
}

function kpRow(k: string, list: ErrorItem[], maxCount: number, now: number, extra?: string): RankRow {
  const papers = new Set(list.map((e) => e.paperId)).size;
  const latest = [...list].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))[0];
  const score = round1(52 + 30 * (list.length / maxCount) + 8 * Math.min(1, (papers - 1) / 2) + 7 * Math.max(...list.map((e) => recency(e, now))));
  const tip = list.find((e) => e.q.tip)?.q.tip;
  return {
    key: k,
    title: k,
    subject: list[0].subject,
    score,
    meta: [extra ?? `${list.length} 道题`, `来自 ${papers} 份试卷`],
    quote: tip ? `下次注意：${tip}` : `最近一道：${snippet(latest.stem, 28)}`,
    items: list,
  };
}

export function rank(items: ErrorItem[], board: Board, now = Date.now()): RankRow[] {
  const kps = byKnowledge(items);
  const maxKp = Math.max(1, ...[...kps.values()].map((l) => l.length));
  if (board === "question") {
    return items
      .map((e) => {
        const answer = e.kind === "未作答" ? `没作答 · 正确：${e.q.correctAnswer || "—"}` : `你写：${e.q.studentAnswer || "—"} · 正确：${e.q.correctAnswer || "—"}`;
        return {
          key: e.key,
          title: snippet(e.stem),
          subject: e.subject,
          score: questionScore(e, kps.get(e.knowledge)?.length ?? 1, maxKp, now),
          meta: [e.knowledge, `${e.paperName} 第 ${e.q.number} 题`],
          quote: e.q.tip ? `下次注意：${e.q.tip}` : answer,
          items: [e],
        };
      })
      .sort((a, b) => b.score - a.score);
  }
  if (board === "knowledge") {
    return [...kps.entries()].map(([k, l]) => kpRow(k, l, maxKp, now)).sort((a, b) => b.score - a.score);
  }
  if (board === "repeat") {
    return [...kps.entries()]
      .filter(([, l]) => new Set(l.map((e) => e.paperId)).size >= 2)
      .map(([k, l]) => kpRow(k, l, maxKp, now, `${new Set(l.map((e) => e.paperId)).size} 份试卷都错`))
      .sort((a, b) => b.score - a.score);
  }
  const blanks = byKnowledge(items.filter((e) => e.kind === "未作答"));
  const maxB = Math.max(1, ...[...blanks.values()].map((l) => l.length));
  return [...blanks.entries()].map(([k, l]) => kpRow(k, l, maxB, now, `${l.length} 道没作答`)).sort((a, b) => b.score - a.score);
}
