import type { Mastery, QuestionType, Rating, Reason, Subject } from "../api/types";

export const SUBJECTS: Subject[] = ["math", "chinese", "english", "science"];
export const SUBJECT_LABEL: Record<Subject, string> = { math: "数学", chinese: "语文", english: "英语", science: "科学" };
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
export const GRADE_LABEL: Record<string, string> = { "3": "三年级", "4": "四年级", "5": "五年级", "6": "六年级" };

export function subjectStyle(s: Subject): { color: string; background: string } {
  return { color: `var(--${s})`, background: `var(--${s}-bg)` };
}
export function masteryStyle(m: Mastery): { color: string; background: string } {
  return { color: `var(--${m})`, background: `var(--${m}-bg)` };
}

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
