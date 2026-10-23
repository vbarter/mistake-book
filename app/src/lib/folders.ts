/** 文件夹 → 试卷 → 照片：本地 IndexedDB 存储，不上传服务器。
 *
 * 一次考试一个文件夹，一个文件夹装多张试卷；每张试卷有若干照片和 AI 还原的电子版。
 * 错题不再单独"收录"：扫描完的试卷里判错的题自动算进文件夹和错题库，订正状态记在试卷上。
 */
import type { DigitizedQuestion, DigitizedResult, Mark, QuestionType, Subject } from "../api/types";

export interface FolderPage {
  id: string;
  src: string; // dataURL
  width: number;
  height: number;
}

export interface Paper {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: FolderPage[];
  scannedAt?: string;
  digitized?: DigitizedResult;
  corrected?: Record<string, string>; // 题 index → 订正时间
}

export interface Folder {
  id: string;
  name: string;
  subject?: Subject; // 不设时按扫描结果推断
  createdAt: string;
  updatedAt: string;
  papers: Paper[];
}

/** 1.x 的记录：一个夹就是一张试卷 */
interface LegacyFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: FolderPage[];
  scannedAt?: string;
  digitized?: DigitizedResult;
}

const DB = "zhicuoben";
const STORE = "folders";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function defaultFolderName(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 试卷`;
}

export function defaultPaperName(folder: Folder | null | undefined): string {
  return `第 ${(folder?.papers.length ?? 0) + 1} 张`;
}

/** 旧结构（一夹一卷）升级为文件夹里的一张试卷；旧电子版没有版面块的一律当未扫描 */
function normalize(raw: Folder | LegacyFolder): { folder: Folder; migrated: boolean } {
  if (Array.isArray((raw as Folder).papers)) {
    const f = raw as Folder;
    return { folder: { ...f, papers: f.papers.map((p) => ({ ...p, digitized: validDigitized(p.digitized) ?? undefined, corrected: p.corrected ?? {} })) }, migrated: false };
  }
  const old = raw as LegacyFolder;
  const digitized = validDigitized(old.digitized) ?? undefined;
  const paper: Paper = { id: newId(), name: "第 1 张", createdAt: old.createdAt, updatedAt: old.updatedAt, pages: old.pages ?? [], scannedAt: digitized ? old.scannedAt : undefined, digitized, corrected: {} };
  return { folder: { id: old.id, name: old.name, createdAt: old.createdAt, updatedAt: old.updatedAt, papers: paper.pages.length ? [paper] : [] }, migrated: true };
}

export async function listFolders(): Promise<Folder[]> {
  const all = await tx<(Folder | LegacyFolder)[]>("readonly", (s) => s.getAll());
  const out: Folder[] = [];
  for (const raw of all) {
    const { folder, migrated } = normalize(raw);
    if (migrated) await tx("readwrite", (s) => s.put(folder));
    out.push(folder);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getFolder(id: string): Promise<Folder | undefined> {
  const raw = await tx<Folder | LegacyFolder | undefined>("readonly", (s) => s.get(id));
  if (!raw) return undefined;
  const { folder, migrated } = normalize(raw);
  if (migrated) await tx("readwrite", (s) => s.put(folder));
  return folder;
}

export async function saveFolder(folder: Folder): Promise<Folder> {
  const next = { ...folder, updatedAt: new Date().toISOString() };
  await tx("readwrite", (s) => s.put(next));
  return next;
}

export async function createFolder(name: string, subject?: Subject): Promise<Folder> {
  const now = new Date().toISOString();
  return saveFolder({ id: newId(), name: name.trim() || defaultFolderName(), subject, createdAt: now, updatedAt: now, papers: [] });
}

export async function deleteFolder(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** 往文件夹里加一张试卷（没有文件夹就先建一个） */
export async function addPaper(folderId: string | null, pages: FolderPage[], name?: string): Promise<{ folder: Folder; paper: Paper }> {
  const folder = (folderId && (await getFolder(folderId))) || (await createFolder(defaultFolderName()));
  const now = new Date().toISOString();
  const paper: Paper = { id: newId(), name: name?.trim() || defaultPaperName(folder), createdAt: now, updatedAt: now, pages, corrected: {} };
  const saved = await saveFolder({ ...folder, papers: [...folder.papers, paper] });
  return { folder: saved, paper };
}

export async function updatePaper(folderId: string, paperId: string, patch: Partial<Paper>): Promise<Folder | undefined> {
  const folder = await getFolder(folderId);
  if (!folder) return undefined;
  const now = new Date().toISOString();
  return saveFolder({ ...folder, papers: folder.papers.map((p) => (p.id === paperId ? { ...p, ...patch, updatedAt: now } : p)) });
}

export async function deletePaper(folderId: string, paperId: string): Promise<Folder | undefined> {
  const folder = await getFolder(folderId);
  if (!folder) return undefined;
  return saveFolder({ ...folder, papers: folder.papers.filter((p) => p.id !== paperId) });
}

/** 标记 / 取消某题已订正 */
export async function setCorrected(folderId: string, paperId: string, questionIndex: number, on: boolean): Promise<Folder | undefined> {
  const folder = await getFolder(folderId);
  const paper = folder?.papers.find((p) => p.id === paperId);
  if (!folder || !paper) return folder;
  const corrected = { ...(paper.corrected ?? {}) };
  if (on) corrected[String(questionIndex)] = new Date().toISOString();
  else delete corrected[String(questionIndex)];
  return updatePaper(folderId, paperId, { corrected });
}

/** 把 dataURL 变成照片记录（读出尺寸）。 */
export function toPage(src: string): Promise<FolderPage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ id: newId(), src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

/** 旧版本存的电子版没有版面块（blocks）或空 id（blankIds），当作未扫描，重扫即可 */
export function validDigitized(d: DigitizedResult | undefined | null): DigitizedResult | null {
  if (!d || !Array.isArray(d.pages) || !Array.isArray(d.questions)) return null;
  if (!d.pages.every((p) => Array.isArray(p.blocks)) || !d.questions.every((q) => Array.isArray(q.blankIds))) return null;
  return d;
}

const normAnswer = (s: string) => s.trim().toLowerCase().replace(/．/g, ".").replace(/，/g, ",").replace(/\s+/g, " ").replace(/[.。,，;；!！?？ ]+$/, "");

/**
 * 老师没批改但模型给了正确答案时，自动对照学生作答判对错（和服务端 auto_mark 同一规则，给旧扫描结果用）。
 * 只对选择 / 填空做，看不清（□）不判；answer 里用 / 或 ； 分隔的视为多个可接受答案。
 */
export function autoMark(mark: Mark, student: string, answer: string, questionType: QuestionType): Mark {
  if (mark !== "unmarked" || questionType === "solve") return mark;
  const s = student.trim();
  const a = answer.trim();
  if (!s || !a || s.includes("□") || a.length > 60) return mark;
  const alts = a.split(/[/／;；]|\s或\s/).map(normAnswer).filter(Boolean);
  const ns = normAnswer(s);
  if (alts.some((x) => x === ns)) return "correct";
  if (ns.length === 1 && alts.some((x) => x[0] === ns && /^[a-h][.、．\s]/.test(x))) return "correct";
  return "wrong";
}

/** 一题的有效判定：一题多空（作答与答案都用「；」拼接）逐空比较后聚合 */
export function effectiveMark(q: DigitizedQuestion): Mark {
  if (q.mark !== "unmarked") return q.mark;
  const students = q.studentAnswer.split("；");
  const answers = q.correctAnswer.split("；");
  if (answers.length > 1 && students.length === answers.length) {
    const marks = answers.map((a, i) => autoMark("unmarked", students[i] ?? "", a, q.questionType));
    if (marks.every((m) => m === "correct")) return "correct";
    if (marks.some((m) => m === "wrong")) return marks.some((m) => m === "correct") ? "partial" : "wrong";
    return "unmarked";
  }
  return autoMark(q.mark, q.studentAnswer, q.correctAnswer, q.questionType);
}

/** 答错（含半对） */
export const isWrong = (q: DigitizedQuestion) => {
  const m = effectiveMark(q);
  return m === "wrong" || m === "partial";
};
/** 未作答：新数据是 blank；旧数据存成 wrong + 空作答 */
export const isBlank = (q: DigitizedQuestion) => q.mark === "blank" || (q.mark === "wrong" && !q.studentAnswer.trim());
/** 答错或未作答都需要订正 */
export const isProblem = (q: DigitizedQuestion) => isBlank(q) || isWrong(q);
/** 真正答错（排除未作答） */
export const isReallyWrong = (q: DigitizedQuestion) => isWrong(q) && !isBlank(q);

/** 一张试卷的统计 */
export function paperStats(paper: Paper): { scanned: boolean; total: number; wrong: number; blank: number; problems: number; correct: number; corrected: number } {
  const d = validDigitized(paper.digitized);
  if (!d) return { scanned: false, total: 0, wrong: 0, blank: 0, problems: 0, correct: 0, corrected: 0 };
  const problems = d.questions.filter(isProblem);
  const blank = problems.filter(isBlank).length;
  const corrected = problems.filter((q) => paper.corrected?.[String(q.index)]).length;
  return { scanned: true, total: d.questions.length, wrong: problems.length - blank, blank, problems: problems.length, correct: d.questions.filter((q) => effectiveMark(q) === "correct").length, corrected };
}

/** 一个文件夹的统计与推断信息（学科、考试信息） */
export function folderStats(folder: Folder): { papers: number; unscanned: number; wrong: number; blank: number; problems: number; corrected: number; subject: Subject | null; exam: string; syllabus: string } {
  let wrong = 0;
  let blank = 0;
  let corrected = 0;
  let unscanned = 0;
  const subjectCount = new Map<Subject, number>();
  let exam = "";
  let syllabus = "";
  for (const p of folder.papers) {
    const st = paperStats(p);
    if (!st.scanned) unscanned += 1;
    wrong += st.wrong;
    blank += st.blank;
    corrected += st.corrected;
    const d = validDigitized(p.digitized);
    if (d) {
      for (const q of d.questions) subjectCount.set(q.subject, (subjectCount.get(q.subject) ?? 0) + 1);
      const sheet = d.pages.find((s) => s.examLevel || s.region || s.examGrade);
      if (sheet && !exam) exam = [sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ");
      const sy = d.pages.find((s) => s.syllabus)?.syllabus;
      if (sy && !syllabus) syllabus = sy;
    }
  }
  const guessed = [...subjectCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { papers: folder.papers.length, unscanned, wrong, blank, problems: wrong + blank, corrected, subject: folder.subject ?? guessed, exam, syllabus };
}
