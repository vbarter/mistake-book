/** 学习计划（小程序端，和 App 的 lib/plans.ts 同一套接口和规则）：
 * 老师扫描 / 上传作业 → 用小程序卡片转发到微信 → 学生点卡片进小程序自动加入 → 看作业、导出、拍照交回 → 老师看谁交了、错在哪。
 *
 * 两条后台回填：老师布置的扫描件直接提交识别任务（不进自己的试卷和错题榜），识别完把电子版回填到作业上；
 * 学生交的作业照常存进自己的试卷（走现有扫描批改，错题进错题榜），批改完把逐题结果回填给老师。
 * 没回填完的记在本机，下次打开接着做。服务端见 server/app/routes/plans.py。
 */
import Taro from "@tarojs/taro";
import { ApiError, api } from "./api";
import { knowledgeOf } from "./errors";
import { SUBJECT_LABEL } from "./format";
import { JOBS_EVENT, bump as bumpJobs, gradeIfNeeded, needsGrading, prepareUpload, remapParts, submitScan, type ScanJob, type UploadPart } from "./jobs";
import { effectiveMark, isBlank, validDigitized } from "./logic";
import { addPaper, autoTargetFolderId, getFolder, newId, savePhoto, updatePaper, type FolderPage } from "./store";
import type { DigitizeJob, DigitizedQuestion, DigitizedResult, Mark, Subject } from "./types";

export type PlanSubject = Subject | "mixed";
export const PLAN_SUBJECT_LABEL: Record<PlanSubject, string> = { ...SUBJECT_LABEL, mixed: "综合" };
export const DEFAULT_NICKNAME = "小同学";
export const MAX_PLAN_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 30;
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
export const ATTACHMENT_EXTENSIONS = Object.keys(EXT_MIME);

export type MyStatus = "todo" | "submitted" | "reviewed" | "returned";
export interface Score { total: number; correct: number; wrong: number; blank: number }
export interface PlanInfo {
  id: string;
  name: string;
  subject: PlanSubject;
  role: "owner" | "member";
  teacher: string;
  createdAt: string;
  members?: number;
  toReview?: number;
  submittedToday?: number;
  assignments?: number;
  todo?: number;
}
export interface PlanSummary { todo: number; nextDue: string | null; nextTitle: string | null; nextSubject: PlanSubject | null; toReview: number; submittedToday: number; owned: number; joined: number }
export interface AssignmentBrief { id: string; title: string; dueAt: string | null; questionCount: number; createdAt: string; revoked: boolean }
export interface OwnerAssignment extends AssignmentBrief { members: number; submitted: number; missing: number; unseen: number; toReview: number }
export interface MemberAssignment extends AssignmentBrief { status: MyStatus; score: Score | null; comment: string; late: boolean }
export interface PlanMemberRow { userId: string; name: string; tail: string; joinedAt: string; submitted: number; assignments: number }
export interface Invite { code: string; url: string }
export interface Me { name: string; defaultName: boolean; needsName?: boolean }
export interface PlanFileView { id: string; kind: "scan" | "attachment"; name: string; mime: string; size: number; url: string | null }
export interface ResultRow { n: string; m: Mark; s: string; a: string; t: string; k: string; o?: boolean }
export interface SubmissionView { id: string; status: Exclude<MyStatus, "todo">; comment: string; late: boolean; submittedAt: string; reviewedAt: string | null; score: Score | null; files: PlanFileView[]; results?: ResultRow[] | null }
export interface BoardSubmitted { submissionId: string; userId: string; name: string; tail: string; status: "submitted" | "reviewed"; late: boolean; submittedAt: string; score: Score | null; left: boolean }
export interface BoardMissing { userId: string; name: string; tail: string; viewed: boolean; returned: boolean }
export interface Board { members: number; submitted: BoardSubmitted[]; missing: BoardMissing[]; unseen: number; hardest: { number: string; wrong: number; knowledge: string; stem: string; graded: number }[] }
export interface AssignmentDetail extends AssignmentBrief { digitized: DigitizedResult | null; files: PlanFileView[] }

