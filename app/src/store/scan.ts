import { create } from "zustand";
import { Preferences } from "@capacitor/preferences";
import type { Quad } from "../lib/docDetect";
import { clearDraftRows, deleteDraftRows, getDraftRow, newId, putDraftRow, toPage, type FullPage } from "../lib/folders";
import { processShot } from "../lib/scanProcess";

/**
 * 连拍扫描这一批照片：取景页拍一张进一张，后台排队拉正；逐张查看、调四角、整理分份都改这里；开始识别后清空。
 * 每张的原图和处理好的图都存进本机草稿（见 folders.ts 的 DraftRow），App 被杀也能找回。
 */
export interface ScanShot {
  id: string;
  raw: string; // 拍下的原图（调四角时从它重新拉正）
  rawW: number;
  rawH: number;
  quad: Quad | null; // 纸的四个角，相对原图的 0–1 坐标；null = 整张不裁
  autoQuad: Quad | null; // 拍下时自动找到的框（「重新识别」回到它）
  turns: number; // 顺时针转了几个 90°
  status: "busy" | "ok" | "fail";
  page?: FullPage; // 处理好的照片（拉正、提亮、转正）
  sharp?: number; // 清晰度，越大越清楚
  fromAlbum?: boolean; // 相册导入的：不裁不提亮，原样用
}

export type ScanMode = "one" | "each" | "custom";

interface ScanState {
  shots: ScanShot[];
  /** 从这几张照片开始另起一份（第一张不用记） */
  cuts: string[];
  mode: ScanMode;
  folderId: string | null;
  from: string;
  enhance: boolean;
  autoShoot: boolean;
  restored: boolean; // 已经试过读本机草稿
}

export const useScan = create<ScanState>(() => ({
  shots: [],
  cuts: [],
  mode: "one",
  folderId: null,
  from: "/home",
  enhance: true,
  autoShoot: false,
  restored: false,
}));

// ---------------------------------------------------------------- 偏好

const PREF_KEY = "zcb.scan.prefs";

export async function loadScanPrefs(): Promise<void> {
  try {
    const v = (await Preferences.get({ key: PREF_KEY })).value;
    if (!v) return;
    const p = JSON.parse(v) as { enhance?: boolean; autoShoot?: boolean };
    useScan.setState({ enhance: p.enhance ?? true, autoShoot: p.autoShoot ?? false });
  } catch { /* ignore */ }
}

function savePrefs() {
  const { enhance, autoShoot } = useScan.getState();
  void Preferences.set({ key: PREF_KEY, value: JSON.stringify({ enhance, autoShoot }) }).catch(() => undefined);
}

export function setAutoShoot(on: boolean) {
  useScan.setState({ autoShoot: on });
  savePrefs();
}

/** 提亮开关：改了以后已拍的照片按新设置重做 */
export function setEnhance(on: boolean) {
  useScan.setState({ enhance: on });
  savePrefs();
  for (const s of useScan.getState().shots) if (!s.fromAlbum) reprocess(s.id);
}

// ---------------------------------------------------------------- 草稿

interface DraftManifest {
  folderId: string | null;
  from: string;
  cuts: string[];
  mode: ScanMode;
  shots: (Omit<ScanShot, "raw" | "page" | "status"> & { page?: Omit<FullPage, "src"> })[];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveManifest() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = useScan.getState();
    if (!s.shots.length) {
      void clearDraftRows().catch(() => undefined);
      return;
    }
    const m: DraftManifest = {
      folderId: s.folderId,
      from: s.from,
      cuts: s.cuts,
      mode: s.mode,
      shots: s.shots.map(({ raw: _raw, page, status: _st, ...rest }) => {
        void _raw;
        void _st;
        if (!page) return rest;
        const { src: _src, ...meta } = page;
        void _src;
        return { ...rest, page: meta };
      }),
    };
    void putDraftRow("manifest", JSON.stringify(m)).catch(() => undefined);
  }, 300);
}

