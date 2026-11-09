/**
 * 云同步：同一账号在不同手机、电脑上看到同样的文件夹、试卷和错题（服务端 routes/sync.py）。
 *
 * 本机优先：页面照旧读写本机（lib/store.ts），离线也能用；登录后在后台「先推后拉」：
 * 1. 推：和上次同步时的「指纹」比，变了的文件夹 / 试卷 / 照片记录推给服务器（带上次拿到的版本号 baseRev），本机删掉的推删除标记。
 * 2. 拉：从游标之后拉别的设备改过的记录，写回本机（不触发再推）。
 * 3. 照片：本机照片传到对象存储（服务器签的临时链接，PUT 直传）；别的设备上传的照片下载到本机。
 * 冲突由服务器裁决（新的赢），输了就用服务器给的版本覆盖本机。错题不单独同步：错题榜、汇总都由试卷电子版现算。
 *
 * 小程序的本地缓存按微信号隔离，所以本机的数据都是这个微信用户的；第一次登录（或换了账号）时把本机全部数据并进当前账号。
 */
import Taro from "@tarojs/taro";
import { ApiError, api } from "./api";
import { currentUser, isLoggedIn } from "./auth";
import { bump } from "./jobs";
import {
  STORE_CHANGED_EVENT,
  ensurePhotoDir,
  fileExists,
  getFolder,
  listFolders,
  photoPath,
  putFolder,
  quietly,
  removePaperFiles,
  type Folder,
  type FolderPage,
  type Paper,
} from "./store";

const STATE_KEY = "zcb.sync";
export const SYNC_EVENT = "sync";
const PAPER_META = ["scannedAt", "gradedAt", "taggedAt", "printedAt", "duplicateOf", "notDuplicateOf", "keepDuplicate"] as const;
const PUSH_ITEMS = 150;
const PUSH_BYTES = 2 * 1024 * 1024;
const FILE_BATCH = 10;
const THUMB_SIDE = 360;

/** 上次同步时每条记录的样子：[指纹, 服务器版本号]；试卷多一个电子版摘要 */
interface State {
  owner: string;
  cursor: number;
  f: Record<string, [string, number]>;
  p: Record<string, [string, number, string]>;
  g: Record<string, [string, number]>;
  /** 照片文件：o 原图在服务器上、t 缩略图在、e 服务器和本机都有的擦除版时间 */
  up: Record<string, { o?: 1; t?: 1; e?: string }>;
  /** 服务器上有、本机还没下载的：e 是要下载的擦除版时间 */
  down: Record<string, { o?: 1; e?: string }>;
  /** 先于所属试卷拉到的照片记录：试卷到了再放进去 */
  orphans: Record<string, RemotePage>;
}

export interface SyncStatus {
  state: "off" | "idle" | "running" | "error";
  lastAt?: string;
  error?: string;
  pendingUploads: number;
  pendingDownloads: number;
}

let status: SyncStatus = { state: "off", pendingUploads: 0, pendingDownloads: 0 };
export const syncStatus = () => status;
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  Taro.eventCenter.trigger(SYNC_EVENT);
}

function fresh(owner: string): State {
  return { owner, cursor: 0, f: {}, p: {}, g: {}, up: {}, down: {}, orphans: {} };
}

function loadState(owner: string): State {
  try {
    const s = Taro.getStorageSync(STATE_KEY) as State | "";
    if (s && typeof s === "object" && s.owner === owner) return { ...fresh(owner), ...s };
  } catch {
    /* 坏了就重来 */
  }
  return fresh(owner);
}

