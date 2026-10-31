/** 扫描任务：照片压缩上传给服务器后台跑，任务号记在试卷上；轮询进度，完成后把电子版落库。规则和 App 的 lib/jobs.ts 一致。 */
import Taro from "@tarojs/taro";
import { api } from "./api";
import type { DigitizeJob, DigitizedQuestion, DigitizedResult } from "./types";
import { autoMark, isProblem, isUnreadable, validDigitized } from "./logic";
import { getFolder, listFolders, saveFolder, updatePaper, type FolderPage, type Paper } from "./store";

export interface ScanJob {
  id: string;
  startedAt: string;
  parts: { page: number; x0: number; w: number }[];
  progress: number;
  status: "queued" | "running";
  startedPages?: number;
  waiting?: number;
  queued?: boolean;
}

/** 有变化就通知页面重新读本机数据 */
export const JOBS_EVENT = "jobs";
export const bump = () => Taro.eventCenter.trigger(JOBS_EVENT);

export function scanStageText(job: ScanJob): string {
  if (!job.startedPages && job.waiting && job.waiting > 0) return `排队中 · 前面还有 ${job.waiting} 张`;
  if (!job.startedPages && job.queued) return "排队中";
  return `扫描中 ${job.progress}%`;
}

export function remapParts(res: Pick<DigitizedResult, "pages" | "questions">, parts: ScanJob["parts"]): Pick<DigitizedResult, "pages" | "questions"> {
  const part = (i: number) => parts[i] ?? { page: i, x0: 0, w: 1 };
  const mapBox = (b: number[], p: { x0: number; w: number }) => (b.length === 4 ? [p.x0 + b[0] * p.w, b[1], p.x0 + b[2] * p.w, b[3]] : b);
  return {
    pages: res.pages.map((sheet) => {
      const p = part(sheet.page);
      return { ...sheet, page: p.page, blocks: sheet.blocks.map((blk) => ({ ...blk, bbox: mapBox(blk.bbox, p) })) };
    }),
    questions: res.questions.map((q) => {
      const p = part(q.page);
      return { ...q, page: p.page, bbox: mapBox(q.bbox, p) };
    }),
  };
}

function finishJob(folderId: string, paperId: string, job: DigitizeJob, parts: ScanJob["parts"]) {
  const result = job.result;
  if (!result) return;
  const scannedAt = (job.status === "done" && job.updatedAt) || new Date().toISOString();
  const digitized: DigitizedResult = { ...remapParts(result, parts), provider: result.provider, at: scannedAt };
  const subject = digitized.pages.find((s) => s.subject)?.subject;
  updatePaper(folderId, paperId, { digitized, scannedAt, subject, scanJob: undefined, scanError: undefined, gradedAt: undefined, taggedAt: undefined });
  const folder = getFolder(folderId);
  if (folder && !folder.subject && subject) saveFolder({ ...folder, subject });
}

// ---------------------------------------------------------------- 压缩与切图

/** 模型会把图压到最长边约 1568px；两页并排的宽幅照片切成左右两张再传，手写才不糊 */
const UPLOAD_MAX_SIDE = 1568;
const SPLIT_ASPECT = 1.3;

interface UploadPart {
  page: number;
  image: string; // dataURL
  x0: number;
  w: number;
}

function readBase64(path: string): string {
  return Taro.getFileSystemManager().readFileSync(path, "base64") as string;
}

