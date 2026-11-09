/**
 * 云同步：同一账号在不同手机、电脑上看到同样的文件夹、试卷和错题（服务端 routes/sync.py，小程序 lib/sync.ts 同一套规则）。
 *
 * 本机优先：页面照旧读写 IndexedDB（lib/folders.ts），离线也能用；登录后在后台「先推后拉」：
 * 1. 推：和上次同步时的「指纹」比，变了的文件夹 / 试卷 / 照片记录推给服务器（带上次拿到的版本号 baseRev），本机删掉的推删除标记。
 * 2. 拉：从游标之后拉别的设备改过的记录，写回本机（不触发再推）。
 * 3. 照片：原图、缩略图、擦除版传到对象存储（服务器签的临时链接直传）；别的设备上传的下载回来。
 * 冲突由服务器裁决（新的赢），输了就用服务器给的版本覆盖本机。错题不单独同步：错题榜、汇总都由试卷电子版现算。
 *
 * 换账号：这台设备上次同步的是另一个账号时，本机数据属于那个账号（已在云端），先清掉本机再拉当前账号的；
 * 从没同步过（升级前的数据、没登录时拍的）就并进当前账号。
 */
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { create } from "zustand";
import { ApiError, api, getApiBase } from "../api/client";
import { useAuth } from "../store/auth";
import {
  FOLDERS_CHANGED_EVENT,
  clearAllFolders,
  erasedKey,
  getFolder,
  hasPhoto,
  listFolders,
  loadErased,
  loadPhoto,
  putSyncedFolder,
  removeSyncedFolder,
  type Folder,
  type FolderPage,
  type Paper,
} from "./folders";
import { useJobs } from "./jobs";

const STATE_KEY = "zcb.sync";
const PAPER_META = ["scannedAt", "gradedAt", "taggedAt", "printedAt", "duplicateOf", "notDuplicateOf", "keepDuplicate"] as const;
const PUSH_ITEMS = 150;
const PUSH_BYTES = 2 * 1024 * 1024;
const FILE_BATCH = 10;

interface State {
  owner: string;
  cursor: number;
  f: Record<string, [string, number]>;
  p: Record<string, [string, number, string]>;
  g: Record<string, [string, number]>;
  /** 照片文件：o 原图在服务器上、t 缩略图在、e 服务器和本机都有的擦除版时间 */
  up: Record<string, { o?: 1; t?: 1; e?: string }>;
  /** 服务器上有、本机还没有的：o 原图、t 缩略图、e 擦除版时间 */
  down: Record<string, { o?: 1; t?: 1; e?: string }>;
  orphans: Record<string, RemotePage>;
}

export interface SyncStatus {
  state: "off" | "idle" | "running" | "error";
  lastAt?: string;
  error?: string;
  pendingUploads: number;
  pendingDownloads: number;
}

/** 同步状态（账号页显示） */
export const useSync = create<SyncStatus>(() => ({ state: "off", pendingUploads: 0, pendingDownloads: 0 }));
const setStatus = (patch: Partial<SyncStatus>) => useSync.setState(patch);

const fresh = (owner: string): State => ({ owner, cursor: 0, f: {}, p: {}, g: {}, up: {}, down: {}, orphans: {} });

async function readState(): Promise<State | null> {
  try {
    const { value } = await Preferences.get({ key: STATE_KEY });
    return value ? (JSON.parse(value) as State) : null;
  } catch {
    return null;
  }
}

async function saveState(s: State) {
  await Preferences.set({ key: STATE_KEY, value: JSON.stringify(s) });
}

/** 53 位字符串摘要（cyrb53），只用来判断变没变 */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------------------------------------------------------------- 记录 ↔ 服务器格式

