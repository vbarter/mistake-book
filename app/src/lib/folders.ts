/** 文件夹 → 试卷 → 照片：本地 IndexedDB 存储，不上传服务器。
 *
 * 一次考试一个文件夹，一个文件夹装多张试卷；每张试卷有若干照片和 AI 还原的电子版。
 * 错题不再单独"收录"：扫描完的试卷里判错的题（含未作答）自动算进文件夹和错题库。
 */
import type { DigitizedQuestion, DigitizedResult, Mark, PhotoIssue, QuestionType, Subject } from "../api/types";

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
  subject?: Subject; // 扫描时从卷头判断
  corrected?: Record<string, string>; // 已停用（订正功能已去掉），老数据里可能还有，读时忽略
  scanJob?: { id: string; startedAt: string; parts: { page: number; x0: number; w: number }[]; progress: number; status: "queued" | "running"; startedPages?: number; waiting?: number }; // 服务器后台还原中
  scanError?: string; // 上次还原失败的原因
}

export interface Folder {
  id: string;
  name: string;
  subject?: Subject; // 不设时按扫描结果推断
  createdAt: string;
  updatedAt: string;
  papers: Paper[];
  order?: number; // 用户手动排过序后才有：越小越靠前；没排过的（新建的）排在最前，按更新时间倒序
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
  return out.sort(compareFolders);
}

/** 没手动排过的在前（更新时间倒序），手动排过的按 order */
function compareFolders(a: Folder, b: Folder): number {
  const ao = a.order ?? -1;
  const bo = b.order ?? -1;
  if (ao < 0 && bo < 0) return b.updatedAt.localeCompare(a.updatedAt);
  if (ao < 0 || bo < 0) return ao < 0 ? -1 : 1;
  return ao - bo;
}