export interface PlanDetailRes { plan: PlanInfo; assignments: (OwnerAssignment | MemberAssignment)[]; members?: PlanMemberRow[]; invite?: Invite; me?: Me }
export interface AssignmentRes { plan: PlanInfo; assignment: AssignmentDetail; board?: Board; invite?: Invite; submission?: SubmissionView | null }
export interface SubmissionRes { plan: PlanInfo; assignment: AssignmentBrief | null; submission: SubmissionView; student?: { name: string; tail: string }; nav?: { index: number; total: number; prev: string | null; next: string | null } }
interface Upload { id: string; clientId: string; method: string; url: string; headers?: Record<string, string> }
export interface PublishRes { plan: PlanInfo; assignment: AssignmentBrief; uploads: Upload[]; invite: Invite }

/** 学习计划的数据有变化（回填完成、交了作业、批阅了）时通知页面重新拉 */
export const PLANS_EVENT = "plans";
export const bumpPlans = () => Taro.eventCenter.trigger(PLANS_EVENT);

// ---------------------------------------------------------------- 接口（小程序的 wx.request 没有 PATCH，改用 PUT）

export const fetchPlans = () => api<{ plans: PlanInfo[]; summary: PlanSummary }>("/api/plans");
export const fetchPlan = (id: string) => api<PlanDetailRes>(`/api/plans/${id}`);
export const fetchAssignment = (id: string) => api<AssignmentRes>(`/api/plans/assignments/${id}`);
export const fetchSubmission = (id: string) => api<SubmissionRes>(`/api/plans/submissions/${id}`);
export const reviewSubmission = (id: string, body: { marks?: Record<number, Mark>; status?: "reviewed" | "returned"; comment?: string }) =>
  api<{ submission: SubmissionView }>(`/api/plans/submissions/${id}`, { method: "PUT", body });
export const updatePlan = (id: string, body: { name?: string; subject?: PlanSubject; resetInvite?: boolean }) => api<{ plan: PlanInfo; invite: Invite }>(`/api/plans/${id}`, { method: "PUT", body });
export const deletePlan = (id: string) => api(`/api/plans/${id}`, { method: "DELETE" });
export const removeMember = (planId: string, userId: string) => api(`/api/plans/${planId}/members/${userId}`, { method: "DELETE" });
export const revokeAssignment = (id: string) => api(`/api/plans/assignments/${id}`, { method: "DELETE" });
export const joinPlan = (code: string) => api<{ plan: PlanInfo; joined: boolean; me: Me }>("/api/plans/join", { method: "POST", body: { code } });

// ---------------------------------------------------------------- 文件直传

/** 新建 / 布置页里还没传上去的一个文件：path 是本机文件；扫描件另带尺寸（提交识别时切图用） */
export interface DraftFile {
  clientId: string;
  kind: "scan" | "attachment";
  name: string;
  mime: string;
  size: number;
  path: string;
  width?: number;
  height?: number;
}

export const absoluteUrl = (url: string) => (url.startsWith("/") ? `${API_BASE}${url}` : url);

function fileSize(path: string): number {
  try {
    return (Taro.getFileSystemManager().statSync(path) as unknown as { size: number }).size || 0;
  } catch {
    return 0;
  }
}

/** 刚拍 / 刚选的一张照片 → 扫描件草稿 */
export async function scanDraft(path: string, index: number): Promise<DraftFile> {
  const info = await Taro.getImageInfo({ src: path });
  return { clientId: newId(), kind: "scan", name: `扫描件 第 ${index + 1} 页.jpg`, mime: "image/jpeg", size: fileSize(path), path, width: info.width, height: info.height };
}

/** 从微信聊天记录里选的一个文件 → 附件草稿；不支持的类型、太大的返回一句原因 */
export function attachmentDraft(file: { path: string; name: string; size: number }): DraftFile | string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_MIME[ext];
  if (!mime) return `「${file.name}」不是 PDF、Word 或图片`;
  if (file.size > MAX_PLAN_FILE_BYTES) return `「${file.name}」超过 20 MB 了`;
  return { clientId: newId(), kind: "attachment", name: file.name, mime, size: file.size, path: file.path };
}

