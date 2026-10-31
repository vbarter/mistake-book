/** 扫描任务：提交给服务器后台跑，任务号记在本机试卷记录上；回前台 / 重开 App 时轮询进度，完成后把电子版落库。 */
import { create } from "zustand";
import { api } from "../api/client";
import type { DigitizeJob, DigitizedQuestion, DigitizedResult } from "../api/types";
import { autoMark, getFolder, isDefaultFolderName, isDefaultPaperName, isUnreadable, listFolders, loadPages, recognizedTitle, updateFolder, updatePaper, validDigitized, type Folder, type FullPage, type Paper } from "./folders";
import { SUBJECT_LABEL } from "./format";
import { isNative, prepareUpload, type UploadPart } from "./native";
import { getCity } from "./prefs";

export interface ScanJob {
  id: string;
  startedAt: string;
  parts: { page: number; x0: number; w: number }[]; // 上传片段 → 原照片的映射，拿结果时用
  progress: number; // 0–100
  status: "queued" | "running";
  startedPages?: number; // 已拿到识别槽位的照片数
  waiting?: number; // 全局队列里排在前面等槽位的照片数
  queued?: boolean; // 自己的照片还没开始识别，在排队
}

/** 试卷行上显示的一句话：排队中 / 扫描中 */
export function scanStageText(job: ScanJob): string {
  if (!job.startedPages && job.waiting && job.waiting > 0) return `排队中 · 前面还有 ${job.waiting} 张`;
  if (!job.startedPages && job.queued) return "排队中";
  return `扫描中 ${job.progress}%`;
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
  // 扫描时间取服务器上任务完成的时刻（切到后台很久才拿到结果，也记真实的扫描时间）
  const scannedAt = (job.status === "done" && job.updatedAt) || new Date().toISOString();
  const digitized: DigitizedResult = { ...remapParts(result, parts), provider: result.provider, at: scannedAt };
  const subject = digitized.pages.find((s) => s.subject)?.subject;
  // 自动归档：试卷名换成识别出的卷头标题，文件夹名补上学科和考试类型（用户改过的名字不动）
  const before = (await getFolder(folderId))?.papers.find((p) => p.id === paperId);
  const title = recognizedTitle(digitized);
  const name = before && isDefaultPaperName(before.name) && title ? title : undefined;
  await updatePaper(folderId, paperId, { digitized, scannedAt, corrected: {}, subject, scanJob: undefined, scanError: undefined, ...(name ? { name } : {}) });
  const folder = await getFolder(folderId);
  if (!folder) return;
  const level = digitized.pages.find((s) => s.examLevel)?.examLevel ?? "";
  const rename = isDefaultFolderName(folder.name) && subject ? `${folder.name.replace(/ 试卷$/, "")} ${SUBJECT_LABEL[subject]}${level ? ` · ${level}` : ""}` : null;
  if ((!folder.subject && subject) || rename) await updateFolder(folderId, { subject: folder.subject ?? subject, name: rename ?? folder.name });
}

/** 压缩、上传、提交任务，任务号存到试卷上。返回时服务器已经在后台跑了。 */
export async function submitScan(folderId: string, paperId: string, pages: FullPage[], onStage?: (stage: string) => void): Promise<ScanJob> {
  onStage?.("正在压缩试卷");
  const uploads: UploadPart[] = [];
  for (let i = 0; i < pages.length; i++) uploads.push(...(await prepareUpload(pages[i].src, i)));
  onStage?.("正在上传试卷");
  const region = await getCity();
  const job = await api<DigitizeJob>("/api/digitize", { method: "POST", body: { pages: uploads.map((p) => ({ image: p.image })), region }, timeoutMs: 600000 }); // 照片多时上传要久一点
  const parts = uploads.map(({ page, x0, w }) => ({ page, x0, w }));
  if (job.status === "done") {
    await finishJob(folderId, paperId, job, parts);
    useJobs.getState().bump();
    return { id: job.jobId, startedAt: new Date().toISOString(), parts, progress: 100, status: "running" };
  }
  if (job.status === "failed") throw new Error(job.error || "扫描出错了");
  const queued = (job.startedPages ?? 0) === 0 && Boolean(job.queue && job.queue.running >= job.queue.limit);
  const scanJob: ScanJob = { id: job.jobId, startedAt: new Date().toISOString(), parts, progress: job.progress, status: job.status, queued };
  await updatePaper(folderId, paperId, { scanJob, scanError: undefined });
  useJobs.getState().bump();
  return scanJob;
}