/** 用户拖动排序后按新顺序写 order；不改 updatedAt */
export async function reorderFolders(ids: string[]): Promise<void> {
  const all = await listFolders();
  const byId = new Map(all.map((f) => [f.id, f]));
  const ordered = [...ids.filter((id) => byId.has(id)), ...all.filter((f) => !ids.includes(f.id)).map((f) => f.id)];
  for (let i = 0; i < ordered.length; i++) {
    const f = byId.get(ordered[i])!;
    if (f.order !== i) await tx("readwrite", (s) => s.put({ ...f, order: i }));
  }
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

/** 用户拖动调整文件夹里试卷的先后；不改 updatedAt */
export async function reorderPapers(folderId: string, ids: string[]): Promise<Folder | undefined> {
  const folder = await getFolder(folderId);
  if (!folder) return undefined;
  const byId = new Map(folder.papers.map((p) => [p.id, p]));
  const papers = [...ids.map((id) => byId.get(id)).filter((p): p is Paper => Boolean(p)), ...folder.papers.filter((p) => !ids.includes(p.id))];
  const next = { ...folder, papers };
  await tx("readwrite", (s) => s.put(next));
  return next;
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
/** 学生作答整个看不清：去掉空白和标点后只剩「□」 */
export function isUnreadable(student: string | undefined): boolean {
  const core = (student || "").replace(/[\s,，.。;；:：()（）$\\]/g, "");
  return core.length > 0 && [...core].every((c) => c === "□");
}

export const PHOTO_ISSUE_LABEL: Record<PhotoIssue, string> = { blurry: "模糊", cropped: "不完整", dark: "太暗", glare: "反光", tilted: "歪斜", covered: "有遮挡" };

/** 一张试卷的拍摄质量：识别时模型报告的问题 + 看不清的字有多少。warn 时在试卷行和试卷页提示重拍 */
export function paperQuality(paper: Paper): { warn: boolean; label: string; detail: string; issues: PhotoIssue[]; unreadable: number } {
  const d = validDigitized(paper.digitized);
  if (!d) return { warn: false, label: "", detail: "", issues: [], unreadable: 0 };
  const issues = [...new Set(d.pages.flatMap((s) => s.photoIssues ?? []))];
  const notes = [...new Set(d.pages.map((s) => s.photoNote ?? "").filter(Boolean))];
  let unreadable = 0;
  for (const s of d.pages)
    for (const b of s.blocks) {
      unreadable += ((b.text || "").match(/□/g) ?? []).length;
      for (const x of b.blanks) if (x.student.includes("□")) unreadable += 1;
    }
  const warn = issues.length > 0 || unreadable >= 3;
  const label = issues.includes("cropped") ? "拍得不完整" : "拍得不清楚";
  const what = issues.length ? `照片${issues.map((x) => PHOTO_ISSUE_LABEL[x]).join("、")}` : "";
  const detail = [what, ...notes, unreadable ? `有 ${unreadable} 处内容没识别出来` : ""].filter(Boolean).join("；");
  return { warn, label, detail, issues, unreadable };
}

export function validDigitized(d: DigitizedResult | undefined | null): DigitizedResult | null {
  if (!d || !Array.isArray(d.pages) || !Array.isArray(d.questions)) return null;
  if (!d.pages.every((p) => Array.isArray(p.blocks)) || !d.questions.every((q) => Array.isArray(q.blankIds))) return null;
  return dropGhostSheets(d);
}

/** 和服务端 drop_ghost_sheets 同一规则，让以前扫描、带着照片边缘残片的试卷不用重扫也能去重：
 *  别的卷面有页码、这张没有（或这张既没页码也没大题标题）时视为可疑卷面；可疑卷面里和正常卷面空号重复的短文整段丢，
 *  题号和题干都相同的小题丢；丢完没题的可疑卷面整张去掉。对应的题目一起去掉，sheet 下标重排。 */
function dropGhostSheets(d: DigitizedResult): DigitizedResult {
  type Sheet = DigitizedResult["pages"][number];
  type Block = Sheet["blocks"][number];
  if (d.pages.length < 2) return d;
  const blockNums = (b: Block): string[] =>
    (b.type === "item" ? [b.number] : b.type === "passage" ? b.blanks.map((x) => x.number || x.id) : []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const textKey = (t: string) => (t || "").replace(/\[\[[^\]]*\]\]/g, "").replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, "").toLowerCase().slice(0, 12);
  const labeledAny = d.pages.some((s) => (s.label || "").trim());
  const suspect = (s: Sheet) => !(s.label || "").trim() && (labeledAny || !s.blocks.some((b) => b.type === "section"));
  const solidNums = new Set<string>();
  const solidItems = new Map<string, Set<string>>();
  d.pages.forEach((s) => {
    if (suspect(s)) return;
    s.blocks.forEach((b) => {
      blockNums(b).forEach((n) => solidNums.add(n));
      if (b.type === "item" && b.number?.trim()) {
        const set = solidItems.get(b.number.trim()) ?? new Set<string>();
        set.add(textKey(b.text));
        solidItems.set(b.number.trim(), set);
      }
    });
  });
  if (solidNums.size === 0) return d;

  const isQ = (b: Block) => b.type === "item" || b.type === "passage";
  // 残片上既没有题目原文、学生作答又全都看不清的题（照片边缘的半行字）
  const emptyFragment = (b: Block) =>
    isQ(b) && (b.text || "").replace(/\[\[[^\]]*\]\]/g, "").replace(/[\s\p{P}\p{S}_□]/gu, "").length < 6 && b.blanks.every((x) => !x.student.trim() || isUnreadable(x.student));
  const droppedBlocks = new Map<number, Set<number>>(); // sheet → 被丢掉的块下标
  const droppedSheets = new Set<number>();
  const pages = d.pages.map((s, si) => {
    if (!suspect(s)) return s;
    const gone = new Set<number>();
    s.blocks.forEach((b, bi) => {
      if (emptyFragment(b)) gone.add(bi);
      if (b.type === "passage" && blockNums(b).some((n) => solidNums.has(n))) gone.add(bi);
      if (b.type === "item" && solidItems.get((b.number || "").trim())?.has(textKey(b.text))) gone.add(bi);
    });
    if (gone.size === 0) return s;
    droppedBlocks.set(si, gone);
    const keep = s.blocks.filter((_, bi) => !gone.has(bi));
    if (s.blocks.some(isQ) && !keep.some(isQ)) droppedSheets.add(si);
    return { ...s, blocks: keep };
  });
  if (droppedBlocks.size === 0) return d;

  // 题目跟着去掉；blockIndex 按剩下的块重排，sheet 下标按剩下的卷面重排
  const sheetMap = new Map<number, number>();
  pages.forEach((_, i) => { if (!droppedSheets.has(i)) sheetMap.set(i, sheetMap.size); });
  const blockShift = (si: number, bi: number) => [...(droppedBlocks.get(si) ?? [])].filter((x) => x < bi).length;
  return {
    ...d,
    pages: pages.filter((_, i) => !droppedSheets.has(i)),
    questions: d.questions
      .filter((q) => q.sheet === undefined || (!droppedSheets.has(q.sheet) && !droppedBlocks.get(q.sheet)?.has(q.blockIndex)))
      .map((q) => (q.sheet === undefined ? q : { ...q, sheet: sheetMap.get(q.sheet)!, blockIndex: q.blockIndex - blockShift(q.sheet, q.blockIndex) })),
  };
}