const folderBody = (f: Folder) => ({ id: f.id, name: f.name, subject: f.subject ?? null, order: f.order ?? null, createdAt: f.createdAt, updatedAt: f.updatedAt });
const paperMeta = (p: Paper) => Object.fromEntries(PAPER_META.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
const paperBody = (p: Paper, folderId: string, position: number) => ({
  id: p.id,
  folderId,
  name: p.name,
  subject: p.subject ?? null,
  subjectManual: Boolean(p.subjectManual),
  position,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  ...paperMeta(p),
});
const pageBody = (pg: FolderPage, paper: Paper, position: number) => ({
  id: pg.id,
  paperId: paper.id,
  position,
  width: pg.width,
  height: pg.height,
  sha: pg.sha ?? null,
  dhash: pg.dhash ?? null,
  erased: pg.erased ?? null,
  createdAt: paper.createdAt,
  updatedAt: pg.erased && pg.erased > paper.updatedAt ? pg.erased : paper.updatedAt,
});
const fpOf = (body: object) => hash(JSON.stringify(body));
/** 照片的更新时间跟着试卷走，不算进指纹：改试卷名不用把每张照片都再推一遍 */
const pageFp = (body: Record<string, unknown>) => {
  const { updatedAt: _u, ...rest } = body;
  return fpOf(rest);
};
const digHash = (p: Paper) => (p.digitized ? hash(JSON.stringify(p.digitized)) : "");

interface RemoteFolder { id: string; rev: number; deleted?: boolean; name?: string; subject?: Folder["subject"]; order?: number; createdAt?: string; updatedAt: string }
interface RemotePaper { id: string; folderId: string; rev: number; deleted?: boolean; name?: string; subject?: Paper["subject"]; subjectManual?: boolean; position?: number; createdAt?: string; updatedAt: string; digitized?: Paper["digitized"] | null; [k: string]: unknown }
interface RemotePage { id: string; paperId: string; rev: number; deleted?: boolean; position?: number; width?: number; height?: number; sha?: string; dhash?: string; erased?: string; updatedAt: string; files?: { original: boolean; erased: boolean; thumb: boolean } }
interface Changes { folders: RemoteFolder[]; papers: RemotePaper[]; pages: RemotePage[]; rev: number; more: boolean }
interface Rejected<T> { id: string; reason: "conflict" | "invalid" | "missing_parent" | "parent_deleted"; current: T | null }
interface PushResult {
  applied: { folders: { id: string; rev: number | null }[]; papers: { id: string; rev: number | null }[]; pages: { id: string; rev: number | null }[] };
  rejected: { folders: Rejected<RemoteFolder>[]; papers: Rejected<RemotePaper>[]; pages: Rejected<RemotePage>[] };
  rev: number;
}

// ---------------------------------------------------------------- 写回本机

async function findPaper(id: string): Promise<{ folder: Folder; paper: Paper } | undefined> {
  for (const folder of await listFolders()) {
    const paper = folder.papers.find((p) => p.id === id);
    if (paper) return { folder, paper };
  }
  return undefined;
}

async function findPage(id: string): Promise<{ folder: Folder; paper: Paper; page: FolderPage } | undefined> {
  for (const folder of await listFolders())
    for (const paper of folder.papers) {
      const page = paper.pages.find((pg) => pg.id === id);
      if (page) return { folder, paper, page };
    }
  return undefined;
}

const withoutPaper = (folder: Folder, id: string): Folder => ({ ...folder, papers: folder.papers.filter((p) => p.id !== id) });
const withoutPage = (folder: Folder, paperId: string, id: string): Folder => ({ ...folder, papers: folder.papers.map((p) => (p.id === paperId ? { ...p, pages: p.pages.filter((pg) => pg.id !== id) } : p)) });

async function applyFolder(s: State, r: RemoteFolder) {
  const local = await getFolder(r.id);
  if (r.deleted) {
    if (local) await removeSyncedFolder(r.id);
    delete s.f[r.id];
    return;
  }
  const next: Folder = { ...(local ?? { papers: [] }), id: r.id, name: r.name ?? "", subject: r.subject ?? undefined, order: r.order ?? undefined, createdAt: r.createdAt ?? r.updatedAt, updatedAt: r.updatedAt };
  await putSyncedFolder(next);
  s.f[r.id] = [fpOf(folderBody(next)), r.rev];
}

async function applyPaper(s: State, r: RemotePaper) {
  const at = await findPaper(r.id);
  if (r.deleted) {
    if (at) await putSyncedFolder(withoutPaper(at.folder, r.id));
    delete s.p[r.id];
    return;
  }
  const base: Paper = at?.paper ?? { id: r.id, name: "", createdAt: r.createdAt ?? r.updatedAt, updatedAt: r.updatedAt, pages: [], corrected: {} };
  const next: Paper = { ...base, name: r.name ?? base.name, subject: r.subject ?? undefined, subjectManual: r.subjectManual || undefined, createdAt: r.createdAt ?? base.createdAt, updatedAt: r.updatedAt };
  for (const k of PAPER_META) (next as unknown as Record<string, unknown>)[k] = r[k] ?? undefined;
  if ("digitized" in r) next.digitized = r.digitized ?? undefined;
  if (at && at.folder.id !== r.folderId) await putSyncedFolder(withoutPaper(at.folder, r.id)); // 换了文件夹
  const target = (await getFolder(r.folderId)) ?? { id: r.folderId, name: "", createdAt: next.createdAt, updatedAt: next.createdAt, papers: [] };
  const others = target.papers.filter((p) => p.id !== r.id);
  const pos = Math.max(0, Math.min(others.length, r.position ?? others.length));
  await putSyncedFolder({ ...target, papers: [...others.slice(0, pos), next, ...others.slice(pos)] });
  // 指纹按读回来的样子算：本机读的时候会整理电子版（validDigitized），按原样算会以为本机改了、又推回去
  const saved = (await findPaper(r.id))?.paper ?? next;
  s.p[r.id] = [fpOf(paperBody(saved, r.folderId, pos)), r.rev, digHash(saved)];
}

async function applyPage(s: State, r: RemotePage) {
  const at = await findPage(r.id);
  if (r.deleted) {
    if (at) await putSyncedFolder(withoutPage(at.folder, at.paper.id, r.id));
    delete s.g[r.id];
    delete s.up[r.id];
    delete s.down[r.id];
    delete s.orphans[r.id];
    return;
  }
  if (!(await findPaper(r.paperId))) {
    s.orphans[r.id] = r; // 试卷记录还在后面几页：等它到了再放
    return;
  }
  delete s.orphans[r.id];
  const old = at?.page;
  const page: FolderPage = { ...(old ?? {}), id: r.id, width: r.width ?? 0, height: r.height ?? 0, sha: r.sha ?? old?.sha, dhash: r.dhash ?? old?.dhash, erased: r.erased ?? undefined };
  delete page.src;
  if (at && at.paper.id !== r.paperId) await putSyncedFolder(withoutPage(at.folder, at.paper.id, r.id)); // 移到了别的试卷
  const cur = (await findPaper(r.paperId))!;
  const others = cur.paper.pages.filter((pg) => pg.id !== r.id);
  const pos = Math.max(0, Math.min(others.length, r.position ?? others.length));
  const pages = [...others.slice(0, pos), page, ...others.slice(pos)];
  await putSyncedFolder({ ...cur.folder, papers: cur.folder.papers.map((p) => (p.id === r.paperId ? { ...p, pages } : p)) });
  s.g[r.id] = [pageFp(pageBody(page, cur.paper, pos)), r.rev];
  const up = (s.up[r.id] ??= {});
  if (r.files?.original) up.o = 1;
  if (r.files?.thumb) up.t = 1;
  const need: State["down"][string] = {};
  if (r.files?.original && !(await hasPhoto(r.id))) need.o = 1;
  if (r.files?.thumb && !page.thumb) need.t = 1;
  if (r.files?.erased && r.erased && (up.e !== r.erased || !(await hasPhoto(erasedKey(r.id))))) need.e = r.erased;
  if (need.o || need.t || need.e) s.down[r.id] = need;
  else delete s.down[r.id];
}

// ---------------------------------------------------------------- 推

interface Outgoing { folders: Record<string, unknown>[]; papers: Record<string, unknown>[]; pages: Record<string, unknown>[] }

async function collect(s: State): Promise<Outgoing> {
  const out: Outgoing = { folders: [], papers: [], pages: [] };
  const now = new Date().toISOString();
  const seen = { f: new Set<string>(), p: new Set<string>(), g: new Set<string>() };
  for (const folder of await listFolders()) {
    seen.f.add(folder.id);
    const fb = folderBody(folder);
    if (s.f[folder.id]?.[0] !== fpOf(fb)) out.folders.push({ ...fb, baseRev: s.f[folder.id]?.[1] ?? null });
    folder.papers.forEach((paper, i) => {
      seen.p.add(paper.id);
      const pb = paperBody(paper, folder.id, i);
      const prev = s.p[paper.id];
      const dig = digHash(paper);
      if (prev?.[0] !== fpOf(pb) || prev?.[2] !== dig) out.papers.push({ ...pb, baseRev: prev?.[1] ?? null, ...(prev?.[2] !== dig ? { digitized: paper.digitized ?? null } : {}) });
      paper.pages.forEach((page, j) => {
        seen.g.add(page.id);
        const gb = pageBody(page, paper, j);
        if (s.g[page.id]?.[0] !== pageFp(gb)) out.pages.push({ ...gb, baseRev: s.g[page.id]?.[1] ?? null });
      });
    });
  }
  for (const id of Object.keys(s.f)) if (!seen.f.has(id)) out.folders.push({ id, deleted: true, updatedAt: now, baseRev: s.f[id][1] });
  for (const id of Object.keys(s.p)) if (!seen.p.has(id)) out.papers.push({ id, deleted: true, updatedAt: now, baseRev: s.p[id][1] });
  for (const id of Object.keys(s.g)) if (!seen.g.has(id)) out.pages.push({ id, deleted: true, updatedAt: now, baseRev: s.g[id][1] });
  return out;
}

function chunks(out: Outgoing): Outgoing[] {
  const list: Outgoing[] = [];
  let cur: Outgoing = { folders: [], papers: [], pages: [] };
  let n = 0;
  let bytes = 0;
  for (const key of ["folders", "papers", "pages"] as const)
    for (const item of out[key]) {
      const size = "digitized" in item ? JSON.stringify(item.digitized ?? "").length : 0;
      if (n && (n >= PUSH_ITEMS || bytes + size > PUSH_BYTES)) {
        list.push(cur);
        cur = { folders: [], papers: [], pages: [] };
        n = bytes = 0;
      }
      cur[key].push(item);
      n++;
      bytes += size;
    }
  if (n) list.push(cur);
  return list;
}

function record(s: State, kind: "f" | "p" | "g", id: string, rev: number | null, sent?: Record<string, unknown>) {
  if (!sent || sent.deleted || rev === null) {
    delete s[kind][id];
    if (kind === "g") delete s.up[id];
    return;
  }
  const { baseRev: _b, digitized, ...body } = sent;
  if (kind === "p") s.p[id] = [fpOf(body), rev, "digitized" in sent ? (digitized ? hash(JSON.stringify(digitized)) : "") : s.p[id]?.[2] ?? ""];
  else s[kind][id] = [kind === "g" ? pageFp(body) : fpOf(body), rev];
}

async function push(s: State) {
  for (const batch of chunks(await collect(s))) {
    const res = await api<PushResult>("/api/sync/push", { method: "POST", body: batch, timeoutMs: 120000 });
    const sent = (items: Record<string, unknown>[]) => new Map(items.map((x) => [String(x.id), x]));
    const sf = sent(batch.folders), sp = sent(batch.papers), sg = sent(batch.pages);
    for (const a of res.applied.folders) record(s, "f", a.id, a.rev, sf.get(a.id));
    for (const a of res.applied.papers) record(s, "p", a.id, a.rev, sp.get(a.id));
    for (const a of res.applied.pages) record(s, "g", a.id, a.rev, sg.get(a.id));
    for (const r of res.rejected.folders) if (r.current) await applyFolder(s, r.current);
    for (const r of res.rejected.papers) {
      if (r.current) await applyPaper(s, r.current);
      else if (r.reason === "parent_deleted") await applyPaper(s, { id: r.id, folderId: "", rev: 0, deleted: true, updatedAt: "" });
    }
    for (const r of res.rejected.pages) {
      if (r.current) await applyPage(s, r.current);
      else if (r.reason === "parent_deleted") await applyPage(s, { id: r.id, paperId: "", rev: 0, deleted: true, updatedAt: "" });
    }
    await saveState(s);
  }
}

// ---------------------------------------------------------------- 拉

async function pull(s: State): Promise<boolean> {
  let touched = false;
  for (let guard = 0; guard < 200; guard++) {
    const ch = await api<Changes>(`/api/sync/changes?since=${s.cursor}&limit=100`, { timeoutMs: 120000 });
    for (const r of ch.folders) await applyFolder(s, r);
    for (const r of ch.papers) await applyPaper(s, r);
    for (const r of ch.pages) await applyPage(s, r);
    for (const r of Object.values(s.orphans)) await applyPage(s, r);
    touched ||= Boolean(ch.folders.length || ch.papers.length || ch.pages.length);
    s.cursor = ch.rev;
    await saveState(s);
    if (!ch.more) break;
  }
  return touched;
}

// ---------------------------------------------------------------- 照片文件

type Kind = "original" | "erased" | "thumb";
interface SignedUrl { pageId: string; kind: Kind; url: string; headers?: Record<string, string> }
const absolute = (url: string) => (url.startsWith("/") ? `${getApiBase()}${url}` : url);

async function dataUrlToBlob(src: string): Promise<Blob> {
  return (await fetch(src)).blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([blob], { type: "image/jpeg" }));
  });
}