function saveState(s: State) {
  Taro.setStorageSync(STATE_KEY, s);
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
interface RemotePage { id: string; paperId: string; rev: number; deleted?: boolean; position?: number; width?: number; height?: number; sha?: string; erased?: string; updatedAt: string; files?: { original: boolean; erased: boolean; thumb: boolean } }
interface Changes { folders: RemoteFolder[]; papers: RemotePaper[]; pages: RemotePage[]; rev: number; more: boolean }
interface Rejected<T> { id: string; reason: "conflict" | "invalid" | "missing_parent" | "parent_deleted"; current: T | null }
interface PushResult {
  applied: { folders: { id: string; rev: number | null }[]; papers: { id: string; rev: number | null }[]; pages: { id: string; rev: number | null }[] };
  rejected: { folders: Rejected<RemoteFolder>[]; papers: Rejected<RemotePaper>[]; pages: Rejected<RemotePage>[] };
  rev: number;
}

// ---------------------------------------------------------------- 写回本机

/** 本机所有文件夹，按 id 找试卷 / 照片在哪 */
function index(folders: Folder[]) {
  const paperAt = new Map<string, { folder: Folder; paper: Paper; i: number }>();
  const pageAt = new Map<string, { folder: Folder; paper: Paper; page: FolderPage; i: number }>();
  for (const folder of folders)
    folder.papers.forEach((paper, i) => {
      paperAt.set(paper.id, { folder, paper, i });
      paper.pages.forEach((page, j) => pageAt.set(page.id, { folder, paper, page, i: j }));
    });
  return { paperAt, pageAt };
}

function applyFolder(s: State, r: RemoteFolder) {
  const local = getFolder(r.id);
  if (r.deleted) {
    if (local) quietly(() => deleteLocalFolder(local));
    delete s.f[r.id];
    return;
  }
  const next: Folder = { ...(local ?? { papers: [] }), id: r.id, name: r.name ?? "", subject: r.subject ?? undefined, order: r.order ?? undefined, createdAt: r.createdAt ?? r.updatedAt, updatedAt: r.updatedAt };
  quietly(() => putFolder(next));
  s.f[r.id] = [fpOf(folderBody(next)), r.rev];
}

function deleteLocalFolder(folder: Folder) {
  for (const p of folder.papers) removePaperFiles(p);
  // 直接删记录：deleteFolder 会顺带改别的试卷的重复标记，那些修改由对方设备同步过来
  Taro.removeStorageSync(`zcb.folder.${folder.id}`);
  const ids = (Taro.getStorageSync("zcb.folders") as string[]) || [];
  Taro.setStorageSync("zcb.folders", ids.filter((x) => x !== folder.id));
}

function applyPaper(s: State, r: RemotePaper) {
  const { paperAt } = index(listFolders());
  const at = paperAt.get(r.id);
  if (r.deleted) {
    if (at) {
      removePaperFiles(at.paper);
      quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.filter((p) => p.id !== r.id) }));
    }
    delete s.p[r.id];
    return;
  }
  const base: Paper = at?.paper ?? { id: r.id, name: "", createdAt: r.createdAt ?? r.updatedAt, updatedAt: r.updatedAt, pages: [] };
  const next: Paper = { ...base, name: r.name ?? base.name, subject: r.subject ?? undefined, subjectManual: r.subjectManual || undefined, createdAt: r.createdAt ?? base.createdAt, updatedAt: r.updatedAt };
  for (const k of PAPER_META) (next as unknown as Record<string, unknown>)[k] = r[k] ?? undefined;
  if ("digitized" in r) next.digitized = r.digitized ?? undefined;
  // 换了文件夹：先从原来的拿掉
  if (at && at.folder.id !== r.folderId) quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.filter((p) => p.id !== r.id) }));
  const target = getFolder(r.folderId) ?? { id: r.folderId, name: "", createdAt: next.createdAt, updatedAt: next.createdAt, papers: [] };
  const others = target.papers.filter((p) => p.id !== r.id);
  const pos = Math.max(0, Math.min(others.length, r.position ?? others.length));
  quietly(() => putFolder({ ...target, papers: [...others.slice(0, pos), next, ...others.slice(pos)] }));
  s.p[r.id] = [fpOf(paperBody(next, r.folderId, pos)), r.rev, digHash(next)];
}