/** 进相机 / 整理页时调用：内存里没有照片就读本机草稿。返回找回了几张 */
export async function restoreDraft(): Promise<number> {
  const st = useScan.getState();
  if (st.restored || st.shots.length) {
    useScan.setState({ restored: true });
    return 0;
  }
  useScan.setState({ restored: true });
  try {
    const raw = await getDraftRow("manifest");
    if (!raw) return 0;
    const m = JSON.parse(raw) as DraftManifest;
    const shots: ScanShot[] = [];
    for (const s of m.shots) {
      const rawSrc = await getDraftRow(`raw~${s.id}`);
      if (!rawSrc) continue;
      const pageSrc = s.page ? await getDraftRow(`pg~${s.id}`) : null;
      shots.push({ ...s, raw: rawSrc, page: s.page && pageSrc ? { ...s.page, src: pageSrc } : undefined, status: s.page && pageSrc ? "ok" : "busy" });
    }
    if (!shots.length) return 0;
    const ids = new Set(shots.map((s) => s.id));
    useScan.setState({ shots, cuts: m.cuts.filter((c) => ids.has(c)), mode: m.mode, folderId: m.folderId, from: m.from });
    for (const s of shots) if (s.status !== "ok") reprocess(s.id);
    return shots.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- 处理队列

const queue: string[] = [];
let running = false;
/** 每张照片的处理版本：处理途中又调了四角 / 转了方向，旧的结果作废 */
const version = new Map<string, number>();

function patch(id: string, p: Partial<ScanShot>) {
  useScan.setState((s) => ({ shots: s.shots.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const shot = useScan.getState().shots.find((s) => s.id === id);
      if (!shot) continue;
      const v = version.get(id) ?? 0;
      try {
        const enhance = !shot.fromAlbum && useScan.getState().enhance;
        const { src, sharp } = await processShot(shot.raw, shot.quad, shot.turns, enhance);
        if ((version.get(id) ?? 0) !== v) continue; // 处理途中又改了：后面还排着一次
        const page = await toPage(src);
        if (!useScan.getState().shots.some((s) => s.id === id)) continue;
        patch(id, { page, sharp, status: "ok" });
        await putDraftRow(`pg~${id}`, src).catch(() => undefined);
        saveManifest();
      } catch {
        if ((version.get(id) ?? 0) === v) patch(id, { status: "fail" });
      }
    }
  } finally {
    running = false;
  }
}

/** 重新处理一张（调了四角、转了方向、改了提亮） */
export function reprocess(id: string) {
  version.set(id, (version.get(id) ?? 0) + 1);
  patch(id, { status: "busy" });
  if (!queue.includes(id)) queue.push(id);
  void pump();
}

// ---------------------------------------------------------------- 增删改

export function startScan(folderId: string | null, from: string) {
  const s = useScan.getState();
  // 已有没提交的照片：接着用原来那批（放进的文件夹以原来的为准）
  if (s.shots.length) return;
  useScan.setState({ folderId, from, cuts: [], mode: "one" });
}

/** 拍下一张：先放进来（显示「调正中」），后台拉正 */
export function addShot(raw: string, rawW: number, rawH: number, quad: Quad | null): string {
  const id = newId();
  const shot: ScanShot = { id, raw, rawW, rawH, quad, autoQuad: quad, turns: 0, status: "busy" };
  useScan.setState((s) => ({ shots: [...s.shots, shot], cuts: s.mode === "each" ? [...s.cuts, id] : s.cuts }));
  void putDraftRow(`raw~${id}`, raw).catch(() => undefined);
  saveManifest();
  reprocess(id);
  return id;
}

/** 相册选的照片：不裁、不提亮，原样进来 */
export async function addAlbumPages(srcs: string[]): Promise<void> {
  for (const raw of srcs) {
    const page = await toPage(raw);
    const id = newId();
    const shot: ScanShot = { id, raw, rawW: page.width, rawH: page.height, quad: null, autoQuad: null, turns: 0, status: "ok", page, fromAlbum: true };
    useScan.setState((s) => ({ shots: [...s.shots, shot], cuts: s.mode === "each" ? [...s.cuts, id] : s.cuts }));
    await putDraftRow(`raw~${id}`, raw).catch(() => undefined);
    await putDraftRow(`pg~${id}`, raw).catch(() => undefined);
  }
  saveManifest();
}

/** 删掉一张，返回删掉的（撤销用） */
export function removeShot(id: string): { shot: ScanShot; index: number; cut: boolean } | null {
  const s = useScan.getState();
  const index = s.shots.findIndex((x) => x.id === id);
  if (index < 0) return null;
  const shot = s.shots[index];
  const cut = s.cuts.includes(id);
  const shots = s.shots.filter((x) => x.id !== id);
  // 删掉的是一份的第一张：下一张接着当这一份的开头
  let cuts = s.cuts.filter((c) => c !== id);
  if (cut && shots[index] && !cuts.includes(shots[index].id)) cuts = [...cuts, shots[index].id];
  version.set(id, (version.get(id) ?? 0) + 1);
  useScan.setState({ shots, cuts });
  void deleteDraftRows([`raw~${id}`, `pg~${id}`]).catch(() => undefined);
  saveManifest();
  return { shot, index, cut };
}

/** 撤销删除：放回原来的位置 */
export function restoreShot(r: { shot: ScanShot; index: number; cut: boolean }) {
  useScan.setState((s) => {
    const shots = s.shots.slice();
    shots.splice(Math.min(r.index, shots.length), 0, r.shot);
    return { shots, cuts: r.cut ? [...s.cuts, r.shot.id] : s.cuts };
  });
  void putDraftRow(`raw~${r.shot.id}`, r.shot.raw).catch(() => undefined);
  if (r.shot.page) void putDraftRow(`pg~${r.shot.id}`, r.shot.page.src).catch(() => undefined);
  saveManifest();
}

export function setQuad(id: string, quad: Quad | null) {
  patch(id, { quad });
  saveManifest();
  reprocess(id);
}

export function rotateShot(id: string, delta: number) {
  const shot = useScan.getState().shots.find((s) => s.id === id);
  if (!shot) return;
  patch(id, { turns: (((shot.turns + delta) % 4) + 4) % 4 });
  saveManifest();
  reprocess(id);
}

export function moveShot(from: number, to: number) {
  useScan.setState((s) => {
    const shots = s.shots.slice();
    const [x] = shots.splice(from, 1);
    shots.splice(to, 0, x);
    return { shots };
  });
  saveManifest();
}

/** 第 index 张前面的缝：拆开（另起一份）/ 连上 */
export function toggleCut(id: string) {
  useScan.setState((s) => ({ cuts: s.cuts.includes(id) ? s.cuts.filter((c) => c !== id) : [...s.cuts, id], mode: "custom" }));
  saveManifest();
}

export function setMode(mode: ScanMode) {
  useScan.setState((s) => ({ mode, cuts: mode === "one" ? [] : mode === "each" ? s.shots.map((x) => x.id) : s.cuts }));
  saveManifest();
}

export function setScanFolder(folderId: string | null) {
  useScan.setState({ folderId });
  saveManifest();
}

/** 按缝分好的几份：每份是照片下标 */
export function unitsOf(shots: ScanShot[], cuts: string[]): number[][] {
  const out: number[][] = [];
  shots.forEach((s, i) => {
    if (i === 0 || cuts.includes(s.id)) out.push([i]);
    else out[out.length - 1].push(i);
  });
  return out;
}

/** 提交识别以后 / 放弃这一批：清空内存和本机草稿 */
export function clearScan() {
  queue.length = 0;
  version.clear();
  useScan.setState({ shots: [], cuts: [], mode: "one", restored: true });
  if (saveTimer) clearTimeout(saveTimer);
  void clearDraftRows().catch(() => undefined);
}