async function uploadAll(uploads: Upload[], drafts: DraftFile[], onStage?: (text: string) => void): Promise<void> {
  const byId = new Map(drafts.map((d) => [d.clientId, d]));
  const fs = Taro.getFileSystemManager();
  let i = 0;
  for (const u of uploads) {
    i += 1;
    onStage?.(`正在上传 ${i}/${uploads.length}`);
    const d = byId.get(u.clientId);
    if (!d) continue;
    const data = fs.readFileSync(d.path) as ArrayBuffer;
    let status = 0;
    try {
      status = (await Taro.request({ url: absoluteUrl(u.url), method: "PUT", data, header: { "Content-Type": d.mime, ...(u.headers ?? {}) }, timeout: 300000 })).statusCode;
    } catch {
      status = 0;
    }
    if (status < 200 || status >= 300) throw new Error(`「${d.name}」没传上去，请重试`);
  }
  const done = await api<{ done: string[]; missing: string[] }>("/api/plans/files/uploaded", { method: "POST", body: { ids: uploads.map((u) => u.id) } });
  if (done.missing.length) throw new Error("有文件没传上去，请重试");
}

const filesBody = (drafts: DraftFile[]) => drafts.map(({ clientId, kind, name, mime, size }) => ({ clientId, kind, name, mime, size }));

/**
 * 确定布置：planId 为空 = 新建学习计划并布置第一份作业；否则在已有计划里布置一份。
 * 文件传完后，扫描件在后台识别成电子版（学生那边先看到照片，识别完自动换成电子版）。
 */
export async function publishAssignment(planId: string | null, form: { name?: string; subject?: PlanSubject; dueAt: string | null; title?: string }, drafts: DraftFile[], onStage?: (text: string) => void): Promise<PublishRes> {
  onStage?.("正在创建");
  const res = await api<PublishRes>(planId ? `/api/plans/${planId}/assignments` : "/api/plans", { method: "POST", body: { ...form, files: filesBody(drafts) } });
  try {
    await uploadAll(res.uploads, drafts, onStage);
  } catch (e) {
    // 文件没传全就不留半份作业：新建的计划整个撤掉，已有计划里只撤这份
    await (planId ? revokeAssignment(res.assignment.id) : deletePlan(res.plan.id)).catch(() => undefined);
    throw e;
  }
  const scans = drafts.filter((d) => d.kind === "scan" && d.width && d.height);
  if (scans.length) {
    onStage?.("正在提交识别");
    await startAssignmentScan(res.assignment.id, scans).catch(() => undefined); // 识别失败不影响布置：学生照样能看照片
  }
  bumpPlans();
  return res;
}

// ---------------------------------------------------------------- 后台回填（本机记着没做完的）

interface PendingJob { assignmentId: string; jobId: string; parts: ScanJob["parts"] }
interface PendingSub { submissionId: string; folderId: string; paperId: string }
interface Pending { jobs: PendingJob[]; subs: PendingSub[] }
const PENDING_KEY = "syk.plans.pending";

function readPending(): Pending {
  try {
    const p = (Taro.getStorageSync(PENDING_KEY) || {}) as Partial<Pending>;
    return { jobs: p.jobs ?? [], subs: p.subs ?? [] };
  } catch {
    return { jobs: [], subs: [] };
  }
}
function writePending(fn: (p: Pending) => Pending) {
  try {
    Taro.setStorageSync(PENDING_KEY, fn(readPending()));
  } catch {
    /* 存不下就算了，最多不回填 */
  }
}

/** 这次提交的批改结果还没回填给老师（界面上显示「批改中」） */
export const isSubmissionPending = (submissionId: string) => readPending().subs.some((s) => s.submissionId === submissionId);
export const isAssignmentScanning = (assignmentId: string) => readPending().jobs.some((j) => j.assignmentId === assignmentId);

/** 请求被服务器明确拒绝（作业撤回了、已批阅、没权限）：不用再试 */
const isFinal = (e: unknown) => e instanceof ApiError && [400, 403, 404, 409, 413].includes(e.status);