/** 用离屏 canvas 裁切 + 缩放成 JPEG dataURL；基础库太老不支持时返回 null */
async function drawPart(src: string, W: number, H: number, x0: number, w: number): Promise<string | null> {
  try {
    const sw = Math.round(W * w);
    const sx = Math.round(W * x0);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(sw, H));
    const cw = Math.round(sw * scale);
    const ch = Math.round(H * scale);
    const canvas = Taro.createOffscreenCanvas({ type: "2d", width: cw, height: ch }) as unknown as {
      getContext: (t: "2d") => { fillStyle: string; fillRect: (...a: number[]) => void; drawImage: (...a: unknown[]) => void };
      createImage: () => { src: string; onload: () => void; onerror: (e: unknown) => void };
      toDataURL: (type: string, q: number) => string;
    };
    const img = canvas.createImage();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = src;
    });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, sx, 0, sw, H, 0, 0, cw, ch);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return url && url.startsWith("data:image") ? url : null;
  } catch {
    return null;
  }
}

/** 一页照片 → 上传片段：宽幅照片切成左右两张（各带 2% 重叠），其余整张；都缩到 1568 */
async function prepareUpload(page: FolderPage, index: number): Promise<UploadPart[]> {
  const parts = page.width / page.height >= SPLIT_ASPECT ? [{ x0: 0, w: 0.52 }, { x0: 0.48, w: 0.52 }] : [{ x0: 0, w: 1 }];
  const out: UploadPart[] = [];
  for (const p of parts) {
    const url = await drawPart(page.src, page.width, page.height, p.x0, p.w);
    if (url) {
      out.push({ page: index, image: url, ...p });
      continue;
    }
    // 兜底：不切图，系统压缩后整张上传
    let path = page.src;
    try {
      path = (await Taro.compressImage({ src: page.src, quality: 80, compressedWidth: page.width >= page.height ? UPLOAD_MAX_SIDE : undefined, compressedHeight: page.height > page.width ? UPLOAD_MAX_SIDE : undefined })).tempFilePath;
    } catch {
      /* 用原图 */
    }
    return [{ page: index, image: `data:image/jpeg;base64,${readBase64(path)}`, x0: 0, w: 1 }];
  }
  return out;
}

/** 压缩、上传、提交任务，任务号存到试卷上 */
export async function submitScan(folderId: string, paperId: string, pages: FolderPage[]): Promise<void> {
  const uploads: UploadPart[] = [];
  for (let i = 0; i < pages.length; i++) uploads.push(...(await prepareUpload(pages[i], i)));
  let region = "";
  try {
    region = Taro.getStorageSync("zcb.city") || "";
  } catch {
    /* ignore */
  }
  const job = await api<DigitizeJob>("/api/digitize", { method: "POST", body: { pages: uploads.map((p) => ({ image: p.image })), region }, timeoutMs: 600000 });
  const parts = uploads.map(({ page, x0, w }) => ({ page, x0, w }));
  if (job.status === "done") {
    finishJob(folderId, paperId, job, parts);
    bump();
    return;
  }
  if (job.status === "failed") throw new Error(job.error || "扫描出错了");
  const queued = (job.startedPages ?? 0) === 0 && Boolean(job.queue && job.queue.running >= job.queue.limit);
  updatePaper(folderId, paperId, { scanJob: { id: job.jobId, startedAt: new Date().toISOString(), parts, progress: job.progress, status: job.status, queued }, scanError: undefined });
  bump();
}

let polling = false;

export async function pollPendingJobs(): Promise<number> {
  if (polling) return -1;
  polling = true;
  let pending = 0;
  try {
    for (const folder of listFolders()) {
      for (const paper of folder.papers) {
        const sj = paper.scanJob;
        if (!sj) continue;
        try {
          const job = await api<DigitizeJob>(`/api/digitize/jobs/${sj.id}`, { timeoutMs: 15000 });
          if (job.status === "done") {
            finishJob(folder.id, paper.id, job, sj.parts);
            bump();
          } else if (job.status === "failed") {
            updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: job.error || "扫描失败，请重新扫描" });
            bump();
          } else {
            pending += 1;
            const started = job.startedPages ?? 0;
            const waiting = started === 0 && job.queue ? Math.max(0, job.queue.waiting - job.totalPages) : 0;
            const queued = started === 0 && Boolean(job.queue && job.queue.running >= job.queue.limit);
            if (job.progress !== sj.progress || job.status !== sj.status || started !== sj.startedPages || waiting !== sj.waiting || queued !== sj.queued) {
              updatePaper(folder.id, paper.id, { scanJob: { ...sj, progress: job.progress, status: job.status, startedPages: started, waiting, queued } });
              bump();
            }
          }
        } catch (e) {
          if ((e as { status?: number }).status === 404) {
            updatePaper(folder.id, paper.id, { scanJob: undefined, scanError: "这次扫描已过期，请重新扫描" });
            bump();
          } else pending += 1;
        }
      }
    }
  } finally {
    polling = false;
  }
  return pending;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** 前台时轮询：有任务 4 秒一次，没任务 20 秒一次 */
