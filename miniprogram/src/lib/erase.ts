/**
 * 擦除手写（原题空白卷里给插图用，和 App 的 lib/erase.ts 同一套流程）：题目本身用扫描出的文字重排，
 * 只有插图要从照片里裁，裁之前把这些照片上的手写擦掉。
 * 要擦的照片一次交给服务器（POST /api/erase/jobs），擦除在服务器后台跑，任务号记在本机试卷上（paper.eraseJob），
 * 切走、杀掉小程序都不影响；扫描任务的轮询（lib/jobs.ts）顺带问擦除进度，擦好一张取回来另存一份（原图不动），全部好了弹提醒。
 */
import Taro from "@tarojs/taro";
import { api, apiBinary } from "./api";
import { rotateToTemp } from "./capture";
import { saveErased, updatePaper, type Folder, type Paper } from "./store";

interface ServerJob {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  totalPages: number;
  donePages: number;
  pages: { index: number; status: "pending" | "done" | "failed" }[];
  warning: string;
  error: string;
}

export interface EraseProgress {
  done: number;
  total: number;
  uploading?: boolean;
}

/** 擦除进度、提示有变化时通知页面 */
export const ERASE_EVENT = "erase";
const running = new Map<string, EraseProgress>(); // paperId → 进度（上传中 / 服务器在擦）
const warnings = new Map<string, string>(); // paperId → 最近一次擦除的提示
const submitting = new Set<string>();

const emit = () => Taro.eventCenter.trigger(ERASE_EVENT);
function setRunning(paperId: string, p: EraseProgress | null) {
  if (p) running.set(paperId, p);
  else running.delete(paperId);
  emit();
}

export const eraseProgress = (paperId: string) => running.get(paperId);
export const eraseWarning = (paperId: string) => warnings.get(paperId) ?? "";

/** 这些照片是不是都擦过了 */
export const allErased = (paper: Paper, ids: string[]) => ids.every((id) => paper.pages.find((pg) => pg.id === id)?.erased);

/** 照片压到最长边 2400 再传（原图可能好几 MB），返回 dataURL */
async function photoDataUrl(src: string): Promise<string> {
  const fs = Taro.getFileSystemManager();
  let path = src;
  try {
    path = await rotateToTemp(src, 0);
  } catch {
    path = src; // 压不了就传原图
  }
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(path, "base64") as string}`;
  } finally {
    if (path !== src) {
      try {
        fs.unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 提交擦除：读出要擦的照片（onlyIds 给了就只擦这几张）一起上传，拿到任务号记在试卷上，之后交给轮询。已经在擦的不重复提交。 */
export async function erasePaper(folderId: string, paper: Paper, onlyIds?: string[]): Promise<void> {
  const todo = onlyIds ? paper.pages.filter((pg) => onlyIds.includes(pg.id)) : paper.pages;
  if (paper.eraseJob || submitting.has(paper.id) || !todo.length) return;
  submitting.add(paper.id);
  const startedAt = new Date().toISOString();
  setRunning(paper.id, { done: 0, total: todo.length, uploading: true });
  try {
    const images: string[] = [];
    const pageIds: string[] = [];
    for (const pg of todo) {
      images.push(await photoDataUrl(pg.src));
      pageIds.push(pg.id);
    }
    const job = await api<ServerJob>("/api/erase/jobs", { method: "POST", body: { pages: images }, timeoutMs: 180000 });
    updatePaper(folderId, paper.id, { eraseJob: { id: job.id, startedAt, pageIds, done: job.donePages, total: job.totalPages } });
    warnings.delete(paper.id);
    setRunning(paper.id, { done: job.donePages, total: job.totalPages });
    Taro.eventCenter.trigger("jobs");
    void import("./jobs").then((m) => m.pollPendingJobs()); // 马上问一次，不等下一轮
  } catch (e) {
    setRunning(paper.id, null);
    throw e;
  } finally {
    submitting.delete(paper.id);
  }
}

/** 轮询里调用：问一个擦除任务，取回新擦好的照片；还没完返回 true。 */
export async function pollEraseJob(folder: Folder, paper: Paper): Promise<boolean> {
  const ref = paper.eraseJob;
  if (!ref) return false;
  let job: ServerJob;
  try {
    job = await api<ServerJob>(`/api/erase/jobs/${ref.id}`, { timeoutMs: 15000 });
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      updatePaper(folder.id, paper.id, { eraseJob: undefined });
      setRunning(paper.id, null);
      void Taro.showToast({ title: `「${paper.name}」的擦除已过期，请重新擦除`, icon: "none", duration: 3000 });
      return false;
    }
    setRunning(paper.id, { done: ref.done, total: ref.total });
    return true; // 网络问题，下次再问
  }

  // 擦好的照片取回来（这次任务之后还没存过的）
  let current = paper;
  const fresh = (pageId: string) => {
    const pg = current.pages.find((p) => p.id === pageId);
    return Boolean(pg?.erased && pg.erased >= ref.startedAt);
  };
  for (const p of job.pages) {
    const pageId = ref.pageIds[p.index];
    if (p.status !== "done" || !pageId || fresh(pageId) || !current.pages.some((pg) => pg.id === pageId)) continue;
    try {
      const buf = await apiBinary(`/api/erase/jobs/${ref.id}/pages/${p.index}`, { method: "GET", timeoutMs: 60000 });
      const saved = saveErased(folder.id, paper.id, pageId, buf);
      current = saved?.papers.find((x) => x.id === paper.id) ?? current;
    } catch {
      setRunning(paper.id, { done: job.donePages, total: job.totalPages });
      return true; // 下载断了，下次再取
    }
  }

  if (job.status === "queued" || job.status === "running") {
    if (job.donePages !== ref.done) updatePaper(folder.id, paper.id, { eraseJob: { ...ref, done: job.donePages, total: job.totalPages } });
    setRunning(paper.id, { done: job.donePages, total: job.totalPages });
    return true;
  }

  updatePaper(folder.id, paper.id, { eraseJob: undefined });
  const failedPages = job.pages.filter((p) => p.status === "failed").length;
  const warning = job.status === "failed" ? job.error || "擦除没有成功，请稍后再试" : failedPages ? `有 ${failedPages} 张没擦成功，可以重新擦除` : job.warning;
  if (warning) warnings.set(paper.id, warning);
  else warnings.delete(paper.id);
  setRunning(paper.id, null);
  void Taro.showToast({ title: job.status === "failed" ? `「${paper.name}」${warning}` : `「${paper.name}」的插图擦好了`, icon: "none", duration: 3000 });
  return false;
}
