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
  return saveFolder({ ...folder, papers: folder.papers.filter((p) => p.id !== paperId) });
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
  return { id, src: dest, width: info.width, height: info.height };
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