async function uploadPhotos(s: State) {
  type Job = { page: FolderPage; kind: Kind };
  const jobs: Job[] = [];
  for (const folder of await listFolders())
    for (const paper of folder.papers)
      for (const page of paper.pages) {
        if (!s.g[page.id]) continue;
        const up = s.up[page.id] ?? {};
        if (!up.o && (await hasPhoto(page.id))) jobs.push({ page, kind: "original" });
        if (!up.t && page.thumb) jobs.push({ page, kind: "thumb" });
        if (page.erased && up.e !== page.erased && (await hasPhoto(erasedKey(page.id)))) jobs.push({ page, kind: "erased" });
      }
  setStatus({ pendingUploads: jobs.length });
  for (let i = 0; i < jobs.length; i += FILE_BATCH) {
    const batch = jobs.slice(i, i + FILE_BATCH);
    const { urls } = await api<{ urls: SignedUrl[] }>("/api/sync/upload-urls", { method: "POST", body: { files: batch.map((j) => ({ pageId: j.page.id, kind: j.kind })) } });
    const done: { pageId: string; kind: Kind; erased?: string }[] = [];
    for (const u of urls) {
      const job = batch.find((j) => j.page.id === u.pageId && j.kind === u.kind);
      if (!job) continue;
      const src = u.kind === "thumb" ? job.page.thumb ?? null : u.kind === "erased" ? await loadErased(job.page) : await loadPhoto(job.page);
      if (!src) continue;
      const res = await fetch(absolute(u.url), { method: "PUT", body: await dataUrlToBlob(src), headers: { "Content-Type": "image/jpeg", ...(u.headers ?? {}) } });
      if (!res.ok) throw new ApiError(res.status, "upload", "照片上传失败");
      done.push({ pageId: u.pageId, kind: u.kind, ...(u.kind === "erased" ? { erased: job.page.erased } : {}) });
    }
    if (done.length) {
      const r = await api<{ done: { pageId: string; kind: Kind; rev: number }[] }>("/api/sync/uploaded", { method: "POST", body: { files: done } });
      for (const d of r.done) {
        const up = (s.up[d.pageId] ??= {});
        if (d.kind === "original") up.o = 1;
        else if (d.kind === "thumb") up.t = 1;
        else up.e = done.find((x) => x.pageId === d.pageId && x.kind === "erased")?.erased;
        if (s.g[d.pageId]) s.g[d.pageId][1] = d.rev; // 确认上传会升这张照片的版本号
      }
      await saveState(s);
    }
    setStatus({ pendingUploads: Math.max(0, jobs.length - i - batch.length) });
  }
}