export function startJobPoller() {
  stopJobPoller();
  const tick = async () => {
    const pending = await pollPendingJobs();
    timer = setTimeout(tick, pending > 0 ? 4000 : 20000);
  };
  void tick();
}

export function stopJobPoller() {
  if (timer) clearTimeout(timer);
  timer = null;
}

// ---------------------------------------------------------------- 补做 AI 阅卷

const grading = new Set<string>();

export function needsGrading(paper: Paper): boolean {
  const d = validDigitized(paper.digitized);
  if (!d || paper.scanJob) return false;
  return d.pages.some((s) =>
    s.blocks.some((b) => (b.type === "item" || b.type === "passage") && b.blanks.some((x) => x.student.trim() && !isUnreadable(x.student) && autoMark(x.mark, x.student, x.answer, b.questionType) === "unmarked")),
  );
}

export const isGrading = (paperId: string) => grading.has(paperId);

const tagging = new Set<string>();
let taggingDisabled = false; // 服务器说开关没开：这次启动里不再问

/** 有判错 / 没作答、还没标上图谱知识点的题 */
export function needsTagging(paper: Paper): boolean {
  const d = validDigitized(paper.digitized);
  if (!d || paper.scanJob) return false;
  return d.questions.some((q) => isProblem(q) && !q.topic);
}

/** 错题还没标图谱知识点的试卷交给服务器补标，标完写回本机；每张只补一次（taggedAt），服务器开关没开时不记 */
export async function tagIfNeeded(folderId: string, paper: Paper): Promise<void> {
  if (taggingDisabled || tagging.has(paper.id) || paper.taggedAt || !needsTagging(paper)) return;
  const d = validDigitized(paper.digitized)!;
  tagging.add(paper.id);
  try {
    const res = await api<{ pages: DigitizedResult["pages"]; questions: DigitizedQuestion[]; tagged: number; enabled: boolean }>("/api/digitize/tag", { method: "POST", body: { pages: d.pages }, timeoutMs: 120000 });
    if (!res.enabled) {
      taggingDisabled = true;
      return;
    }
    updatePaper(folderId, paper.id, { digitized: { ...paper.digitized!, pages: res.pages, questions: res.questions }, taggedAt: new Date().toISOString() });
    bump();
  } catch {
    /* 下次打开再试 */
  } finally {
    tagging.delete(paper.id);
  }
}

export async function gradeIfNeeded(folderId: string, paper: Paper): Promise<void> {
  if (grading.has(paper.id) || paper.gradedAt || !needsGrading(paper)) return;
  const d = validDigitized(paper.digitized)!;
  grading.add(paper.id);
  bump();
  try {
    const res = await api<{ pages: DigitizedResult["pages"]; questions: DigitizedQuestion[] }>("/api/digitize/grade", { method: "POST", body: { pages: d.pages }, timeoutMs: 240000 });
    updatePaper(folderId, paper.id, { digitized: { ...paper.digitized!, pages: res.pages, questions: res.questions }, gradedAt: new Date().toISOString() });
  } catch {
    /* 下次打开再试 */
  } finally {
    grading.delete(paper.id);
    bump();
  }
}