async function putDigitized(assignmentId: string, job: DigitizeJob, parts: ScanJob["parts"]): Promise<void> {
  if (!job.result) return;
  const digitized: DigitizedResult = { ...remapParts(job.result, parts), provider: job.result.provider, at: job.updatedAt || new Date().toISOString() };
  await api(`/api/plans/assignments/${assignmentId}/digitized`, { method: "PUT", body: { digitized } });
}

async function startAssignmentScan(assignmentId: string, scans: DraftFile[]): Promise<void> {
  const uploads: UploadPart[] = [];
  for (let i = 0; i < scans.length; i++) uploads.push(...(await prepareUpload({ src: scans[i].path, width: scans[i].width!, height: scans[i].height! }, i)));
  let region = "";
  try {
    region = Taro.getStorageSync("zcb.city") || "";
  } catch {
    /* ignore */
  }
  const job = await api<DigitizeJob>("/api/digitize", { method: "POST", body: { pages: uploads.map((p) => ({ image: p.image })), region }, timeoutMs: 600000 });
  const parts = uploads.map(({ page, x0, w }) => ({ page, x0, w }));
  if (job.status === "done") return putDigitized(assignmentId, job, parts);
  if (job.status === "failed") return;
  writePending((p) => ({ ...p, jobs: [...p.jobs, { assignmentId, jobId: job.jobId, parts }] }));
  wake();
}

async function pollAssignmentJobs(): Promise<number> {
  let left = 0;
  for (const j of readPending().jobs) {
    let drop = false;
    try {
      const job = await api<DigitizeJob>(`/api/digitize/jobs/${j.jobId}`, { timeoutMs: 15000 });
      if (job.status === "done") {
        await putDigitized(j.assignmentId, job, j.parts);
        drop = true;
        bumpPlans();
      } else if (job.status === "failed") drop = true;
    } catch (e) {
      drop = isFinal(e);
    }
    if (drop) writePending((p) => ({ ...p, jobs: p.jobs.filter((x) => x.jobId !== j.jobId) }));
    else left += 1;
  }
  return left;
}

/** 试卷里的一道题 → 回填给老师的一行 */
export function toResultRow(q: DigitizedQuestion): ResultRow {
  const m: Mark = isBlank(q) ? "blank" : effectiveMark(q);
  return { n: q.number || String(q.index + 1), m, s: q.studentAnswer.slice(0, 300), a: q.correctAnswer.slice(0, 300), t: q.stemText.replace(/\s+/g, " ").slice(0, 120), k: knowledgeOf(q).slice(0, 40) };
}

let flushing = false;
async function flushSubmissions(): Promise<number> {
  if (flushing) return readPending().subs.length;
  flushing = true;
  let left = 0;
  try {
    for (const s of readPending().subs) {
      let drop = false;
      try {
        let paper = getFolder(s.folderId)?.papers.find((p) => p.id === s.paperId);
        if (!paper) drop = true; // 这份试卷被删了
        else if (!paper.scanJob && validDigitized(paper.digitized)) {
          // 老师没批改过的作业：先让 AI 判一遍，再把结果交上去
          if (needsGrading(paper) && !paper.gradedAt) {
            await gradeIfNeeded(s.folderId, paper);
            paper = getFolder(s.folderId)?.papers.find((p) => p.id === s.paperId) ?? paper;
          }
          const results = validDigitized(paper.digitized)!.questions.map(toResultRow);
          await api(`/api/plans/submissions/${s.submissionId}/results`, { method: "PUT", body: { results } });
          drop = true;
          bumpPlans();
        }
      } catch (e) {
        drop = isFinal(e);
      }
      if (drop) writePending((p) => ({ ...p, subs: p.subs.filter((x) => x.submissionId !== s.submissionId) }));
      else left += 1;
    }
  } finally {
    flushing = false;
  }
  return left;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const onJobs = () => void flushSubmissions();

async function tick() {
  if (!running) return;
  const left = (await pollAssignmentJobs().catch(() => 1)) + (await flushSubmissions().catch(() => 1));
  if (running) timer = setTimeout(tick, left > 0 ? 4000 : 30000);
}
/** 有新的待回填项时叫醒轮询（平时没事 30 秒才问一次） */
function wake() {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, 2000);
}