/** 别的设备上传的照片下载回来：缩略图写进文件夹记录，原图 / 擦除版存进照片表 */
async function downloadPhotos(s: State): Promise<boolean> {
  const ids = Object.keys(s.down);
  setStatus({ pendingDownloads: ids.length });
  let got = false;
  // 先把所有缩略图下完（列表马上能看），再下原图
  for (const kinds of [["thumb"], ["original", "erased"]] as Kind[][]) {
    for (let i = 0; i < ids.length; i += FILE_BATCH) {
      const batch = ids.slice(i, i + FILE_BATCH).filter((id) => s.down[id]);
      const files = batch.flatMap((id) => kinds.filter((k) => (k === "original" ? s.down[id].o : k === "thumb" ? s.down[id].t : s.down[id].e)).map((kind) => ({ pageId: id, kind })));
      if (!files.length) continue;
      const { urls } = await api<{ urls: SignedUrl[] }>("/api/sync/download-urls", { method: "POST", body: { files } });
      for (const u of urls) {
        const want = s.down[u.pageId];
        if (!want) continue;
        const res = await fetch(absolute(u.url));
        if (!res.ok) continue;
        const src = await blobToDataUrl(await res.blob());
        const at = await findPage(u.pageId);
        if (!at) continue;
        const pageWith = (patch: Partial<FolderPage>) => ({ ...at.folder, papers: at.folder.papers.map((p) => (p.id === at.paper.id ? { ...p, pages: p.pages.map((pg) => (pg.id === u.pageId ? { ...pg, ...patch } : pg)) } : p)) });
        if (u.kind === "thumb") {
          await putSyncedFolder(pageWith({ thumb: src }));
          delete want.t;
        } else if (u.kind === "original") {
          await putSyncedFolder(at.folder, [{ id: u.pageId, src }]);
          delete want.o;
        } else {
          await putSyncedFolder(pageWith({ erased: want.e }), [{ id: erasedKey(u.pageId), src }]);
          (s.up[u.pageId] ??= {}).e = want.e;
          delete want.e;
        }
        if (!want.o && !want.t && !want.e) delete s.down[u.pageId];
        got = true;
      }
      await saveState(s);
      setStatus({ pendingDownloads: Object.keys(s.down).length });
    }
    if (got) useJobs.getState().bump();
  }
  return got;
}