function applyPage(s: State, r: RemotePage) {
  const { paperAt, pageAt } = index(listFolders());
  const at = pageAt.get(r.id);
  if (r.deleted) {
    if (at) {
      for (const src of [at.page.src, at.page.erasedSrc]) if (src) try { Taro.getFileSystemManager().unlinkSync(src); } catch { /* 已经不在了 */ }
      quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.map((p) => (p.id === at.paper.id ? { ...p, pages: p.pages.filter((pg) => pg.id !== r.id) } : p)) }));
    }
    delete s.g[r.id];
    delete s.up[r.id];
    delete s.down[r.id];
    return;
  }
  const owner = paperAt.get(r.paperId);
  if (!owner) {
    s.orphans[r.id] = r; // 试卷记录还在后面几页：等它到了再放
    return;
  }
  delete s.orphans[r.id];
  const old = at?.page;
  const page: FolderPage = { ...(old ?? { src: "" }), id: r.id, width: r.width ?? 0, height: r.height ?? 0, sha: r.sha ?? old?.sha, erased: r.erased ?? undefined };
  if (!r.erased) page.erasedSrc = undefined;
  // 照片移到了别的试卷：从原来的试卷拿掉
  let folders = listFolders();
  if (at && at.paper.id !== r.paperId) {
    quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.map((p) => (p.id === at.paper.id ? { ...p, pages: p.pages.filter((pg) => pg.id !== r.id) } : p)) }));
    folders = listFolders();
  }
  const cur = index(folders).paperAt.get(r.paperId)!;
  const others = cur.paper.pages.filter((pg) => pg.id !== r.id);
  const pos = Math.max(0, Math.min(others.length, r.position ?? others.length));
  const pages = [...others.slice(0, pos), page, ...others.slice(pos)];
  quietly(() => putFolder({ ...cur.folder, papers: cur.folder.papers.map((p) => (p.id === r.paperId ? { ...p, pages } : p)) }));
  s.g[r.id] = [pageFp(pageBody(page, cur.paper, pos)), r.rev];
  // 照片文件：服务器上有、本机没有的记下来待下载
  const up = (s.up[r.id] ??= {});
  if (r.files?.original) up.o = 1;
  if (r.files?.thumb) up.t = 1;
  const need: { o?: 1; e?: string } = {};
  if (r.files?.original && !fileExists(page.src)) need.o = 1;
  if (r.files?.erased && r.erased && (up.e !== r.erased || !fileExists(page.erasedSrc))) need.e = r.erased;
  if (need.o || need.e) s.down[r.id] = need;
  else delete s.down[r.id];
}

// ---------------------------------------------------------------- 推

interface Outgoing { folders: object[]; papers: object[]; pages: object[] }

function collect(s: State): Outgoing {
  const out: Outgoing = { folders: [], papers: [], pages: [] };
  const now = new Date().toISOString();
  const folders = listFolders();
  const seen = { f: new Set<string>(), p: new Set<string>(), g: new Set<string>() };
  for (const folder of folders) {
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
  // 本机已经没有、上次同步过的：推删除。文件夹删了服务器会连带删里面的，不用再逐条推
  for (const id of Object.keys(s.f)) if (!seen.f.has(id)) out.folders.push({ id, deleted: true, updatedAt: now, baseRev: s.f[id][1] });
  for (const id of Object.keys(s.p)) if (!seen.p.has(id)) out.papers.push({ id, deleted: true, updatedAt: now, baseRev: s.p[id][1] });
  for (const id of Object.keys(s.g)) if (!seen.g.has(id)) out.pages.push({ id, deleted: true, updatedAt: now, baseRev: s.g[id][1] });
  return out;
}

/** 按条数和电子版大小切成几次推：先文件夹、再试卷、再照片，父记录总在同一次或更早一次里 */
function chunks(out: Outgoing): Outgoing[] {
  const list: Outgoing[] = [];
  let cur: Outgoing = { folders: [], papers: [], pages: [] };
  let n = 0;
  let bytes = 0;
  for (const key of ["folders", "papers", "pages"] as const)
    for (const item of out[key]) {
      const size = key === "papers" && "digitized" in item ? JSON.stringify((item as { digitized: unknown }).digitized ?? "").length : 0;
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

async function push(s: State) {
  for (const batch of chunks(collect(s))) {
    const res = await api<PushResult>("/api/sync/push", { method: "POST", body: batch, timeoutMs: 120000 });
    const sent = { folders: byId(batch.folders), papers: byId(batch.papers), pages: byId(batch.pages) };
    for (const a of res.applied.folders) record(s, "f", a.id, a.rev, sent.folders.get(a.id));
    for (const a of res.applied.papers) record(s, "p", a.id, a.rev, sent.papers.get(a.id));
    for (const a of res.applied.pages) record(s, "g", a.id, a.rev, sent.pages.get(a.id));
    // 输了：用服务器上的版本覆盖本机
    for (const r of res.rejected.folders) if (r.current) applyFolder(s, r.current);
    for (const r of res.rejected.papers) {
      if (r.current) applyPaper(s, r.current);
      else if (r.reason === "parent_deleted") dropLocalPaper(r.id);
    }
    for (const r of res.rejected.pages) {
      if (r.current) applyPage(s, r.current);
      else if (r.reason === "parent_deleted") dropLocalPage(r.id);
    }
    saveState(s);
  }
}

const byId = (items: object[]) => new Map(items.map((x) => [(x as { id: string }).id, x as Record<string, unknown>]));

function record(s: State, kind: "f" | "p" | "g", id: string, rev: number | null, sent?: Record<string, unknown>) {
  if (!sent || sent.deleted || rev === null) {
    delete s[kind][id];
    if (kind === "g") delete s.up[id];
    return;
  }
  const { baseRev: _b, digitized, ...body } = sent;
  if (kind === "p") {
    const prev = s.p[id];
    s.p[id] = [fpOf(body), rev, "digitized" in sent ? (digitized ? hash(JSON.stringify(digitized)) : "") : prev?.[2] ?? ""];
  } else s[kind][id] = [kind === "g" ? pageFp(body) : fpOf(body), rev];
}

/** 服务器说这张试卷所在的文件夹早就删了：本机也删掉 */
function dropLocalPaper(id: string) {
  const at = index(listFolders()).paperAt.get(id);
  if (!at) return;
  removePaperFiles(at.paper);
  quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.filter((p) => p.id !== id) }));
}

