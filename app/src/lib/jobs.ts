/** 扫描任务：提交给服务器后台跑，任务号记在本机试卷记录上；回前台 / 重开 App 时轮询进度，完成后把电子版落库。 */
import { create } from "zustand";
import { api } from "../api/client";
import type { DigitizeJob, DigitizedResult } from "../api/types";
import { getFolder, listFolders, saveFolder, updatePaper, type Paper } from "./folders";
import { isNative, prepareUpload, type UploadPart } from "./native";
import { getCity } from "./prefs";
import type { CapturePage } from "../store/capture";

export interface ScanJob {
  id: string;
  startedAt: string;
  parts: { page: number; x0: number; w: number }[]; // 上传片段 → 原照片的映射，拿结果时用
  progress: number; // 0–100
  status: "queued" | "running";
  startedPages?: number; // 已拿到识别槽位的照片数
  waiting?: number; // 全局队列里排在前面等槽位的照片数
}

/** 试卷行上显示的一句话：排队中 / 还原中 */
export function scanStageText(job: ScanJob): string {
  if (!job.startedPages && job.waiting && job.waiting > 0) return `排队中 · 前面还有 ${job.waiting} 张`;
  return `AI 还原中 ${job.progress}%`;
}

/** 任务有变化就 +1，页面据此重新读本机数据 */
export const useJobs = create<{ version: number; bump: () => void }>((set) => ({ version: 0, bump: () => set((s) => ({ version: s.version + 1 })) }));

/** 服务端按上传片段编号；把 page 换回试卷里的照片下标，并把片段内的 bbox 横向映射回整页坐标 */
export function remapParts(res: Pick<DigitizedResult, "pages" | "questions">, parts: ScanJob["parts"]): Pick<DigitizedResult, "pages" | "questions"> {
  const part = (i: number) => parts[i] ?? { page: i, x0: 0, w: 1 };
  const mapBox = (b: number[], p: { x0: number; w: number }) => (b.length === 4 ? [p.x0 + b[0] * p.w, b[1], p.x0 + b[2] * p.w, b[3]] : b);
  const pages = res.pages.map((sheet) => {
    const p = part(sheet.page);
    return { ...sheet, page: p.page, blocks: sheet.blocks.map((blk) => ({ ...blk, bbox: mapBox(blk.bbox, p) })) };
  });
  const questions = res.questions.map((q) => {
    const p = part(q.page);
    return { ...q, page: p.page, bbox: mapBox(q.bbox, p) };
  });
  return { pages, questions };
}

/** 把结果写进试卷：电子版、学科、清空任务；文件夹没选学科时顺手填上 */
async function finishJob(folderId: string, paperId: string, job: DigitizeJob, parts: ScanJob["parts"]): Promise<void> {
  const result = job.result;
  if (!result) return;
  const digitized: DigitizedResult = { ...remapParts(result, parts), provider: result.provider, at: new Date().toISOString() };
  const subject = digitized.pages.find((s) => s.subject)?.subject;
  await updatePaper(folderId, paperId, { digitized, scannedAt: digitized.at, corrected: {}, subject, scanJob: undefined, scanError: undefined });
  const folder = await getFolder(folderId);
  if (folder && !folder.subject && subject) await saveFolder({ ...folder, subject });
}

/** 压缩、上传、提交任务，任务号存到试卷上。返回时服务器已经在后台跑了。 */
export async function submitScan(folderId: string, paperId: string, pages: CapturePage[], onStage?: (stage: string) => void): Promise<ScanJob> {
  onStage?.("正在压缩试卷");
  const uploads: UploadPart[] = [];
  for (let i = 0; i < pages.length; i++) uploads.push(...(await prepareUpload(pages[i].src, i)));
  onStage?.("正在上传试卷");
  const region = await getCity();
  const job = await api<DigitizeJob>("/api/digitize", { method: "POST", body: { pages: uploads.map((p) => ({ image: p.image })), region }, timeoutMs: 120000 });
  const parts = uploads.map(({ page, x0, w }) => ({ page, x0, w }));
  if (job.status === "done") {
    await finishJob(folderId, paperId, job, parts);
    useJobs.getState().bump();
    return { id: job.jobId, startedAt: new Date().toISOString(), parts, progress: 100, status: "running" };
  }
  if (job.status === "failed") throw new Error(job.error || "AI 还原试卷出错了");
  const scanJob: ScanJob = { id: job.jobId, startedAt: new Date().toISOString(), parts, progress: job.progress, status: job.status };
  await updatePaper(folderId, paperId, { scanJob, scanError: undefined });
  useJobs.getState().bump();
  return scanJob;
}

let polling = false;

/** 问一遍所有进行中的任务；有变化就落库并通知页面 */
export async function pollPendingJobs(): Promise<number> {
  if (polling) return -1;
  polling = true;
  let pending = 0;
  try {
    const folders = await listFolders();
    for (const folder of folders) {
      for (const paper of folder.papers) {
        if (!paper.scanJob) continue;
        try {
          const job = await api<DigitizeJob>(`/api/digitize/jobs/${paper.scanJob.id}`, { timeoutMs: 15000 });
          if (job.status === "done") {
            await finishJob(folder.id, paper.id, job, paper.scanJob.parts);
            useJobs.getState().bump();
          } else if (job.status === "failed") {
            await updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: job.error || "还原失败，请重新扫描" });
            useJobs.getState().bump();
          } else {
            pending += 1;
            const started = job.startedPages ?? 0;
            // 自己这张还没开始时，前面排着的 = 全局等待数 - 自己的照片数（粗略）
            const waiting = started === 0 && job.queue ? Math.max(0, job.queue.waiting - job.totalPages) : 0;
            if (job.progress !== paper.scanJob.progress || job.status !== paper.scanJob.status || started !== paper.scanJob.startedPages || waiting !== paper.scanJob.waiting) {
              await updatePaper(folder.id, paper.id, { scanJob: { ...paper.scanJob, progress: job.progress, status: job.status, startedPages: started, waiting } });
              useJobs.getState().bump();
            }
          }
        } catch (e) {
          // 任务过期 / 不存在：标记失败让用户重扫；网络错误下次再试
          const status = (e as { status?: number }).status;
          if (status === 404) {
            await updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: "这次还原已过期，请重新扫描" });
            useJobs.getState().bump();
          } else {
            pending += 1;
          }
        }
      }
    }
  } finally {
    polling = false;
  }
  return pending;
}

/** 启动轮询：有任务时每 4 秒问一次；App 回到前台时立刻问一次。返回停止函数。 */
export function startJobPoller(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const pending = await pollPendingJobs();
    timer = setTimeout(tick, pending > 0 ? 4000 : 20000);
  };
  void tick();
  let remove: (() => void) | null = null;
  if (isNative) {
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void pollPendingJobs();
      }).then((h) => { remove = () => h.remove(); });
    });
  } else {
    const onVisible = () => { if (document.visibilityState === "visible") void pollPendingJobs(); };
    document.addEventListener("visibilitychange", onVisible);
    remove = () => document.removeEventListener("visibilitychange", onVisible);
  }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    remove?.();
  };
}

export const isScanning = (p: Paper) => Boolean(p.scanJob);