// ---------------------------------------------------------------- 调度

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** 立刻同步一次（正在同步就排在它后面再来一次） */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce() {
  const { token, user } = useAuth.getState();
  if (!token || !user) {
    setStatus({ state: "off" });
    return;
  }
  setStatus({ state: "running", error: undefined });
  let s = await readState();
  if (s && s.owner !== user.id) {
    // 这台设备上次同步的是另一个账号：本机数据属于它（已在云端），清掉再拉当前账号的
    await clearAllFolders();
    s = null;
  }
  s ??= fresh(user.id);
  try {
    await push(s);
    if (await pull(s)) useJobs.getState().bump();
    await uploadPhotos(s);
    await downloadPhotos(s);
    setStatus({ state: "idle", lastAt: new Date().toISOString() });
  } catch (e) {
    await saveState(s).catch(() => undefined);
    const code = e instanceof ApiError ? e.status : 0;
    setStatus({ state: code === 503 ? "off" : "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/** 本机改了之后几秒再同步，连续修改合成一次 */
export function scheduleSync(delayMs = 3000) {
  if (!useAuth.getState().token) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

/** App 启动后调一次：本机改动、登录、回到前台时自动同步。返回停止函数 */
export function startSync(): () => void {
  const onChange = () => scheduleSync();
  window.addEventListener(FOLDERS_CHANGED_EVENT, onChange);
  const onVisible = () => { if (document.visibilityState === "visible") scheduleSync(800); };
  document.addEventListener("visibilitychange", onVisible);
  let removeNative: (() => void) | null = null;
  if (Capacitor.isNativePlatform())
    import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) scheduleSync(800); })).then((h) => { removeNative = () => void h.remove(); });
  scheduleSync(800);
  return () => {
    window.removeEventListener(FOLDERS_CHANGED_EVENT, onChange);
    document.removeEventListener("visibilitychange", onVisible);
    removeNative?.();
    if (timer) clearTimeout(timer);
  };
}
