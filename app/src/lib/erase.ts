/**
 * 照片擦除手写（原题空白卷里给插图用：题目本身用扫描出的文字重排，只有插图要从照片里裁，裁之前把这些照片的手写擦掉）。
 * 要擦的照片一次交给服务器（POST /api/erase/jobs），擦除在服务器后台跑，
 * 任务号记在本机试卷记录上（paper.eraseJob），切走、杀掉 App 都不影响；扫描任务的全局轮询（lib/jobs.ts）
 * 顺带问擦除任务的进度，擦好一张就取回来另存一份（folders.saveErased），原图不动，全部好了弹提醒。
 */
import { create } from "zustand";
import { api, apiBlob } from "../api/client";
import { useBanner } from "../store/banner";
import { loadPhoto, saveErased, updatePaper, type Folder, type Paper } from "./folders";
import { blobToBase64 } from "./native";

export interface EraseJobRef {
  id: string;
  startedAt: string; // 提交时间：照片的 erased 晚于它就是这次擦好的
  pageIds: string[]; // 提交的照片，下标对应服务器上的序号
  done: number;
  total: number;
}

interface ServerJob {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  totalPages: number;
  donePages: number;
  pages: { index: number; status: "pending" | "done" | "failed" }[];
  warning: string;
  error: string;
}

export interface Progress {
  done: number;
  total: number;
  startedAt: string;
  uploading?: boolean;
}

interface EraseState {
  running: Record<string, Progress>; // paperId → 进度（上传中 / 服务器在擦）
  warnings: Record<string, string>; // paperId → 最近一次擦除的提示（定位失败、某张没擦成等）
  set: (paperId: string, p: Progress | null) => void;
}

export const useErasing = create<EraseState>((set) => ({
  running: {},
  warnings: {},
  set: (paperId, p) =>
    set((s) => {
      const running = { ...s.running };
      if (p) running[paperId] = p;
      else delete running[paperId];
      return { running };
    }),
}));

const submitting = new Set<string>();

/** 提交擦除：读出要擦的原图（onlyIds 给了就只擦这几张）一起上传，拿到任务号记在试卷上，之后交给轮询。已经在擦的不重复提交。 */
export async function erasePaper(folderId: string, paper: Paper, onlyIds?: string[]): Promise<void> {
  const todo = onlyIds ? paper.pages.filter((pg) => onlyIds.includes(pg.id)) : paper.pages;
  if (paper.eraseJob || submitting.has(paper.id) || !todo.length) return;
  submitting.add(paper.id);
  const startedAt = new Date().toISOString();
  const store = useErasing.getState();
  store.set(paper.id, { done: 0, total: todo.length, startedAt, uploading: true });
  try {
    const images: string[] = [];
    const pageIds: string[] = [];
    for (const pg of todo) {
      const src = await loadPhoto(pg);
      if (src) {
        images.push(src);
        pageIds.push(pg.id);
      }
    }
    if (!images.length) throw new Error("找不到这份试卷的照片");
    const job = await api<ServerJob>("/api/erase/jobs", { method: "POST", body: { pages: images }, timeoutMs: 180000 });
    await updatePaper(folderId, paper.id, { eraseJob: { id: job.id, startedAt, pageIds, done: job.donePages, total: job.totalPages } });
    store.set(paper.id, { done: job.donePages, total: job.totalPages, startedAt });
    useErasing.setState((s) => ({ warnings: { ...s.warnings, [paper.id]: "" } }));
    void import("./jobs").then((m) => m.pollPendingJobs()); // 马上问一次，不等下一轮
  } catch (e) {
    store.set(paper.id, null);
    throw e;
  } finally {
    submitting.delete(paper.id);
  }
}

/** 轮询里调用：问一个擦除任务，取回新擦好的照片；还没完返回 true。 */
export async function pollEraseJob(folder: Folder, paper: Paper): Promise<boolean> {
  const ref = paper.eraseJob;
  if (!ref) return false;
  const store = useErasing.getState();
  let job: ServerJob;
  try {
    job = await api<ServerJob>(`/api/erase/jobs/${ref.id}`, { timeoutMs: 15000 });
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      await updatePaper(folder.id, paper.id, { eraseJob: undefined });
      store.set(paper.id, null);
      useBanner.getState().show(`「${paper.name}」的擦除已过期，请重新擦除`, { kind: "error", duration: 4000 });
      return false;
    }
    store.set(paper.id, { done: ref.done, total: ref.total, startedAt: ref.startedAt });
    return true; // 网络问题，下次再问
  }

  // 擦好的照片取回来（这次任务之后还没存过的）
  const fresh = (pageId: string) => {
    const pg = paper.pages.find((p) => p.id === pageId);
    return Boolean(pg?.erased && pg.erased >= ref.startedAt);
  };
  for (const p of job.pages) {
    const pageId = ref.pageIds[p.index];
    if (p.status !== "done" || !pageId || fresh(pageId) || !paper.pages.some((pg) => pg.id === pageId)) continue;
    try {
      const blob = await apiBlob(`/api/erase/jobs/${ref.id}/pages/${p.index}`, { method: "GET", timeoutMs: 60000 });
      await saveErased(folder.id, paper.id, pageId, `data:image/jpeg;base64,${await blobToBase64(blob)}`);
    } catch {
      store.set(paper.id, { done: job.donePages, total: job.totalPages, startedAt: ref.startedAt });
      return true; // 下载断了，下次再取
    }
  }

  if (job.status === "queued" || job.status === "running") {
    if (job.donePages !== ref.done) await updatePaper(folder.id, paper.id, { eraseJob: { ...ref, done: job.donePages, total: job.totalPages } });
    store.set(paper.id, { done: job.donePages, total: job.totalPages, startedAt: ref.startedAt });
    return true;
  }

  await updatePaper(folder.id, paper.id, { eraseJob: undefined });
  store.set(paper.id, null);
  const failedPages = job.pages.filter((p) => p.status === "failed").length;
  const warning = job.status === "failed" ? job.error || "擦除没有成功，请稍后再试" : failedPages ? `有 ${failedPages} 张没擦成功，可以重新擦除` : job.warning;
  useErasing.setState((s) => ({ warnings: { ...s.warnings, [paper.id]: warning } }));
  if (job.status === "failed") useBanner.getState().show(`「${paper.name}」${warning}`, { kind: "error", duration: 5000 });
  else useBanner.getState().show(`「${paper.name}」的插图擦好了，可以导出原题空白卷`, { kind: "success", duration: 5000 });
  return false;
}

/** 这些照片是不是都擦过了 */
export const allErased = (paper: Paper, ids: string[]) => ids.every((id) => paper.pages.find((pg) => pg.id === id)?.erased);
