/**
 * 后台导出：错题本 / 电子试卷交给服务器排版，App 不用守在导出面板上；生成好了弹提醒，「我的导出」里随时能再下载。
 *
 * 以前是一个请求里等服务器把 PDF 排好再整份传回 WebView，再转 base64 写文件。上百题、几 MB 的 PDF 在 iOS 上
 * 经常收到一半连接就断了（切到后台、WebView 内存紧张），面板一直停在「生成中…」。现在 PDF 留在服务器上，
 * 下载走原生 Filesystem.downloadFile 直接写进文件，不经过网页内存；断了也能在列表里重新下。
 */
import { create } from "zustand";
import { ApiError, api, apiBlob, authHeaders, getApiBase } from "../api/client";
import { exportPdf, isNative, sharePdfFile } from "../lib/native";
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

/** 下载生成好的 PDF 并拉起系统分享面板（打印、存到「文件」、发给老师） */
export async function openExport(job: ExportJob): Promise<void> {
  const path = `/api/exports/${job.id}/file`;
  const filename = exportFilename(job);
  if (isNative) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const target = `exports/${filename}`;
    await Filesystem.downloadFile({ url: `${getApiBase()}${path}`, method: "GET", headers: authHeaders(), path: target, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path: target, directory: Directory.Cache });
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