/** 拍好了还没交给服务器扫描的试卷（含上次扫描失败的） */
export const needsScan = (p: Paper) => p.pages.length > 0 && !p.scanJob && !validDigitized(p.digitized);

/**
 * 一键扫描：把文件夹里拍好、还没扫描的试卷一份一份上传提交。
 * 每次只读一份试卷的原图，传完就丢，不会同时把所有照片放在内存里。返回成功提交的份数。
 */
export async function scanPending(folder: Folder, onStage?: (i: number, n: number) => void): Promise<number> {
  const todo = folder.papers.filter(needsScan);
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    onStage?.(i, todo.length);
    try {
      const pages = await loadPages(todo[i]);
      if (!pages.length) continue;
      await submitScan(folder.id, todo[i].id, pages);
      ok += 1;
    } catch (e) {
      await updatePaper(folder.id, todo[i].id, { scanError: (e as Error).message || "上传失败，请重试" }).catch(() => undefined);
    }
  }
  useJobs.getState().bump();
  return ok;
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
            await updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: job.error || "扫描失败，请重新扫描" });
            useJobs.getState().bump();
          } else {
            pending += 1;
            const started = job.startedPages ?? 0;
            // 自己这张还没开始时，前面排着的 = 全局等待数 - 自己的照片数（粗略）
            const waiting = started === 0 && job.queue ? Math.max(0, job.queue.waiting - job.totalPages) : 0;
            const queued = started === 0 && Boolean(job.queue && job.queue.running >= job.queue.limit);
            if (job.progress !== paper.scanJob.progress || job.status !== paper.scanJob.status || started !== paper.scanJob.startedPages || waiting !== paper.scanJob.waiting || queued !== paper.scanJob.queued) {
              await updatePaper(folder.id, paper.id, { scanJob: { ...paper.scanJob, progress: job.progress, status: job.status, startedPages: started, waiting, queued } });
              useJobs.getState().bump();
            }
          }
        } catch (e) {
          // 任务过期 / 不存在：标记失败让用户重扫；网络错误下次再试
          const status = (e as { status?: number }).status;
          if (status === 404) {
            await updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: "这次扫描已过期，请重新扫描" });
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

// ---------------------------------------------------------------- 补做 AI 阅卷

const grading = new Set<string>();

/** 有没有老师没批改、按答案也判不了、学生又写了（看得清的）作答的空 */
export function needsGrading(paper: Paper): boolean {
  const d = validDigitized(paper.digitized);
  if (!d || paper.scanJob) return false;
  return d.pages.some((s) =>
    s.blocks.some((b) => (b.type === "item" || b.type === "passage") && b.blanks.some((x) => x.student.trim() && !isUnreadable(x.student) && autoMark(x.mark, x.student, x.answer, b.questionType) === "unmarked")),
  );
}

/** 这张试卷正在补做阅卷（界面上把「未批改」显示成「批改中」） */
export const isGrading = (paperId: string) => grading.has(paperId);

/** 还有没批改的空就交给服务器的大模型补判；判完写回本机。每张试卷只自动补一次（gradedAt），失败下次打开再试。 */
export async function gradeIfNeeded(folderId: string, paper: Paper): Promise<void> {
  if (grading.has(paper.id) || paper.gradedAt || !needsGrading(paper)) return;
  const d = validDigitized(paper.digitized)!;
  grading.add(paper.id);
  useJobs.getState().bump();
  try {
    const res = await api<{ pages: DigitizedResult["pages"]; questions: DigitizedQuestion[]; graded: number }>("/api/digitize/grade", { method: "POST", body: { pages: d.pages }, timeoutMs: 240000 });
    await updatePaper(folderId, paper.id, { digitized: { ...paper.digitized!, pages: res.pages, questions: res.questions }, gradedAt: new Date().toISOString() });
  } catch {
    /* 网络等问题：下次打开再试 */
  } finally {
    grading.delete(paper.id);
    useJobs.getState().bump();
  }
}
