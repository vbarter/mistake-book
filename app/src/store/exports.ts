/**
 * 后台导出：错题本 / 电子试卷交给服务器排版，App 不用守在导出面板上；生成好了弹提醒，「我的导出」里随时能再下载。
 *
 * 以前是一个请求里等服务器把 PDF 排好再整份传回 WebView，再转 base64 写文件。上百题、几 MB 的 PDF 在 iOS 上
 * 经常收到一半连接就断了（切到后台、WebView 内存紧张），面板一直停在「生成中…」。现在 PDF 留在服务器上，
 * 下载走原生 Filesystem.downloadFile 直接写进文件，不经过网页内存；断了也能在列表里重新下。
 */
import { create } from "zustand";
import { ApiError, api, apiBlob, authHeaders, getApiBase } from "../api/client";
import { blobToBase64, exportPdf, isNative, sharePdfFile } from "../lib/native";
import { useBanner } from "./banner";

export interface ExportJob {
  id: string;
  kind: "book" | "paper";
  title: string;
  detail: string;
  status: "queued" | "running" | "done" | "failed";
  error: string;
  pages: number;
  size: number;
  createdAt: string;
}

export const isPending = (j: ExportJob) => j.status === "queued" || j.status === "running";

/** 下载后的文件名：标题里的斜杠等不能做文件名的字符换掉 */
export function exportFilename(job: ExportJob): string {
  const name = (job.title || (job.kind === "book" ? "错题本" : "电子试卷")).replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60);
  return `${name}${job.kind === "paper" && !name.includes("试卷") ? " 电子试卷" : ""}.pdf`;
}

const RANGE = 256 * 1024;
const TRIES = 4;

/** 取文件的一段（bytes=start-end）；断了就等一会儿重试这一段，最多 4 次。服务器不支持分段时返回整份（status 200）。 */
async function fetchRange(url: string, start: number, end: number): Promise<{ status: number; blob: Blob }> {
  let last: unknown;
  for (let i = 0; i < TRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** (i - 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(url, { headers: { ...authHeaders(), Range: `bytes=${start}-${end}` }, signal: controller.signal });
      if (res.status === 404) throw new ApiError(404, "not_found", "这份导出已过期，请重新导出");
      if (res.status !== 206 && res.status !== 200) throw new ApiError(res.status, "error", "下载失败，请稍后再试");
      return { status: res.status, blob: await res.blob() };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw e;
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof ApiError ? last : new ApiError(0, "offline", "网络不稳定，下载断了好几次，请换个网络再试");
}

/**
 * 原生端下载：按 256 KB 一段用 Range 取，边下边追加写进缓存文件。
 * 一次下整份 PDF 时，手机到服务器的线路慢、不稳，经常传到一两百 KB 连接就被掐断（iOS 报「The network connection was lost.」），
 * 整份重来还是会断；分段后哪段断了只重试那一段。已经完整下过的同一份导出直接用本机文件。
 */
async function downloadToCache(job: ExportJob, path: string, target: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  try {
    const st = await Filesystem.stat({ path: target, directory: Directory.Cache });
    if (job.size > 0 && st.size === job.size) return st.uri;
  } catch { /* 还没下过 */ }
  const url = `${getApiBase()}${path}`;
  let at = 0;
  while (job.size <= 0 || at < job.size) {
    const end = job.size > 0 ? Math.min(job.size, at + RANGE) - 1 : at + RANGE - 1;
    const { status, blob } = await fetchRange(url, at, end);
    if (status === 200) {
      // 服务器没按分段给，拿到的就是整份：从头写
      await Filesystem.writeFile({ path: target, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
      break;
    }
    const data = await blobToBase64(blob);
    if (at === 0) await Filesystem.writeFile({ path: target, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path: target, data, directory: Directory.Cache });
    const wanted = end - at + 1;
    at += blob.size;
    if (blob.size < wanted) break; // 拿到的比要的少，说明到结尾了（没记大小的导出靠这个停）
  }
  return (await Filesystem.getUri({ path: target, directory: Directory.Cache })).uri;
}

/** 下载生成好的 PDF 并拉起系统分享面板（打印、存到「文件」、发给老师） */
export async function openExport(job: ExportJob): Promise<void> {
  const path = `/api/exports/${job.id}/file`;
  const filename = exportFilename(job);
  if (isNative) {
    // 每份导出一个目录：分享面板里显示的是原文件名，同名的两次导出也不会互相覆盖
    const uri = await downloadToCache(job, path, `exports/${job.id}/${filename}`);
    await sharePdfFile(uri, filename);
    return;
  }
  await exportPdf(await apiBlob(path, { method: "GET" }), filename);
}

interface ExportsState {
  items: ExportJob[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** 提交后台导出；服务器还是旧版本（没有 /exports）时返回 null，调用方退回直接生成 */
  submit: (body: Record<string, unknown>) => Promise<ExportJob | null>;
  remove: (id: string) => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const watching = new Set<string>(); // 本次打开 App 后提交的任务：完成时弹提醒

function notify(job: ExportJob) {
  const banner = useBanner.getState();
  if (job.status === "done") {
    banner.show(`「${job.title}」已生成`, { kind: "success", duration: 8000, action: { label: "打开", onClick: () => { openExport(job).catch((e) => { if (!/cancel/i.test(String((e as Error).message))) banner.show((e as Error).message || "下载失败，可以在「我的导出」里重试", { kind: "error", duration: 3000 }); }); } } });
  } else {
    banner.show(job.error || "导出没有成功，可以在「我的导出」里重试", { kind: "error", duration: 4000 });
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    await useExports.getState().refresh();
  }, 2500);
}

export const useExports = create<ExportsState>((set, get) => ({
  items: [],
  loaded: false,
  async refresh() {
    try {
      const { items } = await api<{ items: ExportJob[] }>("/api/exports");
      for (const j of items) {
        if (watching.has(j.id) && !isPending(j)) {
          watching.delete(j.id);
          notify(j);
        }
      }
      set({ items, loaded: true });
      if (items.some(isPending)) schedule();
    } catch {
      set({ loaded: true });
      if (get().items.some(isPending)) schedule();
    }
  },
  async submit(body) {
    let job: ExportJob;
    try {
      job = await api<ExportJob>("/api/exports", { method: "POST", body, timeoutMs: 120000 });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
      throw e;
    }
    set((s) => ({ items: [job, ...s.items.filter((j) => j.id !== job.id)] }));
    if (isPending(job)) {
      watching.add(job.id);
      schedule();
    } else {
      notify(job);
    }
    return job;
  },
  async remove(id) {
    await api(`/api/exports/${id}`, { method: "DELETE" });
    watching.delete(id);
    set((s) => ({ items: s.items.filter((j) => j.id !== id) }));
  },
}));