const SUBSUP: Record<string, string> = Object.fromEntries([..."₀₁₂₃₄₅₆₇₈₉"].map((c, i) => [c, String(i)]).concat([..."⁰¹²³⁴⁵⁶⁷⁸⁹"].map((c, i) => [c, String(i)])));
/** 比较作答用：全角转半角，上下标数字转普通数字（O₂ 与 O2 相同），忽略大小写、空白和首尾标点 */
const normAnswer = (s: string) =>
  [...s]
    .map((c) => SUBSUP[c] ?? (c.charCodeAt(0) >= 0xff01 && c.charCodeAt(0) <= 0xff5e ? String.fromCharCode(c.charCodeAt(0) - 0xfee0) : c))
    .join("")
    .trim()
    .toLowerCase()
    .replace(/．/g, ".")
    .replace(/，/g, ",")
    .replace(/\s+/g, " ")
    .replace(/[.。,，;；!！?？ ]+$/, "");

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
/** 答错或未作答都算错题 */
export const isProblem = (q: DigitizedQuestion) => isBlank(q) || isWrong(q);
/** 真正答错（排除未作答） */
export const isReallyWrong = (q: DigitizedQuestion) => isWrong(q) && !isBlank(q);

/** 一张试卷的统计 */
export function paperStats(paper: Paper): { scanned: boolean; total: number; wrong: number; blank: number; problems: number; correct: number } {
  const d = validDigitized(paper.digitized);
  if (!d) return { scanned: false, total: 0, wrong: 0, blank: 0, problems: 0, correct: 0 };
  const problems = d.questions.filter(isProblem);
  const blank = problems.filter(isBlank).length;
  return { scanned: true, total: d.questions.length, wrong: problems.length - blank, blank, problems: problems.length, correct: d.questions.filter((q) => effectiveMark(q) === "correct").length };
}

/** 一个文件夹的统计与推断信息（学科、考试信息） */
/** 一张试卷的学科：扫描时存下的卷面学科，旧数据按题目多数推断 */
export function paperSubject(paper: Paper): Subject | null {
  if (paper.subject) return paper.subject;
  const d = validDigitized(paper.digitized);
  if (!d) return null;
  const fromSheet = d.pages.find((s) => s.subject)?.subject;
  if (fromSheet) return fromSheet;
  const counts = new Map<Subject, number>();
  for (const q of d.questions) counts.set(q.subject, (counts.get(q.subject) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function folderStats(folder: Folder): { papers: number; unscanned: number; wrong: number; blank: number; problems: number; subject: Subject | null; subjects: Subject[]; exam: string; syllabus: string } {
  let wrong = 0;
  let blank = 0;
  let unscanned = 0;
  const subjectCount = new Map<Subject, number>();
  let exam = "";
  let syllabus = "";
  for (const p of folder.papers) {
    const st = paperStats(p);
    if (!st.scanned) unscanned += 1;
    wrong += st.wrong;
    blank += st.blank;
    const ps = paperSubject(p);
    if (ps) subjectCount.set(ps, (subjectCount.get(ps) ?? 0) + 1);
    const d = validDigitized(p.digitized);
    if (d) {
      const sheet = d.pages.find((s) => s.examLevel || s.region || s.examGrade);
      if (sheet && !exam) exam = [sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ");
      const sy = d.pages.find((s) => s.syllabus)?.syllabus;
      if (sy && !syllabus) syllabus = sy;
    }
  }
  const ranked = [...subjectCount.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const subjects = folder.subject ? [folder.subject, ...ranked.filter((s) => s !== folder.subject)] : ranked;
  return { papers: folder.papers.length, unscanned, wrong, blank, problems: wrong + blank, subject: subjects[0] ?? null, subjects, exam, syllabus };
}
