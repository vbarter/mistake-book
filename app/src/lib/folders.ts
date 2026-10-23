/** 试卷夹：本地 IndexedDB 存储，一夹多页（整页图片）。不上传服务器，只在本机保存。 */
import type { DigitizedResult } from "../api/types";
import type { Box } from "./boxes";

export interface FolderPage {
  id: string;
  src: string; // dataURL
  width: number;
  height: number;
  boxes?: Box[]; // 手动框选时缓存
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: FolderPage[];
  scannedAt?: string;
  digitized?: DigitizedResult; // AI 还原的电子版（与 pages 一一对应）
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

export async function listFolders(): Promise<Folder[]> {
  const all = await tx<Folder[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getFolder(id: string): Promise<Folder | undefined> {
  return tx<Folder | undefined>("readonly", (s) => s.get(id));
}

export async function saveFolder(folder: Folder): Promise<Folder> {
  const next = { ...folder, updatedAt: new Date().toISOString() };
  await tx("readwrite", (s) => s.put(next));
  return next;
}

export async function createFolder(name: string, pages: FolderPage[] = []): Promise<Folder> {
  const now = new Date().toISOString();
  return saveFolder({ id: newId(), name: name.trim() || defaultFolderName(), createdAt: now, updatedAt: now, pages });
}

export async function deleteFolder(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** 把 dataURL 变成页面记录（读出尺寸）。 */
export function toPage(src: string): Promise<FolderPage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ id: newId(), src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

/** 旧版本存的电子版没有版面块（blocks）或空 id（blankIds），当作未扫描，打开后重新扫描即可 */
export function validDigitized(d: DigitizedResult | undefined | null): DigitizedResult | null {
  if (!d || !Array.isArray(d.pages) || !Array.isArray(d.questions)) return null;
  if (!d.pages.every((p) => Array.isArray(p.blocks)) || !d.questions.every((q) => Array.isArray(q.blankIds))) return null;
  return d;
}