function dropLocalPage(id: string) {
  const at = index(listFolders()).pageAt.get(id);
  if (!at) return;
  quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.map((p) => (p.id === at.paper.id ? { ...p, pages: p.pages.filter((pg) => pg.id !== id) } : p)) }));
}

// ---------------------------------------------------------------- 拉

async function pull(s: State): Promise<boolean> {
  let touched = false;
  for (let guard = 0; guard < 200; guard++) {
    const ch = await api<Changes>(`/api/sync/changes?since=${s.cursor}&limit=100`, { timeoutMs: 120000 });
    for (const r of ch.folders) applyFolder(s, r);
    for (const r of ch.papers) applyPaper(s, r);
    for (const r of ch.pages) applyPage(s, r);
    for (const r of Object.values(s.orphans)) applyPage(s, r);
    touched ||= Boolean(ch.folders.length || ch.papers.length || ch.pages.length);
    s.cursor = ch.rev;
    saveState(s);
    if (!ch.more) break;
  }
  return touched;
}

// ---------------------------------------------------------------- 照片文件

interface SignedUrl { pageId: string; kind: "original" | "erased" | "thumb"; url: string; headers?: Record<string, string> }
const absolute = (url: string) => (url.startsWith("/") ? `${API_BASE}${url}` : url);

function readFile(path: string): ArrayBuffer {
  return Taro.getFileSystemManager().readFileSync(path) as ArrayBuffer;
}

async function putFile(u: SignedUrl, data: ArrayBuffer) {
  const res = await Taro.request({ url: absolute(u.url), method: "PUT", data, header: { "Content-Type": "image/jpeg", ...(u.headers ?? {}) }, timeout: 120000 });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new ApiError(res.statusCode, "upload", "照片上传失败");
}

async function thumbOf(src: string, width: number): Promise<ArrayBuffer | null> {
  try {
    const r = await Taro.compressImage({ src, quality: 72, compressedWidth: Math.min(THUMB_SIDE, width || THUMB_SIDE) } as Taro.compressImage.Option);
    return readFile(r.tempFilePath);
  } catch {
    return null;
  }
}

/** 本机有、服务器还没有的照片传上去（照片记录要先推成功） */
async function uploadPhotos(s: State) {
  type Job = { page: FolderPage; kind: SignedUrl["kind"] };
  const jobs: Job[] = [];
  for (const folder of listFolders())
    for (const paper of folder.papers)
      for (const page of paper.pages) {
        if (!s.g[page.id] || !fileExists(page.src)) continue;
        const up = s.up[page.id] ?? {};
        if (!up.o) jobs.push({ page, kind: "original" });
        if (!up.t) jobs.push({ page, kind: "thumb" });
        if (page.erased && page.erasedSrc && up.e !== page.erased && fileExists(page.erasedSrc)) jobs.push({ page, kind: "erased" });
      }
  setStatus({ pendingUploads: jobs.length });
  for (let i = 0; i < jobs.length; i += FILE_BATCH) {
    const batch = jobs.slice(i, i + FILE_BATCH);
    const { urls } = await api<{ urls: SignedUrl[] }>("/api/sync/upload-urls", { method: "POST", body: { files: batch.map((j) => ({ pageId: j.page.id, kind: j.kind })) } });
    const done: { pageId: string; kind: string; erased?: string }[] = [];
    for (const u of urls) {
      const job = batch.find((j) => j.page.id === u.pageId && j.kind === u.kind);
      if (!job) continue;
      const data = u.kind === "thumb" ? await thumbOf(job.page.src, job.page.width) : readFile(u.kind === "erased" ? job.page.erasedSrc! : job.page.src);
      if (!data) continue;
      await putFile(u, data);
      done.push({ pageId: u.pageId, kind: u.kind, ...(u.kind === "erased" ? { erased: job.page.erased } : {}) });
    }
    if (done.length) {
      const r = await api<{ done: { pageId: string; kind: string; rev: number }[] }>("/api/sync/uploaded", { method: "POST", body: { files: done } });
      for (const d of r.done) {
        const up = (s.up[d.pageId] ??= {});
        if (d.kind === "original") up.o = 1;
        else if (d.kind === "thumb") up.t = 1;
        else up.e = done.find((x) => x.pageId === d.pageId && x.kind === "erased")?.erased;
        // 确认上传会让服务器升这张照片的版本号：记下来，免得下次当成别人改的
        if (s.g[d.pageId]) s.g[d.pageId][1] = d.rev;
      }
      saveState(s);
    }
    setStatus({ pendingUploads: Math.max(0, jobs.length - i - batch.length) });
  }
}

