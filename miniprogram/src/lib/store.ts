/** 文件夹 → 试卷 → 照片：先存在本机，登录后由 lib/sync.ts 在后台和云端同步（同一账号多台设备看到一样的内容）。
 *
 * 小程序没有 IndexedDB：文件夹列表和试卷信息放本地缓存（单个 key 上限 1MB），
 * 每张试卷的电子版单独一个 key（可能有几百 KB），照片存成用户目录下的 jpg 文件。
 */
import Taro from "@tarojs/taro";
import type { DigitizedResult, Subject } from "./types";
import type { ScanJob } from "./jobs";
import { removeFigures } from "./figures";

export interface FolderPage {
  id: string;
  src: string; // 本机文件路径（wxfile://usr/…）
  sha?: string; // 照片文件的 SHA-1（前 16 位），同一张图再导入时认出来；旧照片没有
  width: number;
  height: number;
  erased?: string; // 擦过手写的时间：擦后的照片另存一份（erasedSrc），原图不动
  erasedSrc?: string;
}

export interface Paper {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: FolderPage[];
  scannedAt?: string;
  digitized?: DigitizedResult;
  subject?: Subject; // 扫描时从卷头判断；决定这张试卷归进文件夹里的哪个学科子目录
  subjectManual?: boolean; // 学科是用户手动选的：重新扫描不再用识别结果覆盖
  scanJob?: ScanJob;
  scanError?: string;
  gradedAt?: string;
  taggedAt?: string; // 补标过知识图谱知识点的时间
  printedAt?: string; // 补算过题目指纹的时间（升级前扫的试卷没有 qKey）
  duplicateOf?: PaperMatch; // 扫完发现和本机另一份试卷是同一份（lib/dedup.ts）；用户点「不是同一份」后清掉
  notDuplicateOf?: string[]; // 用户说过「不是同一份」的试卷 id，不再提示
  keepDuplicate?: boolean; // 用户看过提示、选了两份都留 / 知道了：不再提示
  eraseJob?: EraseJobRef; // 服务器后台在擦插图照片上的手写（lib/erase.ts）
}

/** 擦除任务（原题空白卷的插图用）：任务号记在试卷上，切走、杀掉小程序都不影响，回来接着问 */
export interface EraseJobRef {
  id: string;
  startedAt: string; // 提交时间：照片的 erased 晚于它就是这次擦好的
  pageIds: string[]; // 提交的照片，下标对应服务器上的序号
  done: number;
  total: number;
}

/** 这份试卷和本机哪份试卷是同一份：same 重复扫描（作答也一样）、retake 重做（作答不同）、partial 只拍了其中几页 */
export interface PaperMatch {
  folderId: string;
  paperId: string;
  paperName: string;
  folderName: string;
  kind: "same" | "retake" | "partial";
  overlap: number;
  shared: number;
}

export interface Folder {
  id: string;
  name: string;
  subject?: Subject;
  createdAt: string;
  updatedAt: string;
  papers: Paper[];
  order?: number;
}