/** 小程序在前台且已登录时跑：扫描任务有进展就回填学生的批改结果；老师的识别任务每几秒问一次 */
export function startPlanSync() {
  if (running) return;
  running = true;
  Taro.eventCenter.on(JOBS_EVENT, onJobs);
  void tick();
}
export function stopPlanSync() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  Taro.eventCenter.off(JOBS_EVENT, onJobs);
}

// ---------------------------------------------------------------- 交作业

/**
 * 学生交作业：照片存进自己的试卷（今天的文件夹，名字用作业名），传给老师，再照常提交扫描批改。
 * 批改完的逐题结果由 startPlanSync 回填；错题照常进自己的错题榜。
 */
export async function submitHomework(assignment: AssignmentBrief, paths: string[], onStage?: (text: string) => void): Promise<SubmissionView> {
  onStage?.("正在保存");
  const pages: FolderPage[] = [];
  for (const p of paths) pages.push(await savePhoto(p));
  const drafts: DraftFile[] = pages.map((pg, i) => ({ clientId: pg.id, kind: "scan", name: `第 ${i + 1} 页.jpg`, mime: "image/jpeg", size: fileSize(pg.src), path: pg.src, width: pg.width, height: pg.height }));
  const res = await api<{ submission: SubmissionView; uploads: Upload[] }>(`/api/plans/assignments/${assignment.id}/submission`, { method: "POST", body: { files: filesBody(drafts) } });
  await uploadAll(res.uploads, drafts, onStage);
  const { folder, paper } = addPaper(autoTargetFolderId(), pages, assignment.title);
  // 重交：旧的那份不再回填
  writePending((p) => ({ ...p, subs: [...p.subs.filter((x) => x.submissionId !== res.submission.id), { submissionId: res.submission.id, folderId: folder.id, paperId: paper.id }] }));
  bumpJobs();
  onStage?.("正在提交批改");
  try {
    await submitScan(folder.id, paper.id, pages);
  } catch (e) {
    // 已经交给老师了，只是批改没提交上：记在试卷上，到「试卷」里点重新扫描就会接着回填
    updatePaper(folder.id, paper.id, { scanError: (e as Error).message || "上传失败，请重试" });
    bumpJobs();
  }
  wake();
  bumpPlans();
  return res.submission;
}

// ---------------------------------------------------------------- 转发卡片 / 点卡片进来

export const JOIN_PAGE = "/pages/plan-join/index";
export const joinPath = (code: string, assignmentId?: string) => `${JOIN_PAGE}?code=${encodeURIComponent(code)}${assignmentId ? `&a=${encodeURIComponent(assignmentId)}` : ""}`;

export interface ShareInfo { plan: Pick<PlanInfo, "name" | "teacher" | "subject">; invite: Invite; title?: string; assignmentId?: string; remind?: boolean }

