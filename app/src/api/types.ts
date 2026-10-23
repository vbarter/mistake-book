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

export type Mark = "correct" | "wrong" | "partial" | "blank" | "unmarked"; // blank = 未作答，单独一类

/** 卷面上的一个空：空号、学生手写、老师批改、正确答案 */
export interface DigitizedBlank {
  id: string; // 在 text 里以 [[id]] 占位；编号空就是题号（"36"），一题多空为 "52-1" "52-2"
  number: string;
  student: string; // 手写转写，看不清的字为「□」
  mark: Mark;
  note: string;
  answer: string;
  analysis: string;
}

export type BlockType = "section" | "passage" | "wordbank" | "item" | "text";

/** 电子版试卷里的一个版面块，按原卷阅读顺序排列 */
export interface DigitizedBlock {
  type: BlockType;
  text: string; // passage / item / text 的正文，空格用 [[id]] 占位
  label: string; // section 的大题编号、passage 的篇号
  title: string; // section 标题
  instruction: string; // section 的作答说明 / item 的改写要求
  points: string; // section 分值
  number: string; // item 题号
  hint: string; // item 句末括号给词
  options: string[]; // wordbank 词库 / 选择题选项
  blanks: DigitizedBlank[];
  bbox: number[];
  subject: Subject;
  questionType: QuestionType;
  knowledgePoints: string[];
  tip: string;
  uncertainSpans: string[];
}

/** 从版面块派生出的一道可收录的题（一个编号空 = 一题） */
export interface DigitizedQuestion {
  index: number;
  page: number;
  number: string;
  subject: Subject;
  questionType: QuestionType;
  stemText: string;
  options: string[];
  studentAnswer: string;
  mark: Mark;
  teacherNote: string;
  bbox: number[];
  knowledgePoints: string[];
  correctAnswer: string;
  analysis: string;
  tip: string;
  uncertainSpans: string[];
  sheet: number;
  blockIndex: number;
  blankIds: string[];
}

/** 一张电子版卷面；一张照片拍到左右两页时对应两个 sheet */
export interface DigitizedPage {
  page: number;
  label: string;
  title: string;
  score: string;
  note: string;
  examLevel: string; // 考试类型：单元测 / 期中 / 中考模拟 / 高考 …
  examGrade: string; // 年级 / 学段
  region: string; // 地区
  syllabus: string; // 知识点归类依据的考纲 / 课标
  blocks: DigitizedBlock[];
}

export interface DigitizedResult {
  pages: DigitizedPage[];
  questions: DigitizedQuestion[];
  provider?: string;
  at?: string;
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
