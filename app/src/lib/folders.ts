/** 文件夹 → 试卷 → 照片：本地 IndexedDB 存储，不上传服务器。
 *
 * 一次考试一个文件夹，一个文件夹装多张试卷；每张试卷有若干照片和 AI 还原的电子版。
 * 错题不再单独"收录"：扫描完的试卷里判错的题（含未作答）自动算进文件夹和错题库。
 */
import type { DigitizedQuestion, DigitizedResult, Mark, PhotoIssue, QuestionType, Subject } from "../api/types";

export interface FolderPage {
  id: string;
  width: number;
  height: number;
  thumb?: string; // 小图 dataURL（最长边 THUMB_SIDE），列表和录入页显示用
  src?: string; // 原图 dataURL：只在内存里带着（刚拍的、loadPages 读出来的）；存库时拆进照片表，文件夹记录里没有
}

/** 带着原图的照片（扫描上传、裁插图时用） */
export type FullPage = FolderPage & { src: string };

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
  scanJob?: { id: string; startedAt: string; parts: { page: number; x0: number; w: number }[]; progress: number; status: "queued" | "running"; startedPages?: number; waiting?: number; queued?: boolean }; // 服务器后台还原中
  scanError?: string; // 上次还原失败的原因
  gradedAt?: string; // 补做过 AI 阅卷的时间（避免反复请求）
  taggedAt?: string; // 补标过知识图谱知识点的时间（避免反复请求）
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
/** 原图单独存（{ id, src }，id 即照片 id）：读文件夹列表、轮询进度时不会把所有照片一起读进内存 */
const PHOTOS = "photos";

let conn: Promise<IDBDatabase> | null = null;

/** 整个 App 共用一个连接，不再每次读写都开关数据库 */
function open(): Promise<IDBDatabase> {
  if (conn) return conn;
  conn = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); conn = null; };
      db.onclose = () => { conn = null; };
      resolve(db);
    };
    req.onerror = () => { conn = null; reject(req.error); };
  });
  return conn;
}

/** 一个事务：fn 里发请求，事务提交后返回 fn 返回的那个请求的结果 */
function run<T = undefined>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const req = fn(t);
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("存储失败"));
      }),
  );
}

/**
 * 写入排队：所有改文件夹的操作一个接一个做，每次都在锁里重新读最新的记录再改。
 * 以前扫描轮询、批量建卷、补阅卷同时「读整个文件夹 → 改 → 写回」，后写的会把先写的盖掉（试卷或进度丢失）。
 */
let writing: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = writing.then(fn, fn);
  writing = next.catch(() => undefined);
  return next;
}

const strip = (pages: FolderPage[]): FolderPage[] => pages.map(({ id, width, height, thumb }) => ({ id, width, height, thumb }));
const pageIds = (folder: Folder) => new Set(folder.papers.flatMap((p) => p.pages.map((pg) => pg.id)));

/** 存一个文件夹：带原图的照片写进照片表（已存过的 id 跳过），文件夹记录只留尺寸和小图；dropped 里不再被引用的照片删掉 */
function putFolder(folder: Folder, opts: { stored?: Set<string>; dropped?: Iterable<string> } = {}): Promise<undefined> {
  const keep = pageIds(folder);
  return run([STORE, PHOTOS], "readwrite", (t) => {
    const photos = t.objectStore(PHOTOS);
    for (const paper of folder.papers)
      for (const pg of paper.pages) if (pg.src && !opts.stored?.has(pg.id)) photos.put({ id: pg.id, src: pg.src });
    for (const id of opts.dropped ?? []) if (!keep.has(id)) photos.delete(id);
    t.objectStore(STORE).put({ ...folder, papers: folder.papers.map((p) => ({ ...p, pages: strip(p.pages) })) });
  });
}

let migration: Promise<void> | null = null;

/** 第一次用到存储时：把旧版本存在文件夹记录里的原图拆进照片表并补小图，一个文件夹一个文件夹地做，免得一次读进所有照片 */
function ready(): Promise<void> {
  migration ??= (async () => {
    const keys = await run<IDBValidKey[]>(STORE, "readonly", (t) => t.objectStore(STORE).getAllKeys());
    for (const key of keys) {
      try {
        const raw = await run<Folder | LegacyFolder | undefined>(STORE, "readonly", (t) => t.objectStore(STORE).get(key));
        if (!raw) continue;
        const { folder, migrated } = normalize(raw);
        if (!migrated && !folder.papers.some((p) => p.pages.some((pg) => pg.src))) continue;
        for (const p of folder.papers)
          for (const pg of p.pages) if (pg.src && !pg.thumb) pg.thumb = await makeThumb(pg.src).catch(() => undefined);
        await putFolder(folder);
      } catch {
        /* 这个文件夹拆不动就先留着内嵌的原图，照样能读 */
      }
    }
  })().catch(() => undefined);
  return migration;
}