const INDEX_KEY = "zcb.folders"; // 文件夹 id 列表
const folderKey = (id: string) => `zcb.folder.${id}`;
const digKey = (paperId: string) => `zcb.dig.${paperId}`;
const PHOTO_DIR = `${Taro.env.USER_DATA_PATH}/papers`;

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function defaultFolderName(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 试卷`;
}

/** 自动放进哪个文件夹：今天建的文件夹里最近更新的那个；今天还没有就返回 null（加卷时新建）。和 App 的 autoTargetFolder 一致 */
export function autoTargetFolderId(): string | null {
  const today = new Date().toDateString();
  return (
    listFolders()
      .filter((f) => new Date(f.createdAt).toDateString() === today)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null
  );
}

export function defaultPaperName(folder: Folder | null | undefined, offset = 0): string {
  return `第 ${(folder?.papers.length ?? 0) + 1 + offset} 张`;
}

function readIndex(): string[] {
  try {
    const v = Taro.getStorageSync(INDEX_KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  Taro.setStorageSync(INDEX_KEY, ids);
}

/** 读一个文件夹，并把每张试卷的电子版接回来 */
function readFolder(id: string): Folder | undefined {
  let raw: Folder | "" | undefined;
  try {
    raw = Taro.getStorageSync(folderKey(id));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  return {
    ...raw,
    papers: (raw.papers ?? []).map((p) => {
      let d: DigitizedResult | "" | undefined;
      try {
        d = Taro.getStorageSync(digKey(p.id));
      } catch {
        d = undefined;
      }
      return { ...p, digitized: d && typeof d === "object" ? d : undefined };
    }),
  };
}

/** 写一个文件夹：电子版拆出去各存一个 key，文件夹 key 只放轻量信息 */
function writeFolder(folder: Folder) {
  const light: Folder = { ...folder, papers: folder.papers.map(({ digitized: _d, ...rest }) => rest) };
  for (const p of folder.papers) {
    if (p.digitized) Taro.setStorageSync(digKey(p.id), p.digitized);
    else Taro.removeStorageSync(digKey(p.id));
  }
  Taro.setStorageSync(folderKey(folder.id), light);
  const ids = readIndex();
  if (!ids.includes(folder.id)) writeIndex([folder.id, ...ids]);
  changed();
}

/** 本机文件夹数据变了（云同步据此排一次上传）；同步自己写回来的时候不发 */
export const STORE_CHANGED_EVENT = "store:changed";
let quiet = 0;
function changed() {
  if (!quiet) Taro.eventCenter.trigger(STORE_CHANGED_EVENT);
}
/** 云同步把服务器上的修改写回本机时用：不触发「本机改了」 */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

function compareFolders(a: Folder, b: Folder): number {
  const ao = a.order ?? -1;
  const bo = b.order ?? -1;
  if (ao < 0 && bo < 0) return b.updatedAt.localeCompare(a.updatedAt);
  if (ao < 0 || bo < 0) return ao < 0 ? -1 : 1;
  return ao - bo;
}

export function listFolders(): Folder[] {
  return readIndex()
    .map(readFolder)
    .filter((f): f is Folder => Boolean(f))
    .sort(compareFolders);
}

export function getFolder(id: string): Folder | undefined {
  return readFolder(id);
}

export function saveFolder(folder: Folder): Folder {
  const next = { ...folder, updatedAt: new Date().toISOString() };
  writeFolder(next);
  return next;
}

export function createFolder(name: string, subject?: Subject): Folder {
  const now = new Date().toISOString();
  return saveFolder({ id: newId(), name: name.trim() || defaultFolderName(), subject, createdAt: now, updatedAt: now, papers: [] });
}

/** 把一张试卷的照片文件删掉 */
function removePhotos(paper: Paper) {
  const fs = Taro.getFileSystemManager();
  for (const pg of paper.pages) {
    for (const src of [pg.src, pg.erasedSrc]) {
      if (!src) continue;
      try {
        fs.unlinkSync(src);
      } catch {
        /* 已经不在了 */
      }
    }
  }
  Taro.removeStorageSync(digKey(paper.id));
  removeFigures(paper.id);
}

/** 清空本机全部文件夹、试卷照片、电子版和裁好的插图（账号和学习设置不受影响） */
export function clearAllFolders() {
  for (const id of readIndex()) deleteFolder(id);
  writeIndex([]);
  const fs = Taro.getFileSystemManager();
  for (const dir of [PHOTO_DIR, `${Taro.env.USER_DATA_PATH}/figs`]) {
    try {
      for (const name of fs.readdirSync(dir)) fs.unlinkSync(`${dir}/${name}`);
    } catch {
      /* 目录不存在 */
    }
  }
}

export function deleteFolder(id: string) {
  const f = readFolder(id);
  f?.papers.forEach(removePhotos);
  Taro.removeStorageSync(folderKey(id));
  writeIndex(readIndex().filter((x) => x !== id));
  unlinkDuplicates(new Set(f?.papers.map((p) => p.id) ?? []));
  changed();
}

/** 原样写回一个文件夹（不改更新时间）：云同步写服务器上的版本、补下载好的照片路径时用 */
export function putFolder(folder: Folder) {
  writeFolder(folder);
}

/** 照片在本机的存放路径（云同步下载的照片也放这里） */
export function photoPath(pageId: string, suffix = ""): string {
  ensurePhotoDir();
  return `${PHOTO_DIR}/${pageId}${suffix}.jpg`;
}

export function ensurePhotoDir() {
  const fs = Taro.getFileSystemManager();
  try {
    fs.accessSync(PHOTO_DIR);
  } catch {
    fs.mkdirSync(PHOTO_DIR, true);
  }
}

/** 本机文件在不在 */
export function fileExists(path?: string): boolean {
  if (!path) return false;
  try {
    Taro.getFileSystemManager().accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/** 删一张试卷的照片文件（云同步删除服务器上已删的试卷时用） */
export function removePaperFiles(paper: Paper) {
  removePhotos(paper);
}

/** 删掉的试卷如果是别的试卷标的「同一份」，把标记去掉：原来那份没了，这份的错题要重新计入 */
function unlinkDuplicates(gone: Set<string>) {
  if (!gone.size) return;
  for (const f of listFolders()) {
    if (!f.papers.some((p) => p.duplicateOf && gone.has(p.duplicateOf.paperId))) continue;
    writeFolder({ ...f, papers: f.papers.map((p) => (p.duplicateOf && gone.has(p.duplicateOf.paperId) ? { ...p, duplicateOf: undefined, keepDuplicate: undefined } : p)) });
  }
}

/** 文件夹换位置：dir = -1 上移，1 下移；排过序后按 order 排 */
export function moveFolder(id: string, dir: -1 | 1) {
  const all = listFolders();
  const i = all.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  all.forEach((f, k) => {
    if (f.order !== k) writeFolder({ ...f, order: k });
  });
}

/** 上移 / 下移一张试卷。within 是当前看到的那一组（某个学科子目录、或待归类）的试卷 id：只和组里相邻的那张换位置 */
export function movePaper(folderId: string, paperId: string, dir: -1 | 1, within?: string[]): Folder | undefined {
  const folder = readFolder(folderId);
  if (!folder) return undefined;
  const papers = [...folder.papers];
  const i = papers.findIndex((p) => p.id === paperId);
  const group = within ?? papers.map((p) => p.id);
  const k = group.indexOf(paperId) + dir;
  const j = k >= 0 && k < group.length ? papers.findIndex((p) => p.id === group[k]) : -1;
  if (i < 0 || j < 0) return folder;
  [papers[i], papers[j]] = [papers[j], papers[i]];
  const next = { ...folder, papers };
  writeFolder(next);
  return next;
}

export function addPaper(folderId: string | null, pages: FolderPage[], name?: string): { folder: Folder; paper: Paper } {
  const folder = (folderId && readFolder(folderId)) || createFolder(defaultFolderName());
  const now = new Date().toISOString();
  const paper: Paper = { id: newId(), name: name?.trim() || defaultPaperName(folder), createdAt: now, updatedAt: now, pages };
  const saved = saveFolder({ ...folder, papers: [...folder.papers, paper] });
  return { folder: saved, paper };
}

export function updatePaper(folderId: string, paperId: string, patch: Partial<Paper>): Folder | undefined {
  const folder = readFolder(folderId);
  if (!folder) return undefined;
  const now = new Date().toISOString();
  return saveFolder({ ...folder, papers: folder.papers.map((p) => (p.id === paperId ? { ...p, ...patch, updatedAt: now } : p)) });
}

export function deletePaper(folderId: string, paperId: string): Folder | undefined {
  const folder = readFolder(folderId);
  if (!folder) return undefined;
  const paper = folder.papers.find((p) => p.id === paperId);
  if (paper) removePhotos(paper);
  const saved = saveFolder({ ...folder, papers: folder.papers.filter((p) => p.id !== paperId) });
  unlinkDuplicates(new Set([paperId]));
  return readFolder(folderId) ?? saved;
}

/** 擦好手写的照片另存一份（原图不动），记下擦除时间；原题空白卷的插图从这份里裁 */
export function saveErased(folderId: string, paperId: string, pageId: string, jpeg: ArrayBuffer): Folder | undefined {
  const fs = Taro.getFileSystemManager();
  try {
    fs.accessSync(PHOTO_DIR);
  } catch {
    fs.mkdirSync(PHOTO_DIR, true);
  }
  // 文件名带时间：重擦后插图缓存按新文件重新裁
  const now = new Date().toISOString();
  const dest = `${PHOTO_DIR}/${pageId}~erased~${Date.now().toString(36)}.jpg`;
  fs.writeFileSync(dest, jpeg, "binary");
  const folder = readFolder(folderId);
  const paper = folder?.papers.find((p) => p.id === paperId);
  const old = paper?.pages.find((pg) => pg.id === pageId)?.erasedSrc;
  if (old) {
    try {
      fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  return updatePaper(folderId, paperId, { pages: (paper?.pages ?? []).map((pg) => (pg.id === pageId ? { ...pg, erased: now, erasedSrc: dest } : pg)) });
}

/** 把选好的临时图片存进用户目录（临时文件随时会被清掉），读出尺寸 */
export async function savePhoto(tempPath: string): Promise<FolderPage> {
  const fs = Taro.getFileSystemManager();
  try {
    fs.accessSync(PHOTO_DIR);
  } catch {
    fs.mkdirSync(PHOTO_DIR, true);
  }
  const id = newId();
  const dest = `${PHOTO_DIR}/${id}.jpg`;
  fs.copyFileSync(tempPath, dest);
  const info = await Taro.getImageInfo({ src: dest });
  const sha = await new Promise<string>((resolve) => {
    fs.getFileInfo({ filePath: dest, digestAlgorithm: "sha1", success: (r) => resolve(String((r as { digest?: string }).digest ?? "").slice(0, 16)), fail: () => resolve("") });
  });
  return { id, src: dest, width: info.width, height: info.height, ...(sha ? { sha } : {}) };
}

/** 本机照片占用的空间（MB） */
export function photosSizeMB(folders: Folder[]): number {
  const fs = Taro.getFileSystemManager();
  let bytes = 0;
  for (const f of folders)
    for (const p of f.papers)
      for (const pg of p.pages) {
        try {
          bytes += fs.statSync(pg.src).size;
        } catch {
          /* ignore */
        }
      }
  return Math.round((bytes / 1048576) * 10) / 10;
}