/** 别的设备上传的照片下载到本机 */
async function downloadPhotos(s: State): Promise<boolean> {
  const ids = Object.keys(s.down);
  setStatus({ pendingDownloads: ids.length });
  let got = false;
  for (let i = 0; i < ids.length; i += FILE_BATCH) {
    const batch = ids.slice(i, i + FILE_BATCH);
    const files = batch.flatMap((id) => [...(s.down[id].o ? [{ pageId: id, kind: "original" }] : []), ...(s.down[id].e ? [{ pageId: id, kind: "erased" }] : [])]);
    const { urls, missing } = await api<{ urls: SignedUrl[]; missing: { pageId: string; kind: string }[] }>("/api/sync/download-urls", { method: "POST", body: { files } });
    ensurePhotoDir();
    for (const u of urls) {
      const want = s.down[u.pageId];
      if (!want) continue;
      const stamp = u.kind === "erased" ? `~erased~${Date.now().toString(36)}` : "";
      const dest = photoPath(u.pageId, stamp);
      const r = await Taro.downloadFile({ url: absolute(u.url), filePath: dest } as Taro.downloadFile.Option);
      if (r.statusCode !== 200) continue;
      setLocalFile(u.pageId, u.kind === "erased" ? { erasedSrc: dest, erased: want.e } : { src: dest });
      if (u.kind === "erased") {
        (s.up[u.pageId] ??= {}).e = want.e;
        delete want.e;
      } else delete want.o;
      if (!want.o && !want.e) delete s.down[u.pageId];
      got = true;
    }
    // 服务器上暂时没有（另一台设备还没传完）：留着下次再试
    void missing;
    saveState(s);
    setStatus({ pendingDownloads: Object.keys(s.down).length });
  }
  return got;
}

/** 下载好的照片路径写回试卷（不改更新时间、不触发再推） */
function setLocalFile(pageId: string, patch: Partial<FolderPage>) {
  const at = index(listFolders()).pageAt.get(pageId);
  if (!at) return;
  const old = at.page.erasedSrc;
  if (patch.erasedSrc && old && old !== patch.erasedSrc) try { Taro.getFileSystemManager().unlinkSync(old); } catch { /* ignore */ }
  quietly(() => putFolder({ ...at.folder, papers: at.folder.papers.map((p) => (p.id === at.paper.id ? { ...p, pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, ...patch } : pg)) } : p)) }));
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
  const user = currentUser();
  if (!isLoggedIn() || !user) {
    setStatus({ state: "off" });
    return;
  }
  setStatus({ state: "running", error: undefined });
  const s = loadState(user.id);
  try {
    await push(s);
    const pulled = await pull(s);
    if (pulled) bump();
    await uploadPhotos(s);
    if (await downloadPhotos(s)) bump();
    setStatus({ state: "idle", lastAt: new Date().toISOString() });
  } catch (e) {
    saveState(s);
    const code = e instanceof ApiError ? e.status : 0;
    // 服务器关了同步（503）或没网：不打扰，下次再试
    setStatus({ state: code === 503 ? "off" : "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/** 本机改了之后几秒再同步，连续修改合成一次 */
export function scheduleSync(delayMs = 3000) {
  if (!isLoggedIn()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

let started = false;
/** 小程序启动时调一次：本机改动、登录状态变化时自动同步 */
export function initSync() {
  if (started) return;
  started = true;
  Taro.eventCenter.on(STORE_CHANGED_EVENT, () => scheduleSync());
  Taro.eventCenter.on("auth", () => scheduleSync(500));
}

/** 换账号 / 关闭云同步后：忘掉同步记录（本机数据不动） */
export function resetSyncState() {
  Taro.removeStorageSync(STATE_KEY);
}