type CoverCanvas = {
  getContext: (t: "2d") => { fillStyle: string; font: string; textBaseline: string; fillRect: (...a: number[]) => void; fillText: (t: string, x: number, y: number) => void; beginPath: () => void; arc: (...a: number[]) => void; fill: () => void };
  toDataURL: (type: string, q?: number) => string;
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const covers = new Map<string, string>();
/** 画不出封面（基础库太旧等）时用包里这张通用的，一定不让微信截当前页面 */
const FALLBACK_COVER = "/assets/plan-cover.png";

/**
 * 转发卡片的封面：画一张只有计划名、作业名、学科的图。
 * 不传封面的话微信会用当前页面的截图，老师的作业情况页上有同学的名字，不能发到群里。
 */
export function shareCover(info: ShareInfo): string | undefined {
  const key = [info.plan.name, info.title ?? "", info.plan.subject].join("|");
  if (covers.has(key)) return covers.get(key);
  try {
    const W = 500;
    const H = 400;
    const canvas = Taro.createOffscreenCanvas({ type: "2d", width: W, height: H }) as unknown as CoverCanvas;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.fillStyle = "#1f3b73";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(W - 40, 30, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "24px sans-serif";
    ctx.fillText(`学习计划 · ${PLAN_SUBJECT_LABEL[info.plan.subject] ?? "综合"}`, 36, 40);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(clip(info.plan.name, 10), 36, 92);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(36, 180, W - 72, 128);
    ctx.fillStyle = "#5b5b63";
    ctx.font = "22px sans-serif";
    ctx.fillText(info.title ? "作业" : "老师", 60, 202);
    ctx.fillStyle = "#1c1c1e";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText(clip(info.title || info.plan.teacher, 12), 60, 242);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "26px sans-serif";
    ctx.fillText("点开卡片，自动加入 ›", 36, 336);
    const b64 = canvas.toDataURL("image/png").split(",")[1];
    if (!b64) return undefined;
    const path = `${Taro.env.USER_DATA_PATH}/plan_cover_${Date.now().toString(36)}.png`;
    Taro.getFileSystemManager().writeFileSync(path, b64, "base64");
    covers.set(key, path);
    return path;
  } catch {
    return undefined;
  }
}

/** onShareAppMessage 的返回值：卡片标题 + 落到加入页 + 自己画的封面 */
export function sharePayload(info: ShareInfo): { title: string; path: string; imageUrl: string } {
  const title = info.remind ? `还没交「${info.title}」的同学记得交哦` : info.title ? `${info.plan.teacher}布置了「${info.title}」，点开加入「${info.plan.name}」` : `${info.plan.teacher}邀请你加入「${info.plan.name}」`;
  return { title, path: joinPath(info.invite.code, info.assignmentId), imageUrl: shareCover(info) ?? FALLBACK_COVER };
}

// ---------------------------------------------------------------- 附件

/** 打开作业里的一个文件：图片用预览（可长按保存、转发），PDF / Word 下载后用微信自带的文档预览打开（右上角可转发、打印） */
export async function openPlanFile(f: PlanFileView, siblings: PlanFileView[] = []): Promise<void> {
  if (!f.url) {
    void Taro.showToast({ title: "文件还在上传，稍后再试", icon: "none" });
    return;
  }
  if (f.mime.startsWith("image/")) {
    const urls = siblings.filter((x) => x.url && x.mime.startsWith("image/")).map((x) => absoluteUrl(x.url!));
    void Taro.previewImage({ current: absoluteUrl(f.url), urls: urls.length ? urls : [absoluteUrl(f.url)] });
    return;
  }
  Taro.showLoading({ title: "打开中…", mask: true });
  try {
    const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "application/msword" ? "doc" : "docx";
    const dest = `${Taro.env.USER_DATA_PATH}/plan_${f.id}.${ext}`;
    const r = await Taro.downloadFile({ url: absoluteUrl(f.url), filePath: dest } as Taro.downloadFile.Option);
    if (r.statusCode !== 200) throw new Error("下载失败，请稍后再试");
    Taro.hideLoading();
    await Taro.openDocument({ filePath: dest, fileType: ext as "pdf", showMenu: true });
  } catch (e) {
    Taro.hideLoading();
    const msg = String((e as { errMsg?: string }).errMsg || (e as Error).message || "");
    if (!/cancel/i.test(msg)) void Taro.showModal({ title: "打不开这个文件", content: /domain|合法域名/.test(msg) ? "文件所在的域名还没加到小程序后台的 downloadFile 合法域名" : msg || "请稍后再试", showCancel: false });
  }
}

// ---------------------------------------------------------------- 显示用

/** 截止时间：今天 20:00 / 明天 20:00 / 11月12日 20:00 */
export function dueLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const date = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${hm}`;
}
export const isOverdue = (iso: string | null | undefined) => Boolean(iso) && new Date(iso!).getTime() < Date.now();
export const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const memberName = (m: { name: string; tail: string }) => (m.tail ? `${m.name}（尾号 ${m.tail}）` : m.name);
export const STATUS_LABEL: Record<MyStatus, string> = { todo: "待交", submitted: "已交", reviewed: "已阅", returned: "退回重做" };
export const fileBadge = (mime: string) => (mime === "application/pdf" ? "PDF" : mime.includes("word") ? "DOC" : "图片");
