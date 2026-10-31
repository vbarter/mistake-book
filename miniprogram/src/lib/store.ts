/** 文件夹 → 试卷 → 照片：只存在本机。
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
}

export interface Paper {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: FolderPage[];
  scannedAt?: string;
  digitized?: DigitizedResult;
  subject?: Subject;
  scanJob?: ScanJob;
  scanError?: string;
  gradedAt?: string;
  taggedAt?: string; // 补标过知识图谱知识点的时间
  printedAt?: string; // 补算过题目指纹的时间（升级前扫的试卷没有 qKey）
  duplicateOf?: PaperMatch; // 扫完发现和本机另一份试卷是同一份（lib/dedup.ts）；用户点「不是同一份」后清掉
  notDuplicateOf?: string[]; // 用户说过「不是同一份」的试卷 id，不再提示
  keepDuplicate?: boolean; // 用户看过提示、选了两份都留 / 知道了：不再提示
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
    try {
      fs.unlinkSync(pg.src);
    } catch {
      /* 已经不在了 */
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

export function movePaper(folderId: string, paperId: string, dir: -1 | 1): Folder | undefined {
  const folder = readFolder(folderId);
  if (!folder) return undefined;
  const papers = [...folder.papers];
  const i = papers.findIndex((p) => p.id === paperId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= papers.length) return folder;
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
