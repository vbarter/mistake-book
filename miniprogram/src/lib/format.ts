import type { Mastery, QuestionType, Rating, Reason, Subject } from "./types";

export const SUBJECTS: Subject[] = ["math", "chinese", "english", "science", "physics", "chemistry", "biology", "history", "geography", "politics"];
export const SUBJECT_LABEL: Record<Subject, string> = { math: "数学", chinese: "语文", english: "英语", science: "科学", physics: "物理", chemistry: "化学", biology: "生物", history: "历史", geography: "地理", politics: "道法" };
/** 小学只有前四科；初高中换成理化生史地道 */
export const SUBJECT_GROUPS: { label: string; subjects: Subject[] }[] = [
  { label: "基础", subjects: ["math", "chinese", "english"] },
  { label: "小学", subjects: ["science"] },
  { label: "初高中", subjects: ["physics", "chemistry", "biology", "history", "geography", "politics"] },
];
export const REASONS: Reason[] = ["concept", "misread", "method", "calculation", "careless"];
export const REASON_LABEL: Record<Reason, string> = {
  concept: "概念不清",
  misread: "审题错误",
  method: "方法不当",
  calculation: "计算失误",
  careless: "粗心",
};
export const MASTERY_LABEL: Record<Mastery, string> = { due: "待复习", learning: "巩固中", mastered: "已掌握" };
export const QTYPE_LABEL: Record<QuestionType, string> = { choice: "选择题", fill: "填空题", solve: "解答题" };
export const RATING_LABEL: Record<Rating, string> = { forgot: "忘了", fuzzy: "模糊", remembered: "记得" };
export const GRADE_LABEL: Record<string, string> = { "1": "一年级", "2": "二年级", "3": "三年级", "4": "四年级", "5": "五年级", "6": "六年级", "7": "七年级", "8": "八年级", "9": "九年级", "10": "高一", "11": "高二", "12": "高三" };
export const GRADE_GROUPS: { label: string; grades: string[] }[] = [
  { label: "小学", grades: ["1", "2", "3", "4", "5", "6"] },
  { label: "初中", grades: ["7", "8", "9"] },
  { label: "高中", grades: ["10", "11", "12"] },
];


export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function todayLabel(): string {
  const d = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${week}`;
}

export function relativeDue(iso: string | null): string {
  if (!iso) return "";
  const due = new Date(iso);
  const now = new Date();
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天后`;
}

export function daysLabel(days: number): string {
  if (days <= 1) return "明天";
  return `${Math.round(days)} 天后`;
}

export function greetingHint(): string {
  const h = new Date().getHours();
  if (h >= 18) return "今天的作业有错题吗？";
  if (h >= 12) return "试卷发回当天录，最不容易漏";
  return "早上好，先把昨天的错题收进来";
}

export function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

const LINE_START = /^\s*(?:[A-H][.、．)）]|\(?\d{1,3}[.)）、．]|[①-⑳]|[一二三四五六七八九十]+[、.．]|[(（]\d{1,3}[)）])/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/** 把 OCR 带来的排版换行合回一行（老数据用；新扫描的服务端已处理）：一句话被折成两行时合并，空行和以选项 / 题号 / 序号开头的行保持换行 */
export function unwrapLines(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/[ \t]{2,}/g, " ");
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && !LINE_START.test(line)) {
      const glue = CJK.test(prev[prev.length - 1]) && CJK.test(line[0]) ? "" : " ";
      out[out.length - 1] = prev + glue + line;
    } else out.push(line);
  }
  return out.join("\n").trim();
}

/** 题干开头重复的原卷题号去掉：「3. 如图」「3、如图」「3 如图」「(3)如图」→「如图」（老数据用；新扫描的服务端已处理）。
 *  只认和本题题号相同的数字；只隔空格时要求后面紧跟汉字 / 公式 / 括号 / 大写开头的单词，「3个苹果」「3x+1」「3.5 米」这种不动。 */
export function stripLeadingNumber(text: string, number: string | undefined): string {
  const n = (number ?? "").trim().replace(/[.．、\s]+$/, "");
  if (!n || !text) return text;
  const num = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(?:[(（]${num}[)）]\\s*|${num}\\s*[.．、](?!\\d)\\s*|${num}\\s+(?=[\\u3400-\\u9fff$（(“"]|[A-Z][a-z]))`);
  const out = text.replace(re, "");
  return out.trim() ? out : text;
}
