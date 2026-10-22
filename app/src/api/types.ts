export type Subject = "math" | "chinese" | "english" | "science";
export type Reason = "concept" | "misread" | "method" | "calculation" | "careless";
export type QuestionType = "choice" | "fill" | "solve";
export type Mastery = "due" | "learning" | "mastered";
export type Rating = "forgot" | "fuzzy" | "remembered";

export interface User {
  id: string;
  phone: string | null;
  loginMethod: "apple" | "phone" | "guest";
  nickname: string;
  grade: string;
  subjects: Subject[];
  weeklyGoal: number;
  reviewReminder: { enabled: boolean; hour: number; minute: number };
  createdAt: string;
}

export interface HistoryEntry {
  kind: string;
  result: string;
  at: string;
}

export interface Variant {
  question: string;
  questionType: QuestionType;
  options: string[];
  answer: string;
  analysis: string;
}

export interface Mistake {
  id: string;
  subject: Subject;
  knowledgePoints: string[];
  questionType: QuestionType;
  options: string[];
  stemText: string;
  stemImageUrl: string | null;
  studentAnswer: string;
  reasons: Reason[];
  note: string;
  source: { name?: string; page?: number; date?: string };
  mastery: Mastery;
  manualMastered: boolean;
  wrongCount: number;
  aiPending: boolean;
  review: { intervalIndex: number; nextDueAt: string | null; streak: number };
  createdAt: string;
  updatedAt: string;
  // 详情才有
  correctAnswer?: string;
  analysis?: string;
  tip?: string;
  aiGenerated?: boolean;
  uncertainSpans?: string[];
  variants?: Variant[];
  masteredAt?: string | null;
  history?: HistoryEntry[];
}

export interface RecognizedItem {
  subject: Subject;
  knowledgePoints: string[];
  stemText: string;
  questionType: QuestionType;
  options: string[];
  uncertainSpans: string[];
  studentAnswer: string;
  correctAnswer: string;
  analysis: string;
  tip: string;
  aiGenerated: boolean;
  index?: number; // 服务端返回的截图序号，用于回填本地裁剪图
  page?: number; // 整页扫描：所在页
  bbox?: number[]; // 整页扫描：归一化位置 [x0, y0, x1, y1]
  reason?: string; // 整页扫描：判错依据
  // 本地补充（服务端不回传图片，截图由客户端按 index 回填）
  stemImage: string;
  reasons: Reason[];
  note: string;
}

export interface TopicGroup {
  subject: Subject;
  topic: string;
  total: number;
  due: number;
  learning: number;
  mastered: number;
  latestAt: string | null;
  masteryRate: number;
}

export interface GroupsResponse {
  sections: { subject: Subject; total: number; mastered: number; topics: TopicGroup[] }[];
  summary: { topics: number; total: number; mastered: number; due: number };
}

export interface Overview {
  total: number;
  mastered: number;
  due: number;
  dueBySubject: Record<string, number>;
  masteryRate: number;
  weekNew: number;
  weekMastered: number;
  weekReviewed: number;
  weeklyGoal: number;
  week: { date: string; done: boolean; isToday: boolean; future: boolean }[];
  streakDays: number;
  subjects: { subject: Subject; total: number; mastered: number; due: number }[];
  recent: Mistake[];
}

export interface TodayResponse {
  items: Mistake[];
  total: number;
  doneToday: number;
  overflow: number;
  tomorrow: number;
  estimatedMinutes: number;
}

export interface WeakTopic {
  subject: Subject;
  topic: string;
  total: number;
  mastered: number;
  wrongCount: number;
  masteryRate: number;
}

export interface PracticeItem {
  index: number;
  mistakeId: string;
  subject: Subject;
  topic: string;
  question: string;
  questionType: QuestionType;
  options: string[];
  isVariant: boolean;
  answer?: string;
  analysis?: string;
}

export interface PracticeSession {
  id: string;
  mode: "weak" | "custom";
  topic: string | null;
  subject: Subject | null;
  items: PracticeItem[];
  answers: Record<string, { answer: string; correct: boolean }>;
  startedAt: string;
  finishedAt: string | null;
}

export interface PracticeResult {
  correct: number;
  answered: number;
  total: number;
  rate: number;
  topics: { topic: string; before: number; after: number }[];
  newlyMastered: Mistake[];
}