/** 列表缩略图的最长边 */
export const THUMB_SIDE = 360;

function thumbFrom(img: HTMLImageElement): string {
  const scale = Math.min(1, THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.72);
  canvas.width = canvas.height = 0; // 马上还掉画布内存（iOS 对画布总内存有上限）
  return out;
}

function makeThumb(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(thumbFrom(img));
    img.onerror = reject;
    img.src = src;
  });
}

/** 一张照片的原图；旧数据没拆出来的直接用记录里的 */
export async function loadPhoto(page: Pick<FolderPage, "id" | "src">): Promise<string | null> {
  if (page.src) return page.src;
  await ready();
  const row = await run<{ id: string; src: string } | undefined>(PHOTOS, "readonly", (t) => t.objectStore(PHOTOS).get(page.id));
  return row?.src ?? null;
}

/** 一张试卷带原图的全部照片（找不到原图的跳过） */
export async function loadPages(paper: Pick<Paper, "pages">): Promise<FullPage[]> {
  const out: FullPage[] = [];
  for (const pg of paper.pages) {
    const src = await loadPhoto(pg);
    if (src) out.push({ ...pg, src });
  }
  return out;
}

/** 本机照片一共占多少字节（逐条数，不一次读进内存） */
export async function photoBytes(): Promise<number> {
  await ready();
  let bytes = 0;
  await run(PHOTOS, "readonly", (t) => {
    const req = t.objectStore(PHOTOS).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      bytes += String((cur.value as { src: string }).src).length * 0.75;
      cur.continue();
    };
  });
  return bytes;
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function defaultFolderName(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 试卷`;
}

export function defaultPaperName(folder: Folder | null | undefined): string {
  return `第 ${(folder?.papers.length ?? 0) + 1} 张`;
}

const DEFAULT_FOLDER_RE = /^\d{1,2}月\d{1,2}日 试卷$/;
const DEFAULT_PAPER_RE = /^第 \d+ (张|份)$/;

/** 还是自动起的名字（没被用户改过），扫描后可以换成识别出的名字 */
export const isDefaultFolderName = (name: string) => DEFAULT_FOLDER_RE.test(name);
export const isDefaultPaperName = (name: string) => DEFAULT_PAPER_RE.test(name);

/** 不用先选文件夹：今天建的、最近更新的那个文件夹；今天还没有就返回 null（加卷时自动新建） */
export async function autoTargetFolder(): Promise<Folder | null> {
  const today = new Date().toDateString();
  const folders = await listFolders();
  return [...folders].filter((f) => new Date(f.createdAt).toDateString() === today).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** 识别完的卷头标题，作为试卷名；太长截断，没有就返回空 */
export function recognizedTitle(d: DigitizedResult | null | undefined): string {
  const t = (d?.pages.find((s) => s.title?.trim())?.title ?? "").replace(/\s+/g, " ").trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
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

/** 读出来的文件夹里只有照片的尺寸和小图，原图用 loadPhoto / loadPages 按需读 */
export async function listFolders(): Promise<Folder[]> {
  await ready();
  const all = await run<(Folder | LegacyFolder)[]>(STORE, "readonly", (t) => t.objectStore(STORE).getAll());
  return all.map((raw) => normalize(raw).folder).sort(compareFolders);
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
export function reorderFolders(ids: string[]): Promise<void> {
  return locked(async () => {
    const all = await listFolders();
    const byId = new Map(all.map((f) => [f.id, f]));
    const ordered = [...ids.filter((id) => byId.has(id)), ...all.filter((f) => !ids.includes(f.id)).map((f) => f.id)];
    for (let i = 0; i < ordered.length; i++) {
      const f = byId.get(ordered[i])!;
      if (f.order !== i) await putFolder({ ...f, order: i });
    }
  });
}

export async function getFolder(id: string): Promise<Folder | undefined> {
  await ready();
  const raw = await run<Folder | LegacyFolder | undefined>(STORE, "readonly", (t) => t.objectStore(STORE).get(id));
  return raw ? normalize(raw).folder : undefined;
}

async function saveFolder(folder: Folder, opts?: Parameters<typeof putFolder>[1]): Promise<Folder> {
  const next = { ...folder, updatedAt: new Date().toISOString() };
  await putFolder(next, opts);
  return next;
}

/** 改文件夹的名字 / 学科（在写入队列里重新读最新的记录再改，不会盖掉同时进来的扫描结果） */
export function updateFolder(id: string, patch: Partial<Pick<Folder, "name" | "subject">>): Promise<Folder | undefined> {
  return locked(async () => {
    const folder = await getFolder(id);
    return folder ? saveFolder({ ...folder, ...patch }) : undefined;
  });
}

const newFolder = (name: string, subject?: Subject): Promise<Folder> => {
  const now = new Date().toISOString();
  return saveFolder({ id: newId(), name: name.trim() || defaultFolderName(), subject, createdAt: now, updatedAt: now, papers: [] });
};

export function createFolder(name: string, subject?: Subject): Promise<Folder> {
  return locked(() => newFolder(name, subject));
}

/** 清空本机全部文件夹、试卷照片和电子版（账号不受影响） */
export function clearAllFolders(): Promise<void> {
  return locked(async () => {
    await ready();
    await run([STORE, PHOTOS], "readwrite", (t) => {
      t.objectStore(STORE).clear();
      t.objectStore(PHOTOS).clear();
    });
  });
}

export function deleteFolder(id: string): Promise<void> {
  return locked(async () => {
    const folder = await getFolder(id);
    await run([STORE, PHOTOS], "readwrite", (t) => {
      t.objectStore(STORE).delete(id);
      for (const pid of folder ? pageIds(folder) : []) t.objectStore(PHOTOS).delete(pid);
    });
  });
}

/** 用户拖动调整文件夹里试卷的先后；不改 updatedAt */
export function reorderPapers(folderId: string, ids: string[]): Promise<Folder | undefined> {
  return locked(async () => {
    const folder = await getFolder(folderId);
    if (!folder) return undefined;
    const byId = new Map(folder.papers.map((p) => [p.id, p]));
    const papers = [...ids.map((id) => byId.get(id)).filter((p): p is Paper => Boolean(p)), ...folder.papers.filter((p) => !ids.includes(p.id))];
    const next = { ...folder, papers };
    await putFolder(next);
    return next;
  });
}

/** 往文件夹里加一张试卷（没有文件夹就先建一个）。pages 要带原图，原图写进照片表 */
export function addPaper(folderId: string | null, pages: FolderPage[], name?: string): Promise<{ folder: Folder; paper: Paper }> {
  return locked(async () => {
    const folder = (folderId && (await getFolder(folderId))) || (await newFolder(defaultFolderName()));
    const now = new Date().toISOString();
    const paper: Paper = { id: newId(), name: name?.trim() || defaultPaperName(folder), createdAt: now, updatedAt: now, pages: strip(pages), corrected: {} };
    const saved = await saveFolder({ ...folder, papers: [...folder.papers, { ...paper, pages }] }, { stored: pageIds(folder) });
    return { folder: saved, paper };
  });
}

/** 改一张试卷。patch.pages 里新加的照片要带原图；去掉的照片连原图一起删 */
export function updatePaper(folderId: string, paperId: string, patch: Partial<Paper>): Promise<Folder | undefined> {
  return locked(async () => {
    const folder = await getFolder(folderId);
    if (!folder) return undefined;
    const now = new Date().toISOString();
    const before = folder.papers.find((p) => p.id === paperId);
    const next = { ...folder, papers: folder.papers.map((p) => (p.id === paperId ? { ...p, ...patch, updatedAt: now } : p)) };
    return saveFolder(next, { stored: pageIds(folder), dropped: patch.pages ? before?.pages.map((pg) => pg.id) : undefined });
  });
}

export function deletePaper(folderId: string, paperId: string): Promise<Folder | undefined> {
  return locked(async () => {
    const folder = await getFolder(folderId);
    if (!folder) return undefined;
    const gone = folder.papers.find((p) => p.id === paperId)?.pages.map((pg) => pg.id);
    return saveFolder({ ...folder, papers: folder.papers.filter((p) => p.id !== paperId) }, { stored: pageIds(folder), dropped: gone });
  });
}

/** 把 dataURL 变成照片记录（读出尺寸、做好小图）。 */
export function toPage(src: string): Promise<FullPage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ id: newId(), src, width: img.naturalWidth, height: img.naturalHeight, thumb: thumbFrom(img) });
    img.onerror = reject;
    img.src = src;
  });
}

/** 列表里显示的小图：没有小图（极少数做小图失败的旧数据）时才用原图 */
export const thumbOf = (page: FolderPage | undefined) => page?.thumb ?? page?.src ?? "";

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
