/** 错题分析：按时间范围统计最近错题的特点，供首页摘要和「分析」页的图表使用。全部在本机算，不调接口。 */
import type { Subject } from "../api/types";
import { groupByKnowledge, groupBySubject, type ErrorItem } from "./errors";
import { SUBJECT_LABEL } from "./format";

export type Range = "7d" | "30d" | "all";

export const RANGE_LABEL: Record<Range, string> = { "7d": "近 7 天", "30d": "近 30 天", all: "全部" };

const DAY = 86400000;

export function inRange(items: ErrorItem[], range: Range, now = Date.now()): ErrorItem[] {
  if (range === "all") return items;
  const from = now - (range === "7d" ? 7 : 30) * DAY;
  return items.filter((e) => new Date(e.scannedAt).getTime() >= from);
}

/** 某个时刻之后新扫出来的错题（「自上次导出后新增」） */
export function since(items: ErrorItem[], iso: string | null): ErrorItem[] {
  if (!iso) return items;
  const t = new Date(iso).getTime();
  return items.filter((e) => new Date(e.scannedAt).getTime() > t);
}

/** 最近 n 周每周的错题数，最早的在前；周一为一周开始 */
export function weeklyTrend(items: ErrorItem[], weeks = 8, now = new Date()): { label: string; start: number; count: number }[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const out = Array.from({ length: weeks }, (_, i) => {
    const start = monday.getTime() - (weeks - 1 - i) * 7 * DAY;
    const d = new Date(start);
    return { label: i === weeks - 1 ? "本周" : `${d.getMonth() + 1}/${d.getDate()}`, start, count: 0 };
  });
  for (const e of items) {
    const t = new Date(e.scannedAt).getTime();
    for (let i = out.length - 1; i >= 0; i--) {
      if (t >= out[i].start) {
        if (t < out[i].start + 7 * DAY) out[i].count += 1;
        break;
      }
    }
  }
  return out;
}

export interface Insight {
  total: number;
  wrong: number;
  blank: number;
  knowledge: [string, ErrorItem[]][]; // 错得多的在前
  subjects: [Subject, ErrorItem[]][];
  summary: string; // 一句话总结
}

export function analyze(items: ErrorItem[]): Insight {
  const blank = items.filter((e) => e.kind === "未作答").length;
  const knowledge = groupByKnowledge(items);
  const subjects = groupBySubject(items);
  return { total: items.length, wrong: items.length - blank, blank, knowledge, subjects, summary: summarize(items, knowledge, subjects, blank) };
}

/** 自动写一句话：错题集中在哪、未作答多不多，给出下一步建议 */
function summarize(items: ErrorItem[], knowledge: [string, ErrorItem[]][], subjects: [Subject, ErrorItem[]][], blank: number): string {
  if (items.length === 0) return "这段时间没有错题，继续保持。";
  const parts: string[] = [];
  const [topKp, topList] = knowledge[0];
  const share = Math.round((topList.length / items.length) * 100);
  if (subjects.length > 1) parts.push(`${SUBJECT_LABEL[subjects[0][0]]}错得最多（${subjects[0][1].length} 题）`);
  parts.push(knowledge.length > 1 && share >= 25 ? `「${topKp}」占了 ${share}%，是最该先补的知识点` : `错题分散在 ${knowledge.length} 个知识点，最多的是「${topKp}」`);
  if (blank / items.length >= 0.3) parts.push(`有 ${blank} 题没作答，可能是时间不够或没思路`);
  return parts.join("；") + "。";
}
