/** 学习计划：老师扫描 / 上传作业 → 转发到微信 → 学生点开自动加入 → 看作业、导出、拍照交回 → 老师看谁交了、错在哪。
 *
 * 这里放接口、文件直传、转发、以及两条后台回填：
 * - 老师布置的扫描件：直接提交识别任务（不进自己的试卷和错题榜），识别完把电子版回填到作业上；
 * - 学生交的作业：照常存进自己的试卷（走现有扫描批改，错题自动进错题榜），批改完把逐题结果回填给老师。
 * 没回填完的记在本机，重开 App 接着做。服务端见 server/app/routes/plans.py。
 */
import { create } from "zustand";
import { ApiError, api, getApiBase } from "../api/client";
import type { DigitizeJob, DigitizedQuestion, DigitizedResult, Mark, Subject } from "../api/types";
import { knowledgeOf } from "./errors";
import { addPaper, autoTargetFolder, effectiveMark, getFolder, isBlank, updatePaper, validDigitized, type FullPage } from "./folders";
import { gradeIfNeeded, needsGrading, remapParts, submitScan, useJobs, type ScanJob } from "./jobs";
import { isNative, prepareUpload } from "./native";
import { getCity } from "./prefs";
import { SUBJECT_LABEL } from "./format";

export type PlanSubject = Subject | "mixed";
export const PLAN_SUBJECT_LABEL: Record<PlanSubject, string> = { ...SUBJECT_LABEL, mixed: "综合" };
export const DEFAULT_NICKNAME = "小同学";
export const MAX_PLAN_FILE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type MyStatus = "todo" | "submitted" | "reviewed" | "returned";
export interface Score { total: number; correct: number; wrong: number; blank: number }
export interface PlanInfo {
  id: string;
  name: string;
  subject: PlanSubject;
  role: "owner" | "member";
  teacher: string;
  teacherAvatar?: string | null;
  createdAt: string;
  members?: number;
  toReview?: number;
  /** 创建人：交上来过的份数（含已批、已打回）；老服务器不带 */
  handed?: number;
  submittedToday?: number;
  /** 创建人：还有作业没交的成员数 */
  missing?: number;
  assignments?: number;
  todo?: number;
}
export interface PlanSummary { todo: number; nextDue: string | null; nextTitle: string | null; nextSubject: PlanSubject | null; toReview: number; submittedToday: number; owned: number; joined: number }
/** 首页计划列表里，没有待批 / 待交时显示的状态。
 * 刚建好的计划待批数也是 0，不能一律说「都批完了」：先看有没有作业、有没有成员、有没有人交过。
 * handed 是老服务器不带的字段，没有时按原来的说法显示。 */
export function planIdleLabel(p: PlanInfo): string {
  if ((p.assignments ?? 0) === 0) return p.role === "owner" ? "还没布置作业" : "还没有作业";
  if (p.role !== "owner") return "都交了";
  if (p.members === 0) return "还没人加入";
  if (p.handed === 0) return "还没人交";
  return "都批完了";
}
export interface AssignmentBrief { id: string; title: string; dueAt: string | null; questionCount: number; createdAt: string; revoked: boolean }
export interface OwnerAssignment extends AssignmentBrief { members: number; submitted: number; missing: number; unseen: number; toReview: number; files?: PlanFileView[] }
/** files / digitized：成员的计划页直接平铺作业文件、导出电子版用（老服务器不带，fetchPlan 里补上） */
export interface MemberAssignment extends AssignmentBrief { status: MyStatus; score: Score | null; comment: string; late: boolean; files?: PlanFileView[]; digitized?: boolean }
/** 一个成员在一份作业上的状态（创建人的计划页用） */
export interface MemberItem { assignmentId: string; status: MyStatus; submissionId: string | null; late: boolean; score: Score | null; viewed: boolean }
export type MemberState = "submitted" | "missing" | "none";
export interface PlanMemberRow { userId: string; name: string; tail: string; avatar?: string | null; joinedAt: string; submitted: number; assignments: number; status?: MemberState; toReview?: number; left?: boolean; items?: MemberItem[] }
export interface Invite { code: string; url: string }
export interface Me { name: string; defaultName: boolean; needsName?: boolean }
export interface PlanFileView { id: string; kind: "scan" | "attachment"; name: string; mime: string; size: number; url: string | null }
export interface ResultRow { n: string; m: Mark; s: string; a: string; t: string; k: string; o?: boolean }
export interface SubmissionView { id: string; status: Exclude<MyStatus, "todo">; comment: string; late: boolean; submittedAt: string; reviewedAt: string | null; score: Score | null; files: PlanFileView[]; results?: ResultRow[] | null }
export interface BoardSubmitted { submissionId: string; userId: string; name: string; tail: string; avatar?: string | null; status: "submitted" | "reviewed"; late: boolean; submittedAt: string; score: Score | null; left: boolean }
export interface BoardMissing { userId: string; name: string; tail: string; avatar?: string | null; viewed: boolean; returned: boolean }
export interface Board { members: number; submitted: BoardSubmitted[]; missing: BoardMissing[]; unseen: number; hardest: { number: string; wrong: number; knowledge: string; stem: string; graded: number }[] }
export interface AssignmentDetail extends AssignmentBrief { digitized: DigitizedResult | null; files: PlanFileView[] }

export interface PlanDetailRes { plan: PlanInfo; assignments: (OwnerAssignment | MemberAssignment)[]; members?: PlanMemberRow[]; invite?: Invite; me?: Me }
export interface AssignmentRes { plan: PlanInfo; assignment: AssignmentDetail; board?: Board; invite?: Invite; submission?: SubmissionView | null }
export interface SubmissionRes { plan: PlanInfo; assignment: AssignmentBrief | null; submission: SubmissionView; student?: { name: string; tail: string }; nav?: { index: number; total: number; prev: string | null; next: string | null } }
interface Upload { id: string; clientId: string; method: string; url: string; headers?: Record<string, string> }
interface PublishRes { plan: PlanInfo; assignment: AssignmentBrief | null; /** 一个附件一份作业，一次可能建出几份（老服务器没有这个字段） */ assignments?: AssignmentBrief[]; uploads: Upload[]; invite: Invite }

/**
 * 这个计划对我来说已经没有了：创建人解散了（服务器回 plan_dissolved），或者不存在了（404）、我已经不在里面（403）。
 * 页面上已经显示着内容时碰到它，要把内容换成提示、把人请出去，而不是当成一次没网悄悄略过。
 */
export const planGone = (e: unknown) => e instanceof ApiError && (e.code === "plan_dissolved" || e.status === 404 || e.status === 403);

/** 学习计划的数据有变化（回填完成、交了作业、从后台回到前台）就 +1，页面据此重新拉 */
export const usePlans = create<{ version: number; bump: () => void }>((set) => ({ version: 0, bump: () => set((s) => ({ version: s.version + 1 })) }));

// ---------------------------------------------------------------- 接口

export const fetchPlans = () => api<{ plans: PlanInfo[]; summary: PlanSummary }>("/api/plans");
const fetchPlanRaw = (id: string) => api<PlanDetailRes>(`/api/plans/${id}`);
/** 学习计划页。成员这边每份作业要带文件列表：还没升级的服务器不带，就逐份去作业接口取一次 */
export async function fetchPlan(id: string): Promise<PlanDetailRes> {
  const r = await fetchPlanRaw(id);
  if (r.plan.role !== "member") return r;
  const bare = (r.assignments as MemberAssignment[]).filter((a) => !a.files);
  await Promise.all(
    bare.map(async (a) => {
      try {
        const d = await fetchAssignment(a.id);
        a.files = d.assignment.files;
        a.digitized = Boolean(d.assignment.digitized);
      } catch {
        a.files = [];
      }
    }),
  );
  return r;
}
/** 这份作业现在还能不能交：没撤回、老师还没批阅（交过没批阅的可以重交，退回的要重交） */
export const canHandIn = (a: MemberAssignment) => !a.revoked && a.status !== "reviewed";
export const fetchAssignment = (id: string) => api<AssignmentRes>(`/api/plans/assignments/${id}`);
export const fetchSubmission = (id: string) => api<SubmissionRes>(`/api/plans/submissions/${id}`);
export const reviewSubmission = (id: string, body: { marks?: Record<number, Mark>; status?: "reviewed" | "returned"; comment?: string }) =>
  api<{ submission: SubmissionView }>(`/api/plans/submissions/${id}`, { method: "PATCH", body });
export const updatePlan = (id: string, body: { name?: string; subject?: PlanSubject; resetInvite?: boolean }) => api<{ plan: PlanInfo; invite: Invite }>(`/api/plans/${id}`, { method: "PATCH", body });
export const deletePlan = (id: string) => api(`/api/plans/${id}`, { method: "DELETE" });
export const removeMember = (planId: string, userId: string) => api(`/api/plans/${planId}/members/${userId}`, { method: "DELETE" });
export const revokeAssignment = (id: string) => api(`/api/plans/assignments/${id}`, { method: "DELETE" });
export const joinPlan = (code: string) => api<{ plan: PlanInfo; joined: boolean; me: Me }>("/api/plans/join", { method: "POST", body: { code } });

/** 加入页上「已经有谁加入了」：人数 + 最早加入的几个人 */
export interface JoinedPreview { count: number; list: { name: string; avatar?: string | null }[] }
/** 「小明、小红、小刚等 12 人已加入」；还没人时，对同学说「你是第一个」，对创建人说「还没有人加入」 */
export function joinedText(m: JoinedPreview, owner = false): string {
  if (!m.count) return owner ? "还没有人加入" : "还没有人加入，你是第一个";
  const names = m.list.slice(0, 3).map((x) => x.name).join("、");
  return m.count > 3 ? `${names}等 ${m.count} 人已加入` : `${names} 已加入`;
}

// ---------------------------------------------------------------- 文件直传

/** 新建 / 布置页里还没传上去的一个文件：扫描件带 src（dataURL），附件带 file */
export interface DraftFile {
  clientId: string;
  kind: "scan" | "attachment";
  name: string;
  mime: string;
  size: number;
  thumb?: string;
  page?: FullPage;
  file?: File;
}

const absolute = (url: string) => (url.startsWith("http") ? url : `${getApiBase()}${url}`);
const dataUrlToBlob = async (src: string) => (await fetch(src)).blob();
const dataUrlBytes = (src: string) => Math.floor(((src.length - src.indexOf(",") - 1) * 3) / 4);

export const scanDraft = (page: FullPage, index: number): DraftFile => ({ clientId: page.id, kind: "scan", name: `扫描件 第 ${index + 1} 页.jpg`, mime: "image/jpeg", size: dataUrlBytes(page.src), thumb: page.thumb ?? page.src, page });

const EXT_MIME: Record<string, string> = { pdf: "application/pdf", doc: "application/msword", docx: ATTACHMENT_MIMES[2], jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const MIME_EXT: Record<string, string> = { "application/pdf": "pdf", "application/msword": "doc", [ATTACHMENT_MIMES[2]]: "docx", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * 选好的一个文件 → 附件草稿。类型先看扩展名、再看系统给的 MIME：
 * 安卓的文件选择器常常不给 MIME 或给 application/octet-stream（Word 尤其常见），也有只给 MIME、文件名不带扩展名的。
 */
export function attachmentDraft(file: File): DraftFile | string {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  const mime = EXT_MIME[ext] || (ATTACHMENT_MIMES.includes(type) ? type : "");
  if (!mime || mime.startsWith("image/")) return `「${file.name}」不是 PDF 或 Word，图片请用「扫描」`;
  if (file.size > MAX_PLAN_FILE_BYTES) return `「${file.name}」超过 20 MB 了`;
  if (file.size === 0) return `「${file.name}」是空的，换一个文件`;
  const name = EXT_MIME[ext] ? file.name : `${file.name || "附件"}.${MIME_EXT[mime]}`; // 没扩展名的补上，同学那边才打得开
  return { clientId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, kind: "attachment", name, mime, size: file.size, file, thumb: mime.startsWith("image/") ? URL.createObjectURL(file) : undefined };
}

async function uploadAll(uploads: Upload[], drafts: DraftFile[], onStage?: (text: string) => void): Promise<void> {
  const byId = new Map(drafts.map((d) => [d.clientId, d]));
  let i = 0;
  for (const u of uploads) {
    i += 1;
    onStage?.(`正在上传 ${i}/${uploads.length}`);
    const d = byId.get(u.clientId);
    if (!d) continue;
    const body = d.file ?? (d.page ? await dataUrlToBlob(d.page.src) : null);
    if (!body) continue;
    const res = await fetch(absolute(u.url), { method: u.method || "PUT", body, headers: { "Content-Type": d.mime, ...(u.headers ?? {}) } });
    if (!res.ok) throw new Error(`「${d.name}」没传上去，请重试`);
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
  const body = { ...form, files: filesBody(drafts) };
  const res = await api<PublishRes>(planId ? `/api/plans/${planId}/assignments` : "/api/plans", { method: "POST", body });
  const assignment = res.assignment; // 新建计划时没带文件：只建计划，没有作业
  if (assignment) {
    try {
      await uploadAll(res.uploads, drafts, onStage);
    } catch (e) {
      // 文件没传全就不留半份作业：新建的计划整个撤掉，已有计划里撤掉这次建的几份
      await (planId ? Promise.all((res.assignments ?? [assignment]).map((a) => revokeAssignment(a.id))) : deletePlan(res.plan.id)).catch(() => undefined);
      throw e;
    }
    const scans = drafts.filter((d) => d.kind === "scan" && d.page).map((d) => d.page!);
    if (scans.length) {
      onStage?.("正在提交识别");
      await startAssignmentScan(assignment.id, scans).catch(() => undefined); // 识别失败不影响布置：学生照样能看照片
    }
  }
  usePlans.getState().bump();
  return res;
}

// ---------------------------------------------------------------- 后台回填（本机记着没做完的）

interface PendingJob { assignmentId: string; jobId: string; parts: ScanJob["parts"] }
interface PendingSub { submissionId: string; folderId: string; paperId: string }
interface Pending { jobs: PendingJob[]; subs: PendingSub[] }
const PENDING_KEY = "syk.plans.pending";

function readPending(): Pending {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") as Partial<Pending>;
    return { jobs: p.jobs ?? [], subs: p.subs ?? [] };
  } catch {
    return { jobs: [], subs: [] };
  }
}
function writePending(fn: (p: Pending) => Pending) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(fn(readPending()))); } catch { /* 存不下就算了，最多不回填 */ }
}
/** 有新的待回填项时叫醒轮询（平时没事 30 秒才问一次） */
let wake: (() => void) | null = null;

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

async function startAssignmentScan(assignmentId: string, pages: FullPage[]): Promise<void> {
  const uploads = [];
  for (let i = 0; i < pages.length; i++) uploads.push(...(await prepareUpload(pages[i].src, i)));
  const job = await api<DigitizeJob>("/api/digitize", { method: "POST", body: { pages: uploads.map((p) => ({ image: p.image })), region: await getCity() }, timeoutMs: 600000 });
  const parts = uploads.map(({ page, x0, w }) => ({ page, x0, w }));
  if (job.status === "done") return putDigitized(assignmentId, job, parts);
  if (job.status === "failed") return;
  writePending((p) => ({ ...p, jobs: [...p.jobs, { assignmentId, jobId: job.jobId, parts }] }));
  wake?.();
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
        usePlans.getState().bump();
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
        let paper = (await getFolder(s.folderId))?.papers.find((p) => p.id === s.paperId);
        if (!paper) drop = true; // 这份试卷被删了
        else if (!paper.scanJob && validDigitized(paper.digitized)) {
          // 老师没批改过的作业：先让 AI 判一遍，再把结果交上去
          if (needsGrading(paper) && !paper.gradedAt) {
            await gradeIfNeeded(s.folderId, paper);
            paper = (await getFolder(s.folderId))?.papers.find((p) => p.id === s.paperId) ?? paper;
          }
          const results = validDigitized(paper.digitized)!.questions.map(toResultRow);
          await api(`/api/plans/submissions/${s.submissionId}/results`, { method: "PUT", body: { results } });
          drop = true;
          usePlans.getState().bump();
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

/** 登录后启动：扫描任务有进展时回填学生的批改结果；老师的识别任务每几秒问一次。返回停止函数 */
export function startPlanSync(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    const left = (await pollAssignmentJobs().catch(() => 1)) + (await flushSubmissions().catch(() => 1));
    timer = setTimeout(tick, left > 0 ? 4000 : 30000);
  };
  void tick();
  wake = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, 2000);
  };
  const unsub = useJobs.subscribe(() => { void flushSubmissions(); });
  // 从后台回到前台：别人那边可能变了（老师布置了新作业、批阅了、把计划解散了），开着的首页 / 列表 / 计划页重新拉一次
  const refresh = () => usePlans.getState().bump();
  let remove: (() => void) | null = null;
  if (isNative) {
    import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) refresh(); })).then((h) => {
      if (stopped) void h.remove();
      else remove = () => void h.remove();
    }).catch(() => undefined);
  } else {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    remove = () => document.removeEventListener("visibilitychange", onVisible);
  }
  return () => {
    stopped = true;
    wake = null;
    if (timer) clearTimeout(timer);
    unsub();
    remove?.();
  };
}

// ---------------------------------------------------------------- 交作业

/**
 * 学生交作业：照片存进自己的试卷（今天的文件夹，名字用作业名），传给老师，再照常提交扫描批改。
 * 批改完的逐题结果由 startPlanSync 回填；错题照常进自己的错题榜。
 */
export async function submitHomework(assignment: AssignmentBrief, pages: FullPage[], onStage?: (text: string) => void): Promise<SubmissionView> {
  onStage?.("正在保存");
  const drafts = pages.map(scanDraft);
  const res = await api<{ submission: SubmissionView; uploads: Upload[] }>(`/api/plans/assignments/${assignment.id}/submission`, { method: "POST", body: { files: filesBody(drafts) } });
  await uploadAll(res.uploads, drafts, onStage);
  const target = await autoTargetFolder();
  const { folder, paper } = await addPaper(target?.id ?? null, pages, assignment.title);
  // 重交：旧的那份不再回填
  writePending((p) => ({ ...p, subs: [...p.subs.filter((x) => x.submissionId !== res.submission.id), { submissionId: res.submission.id, folderId: folder.id, paperId: paper.id }] }));
  onStage?.("正在提交批改");
  try {
    await submitScan(folder.id, paper.id, pages);
  } catch (e) {
    // 已经交给老师了，只是批改没提交上：记在试卷上，到「试卷」里点重新扫描就会接着回填
    await updatePaper(folder.id, paper.id, { scanError: (e as Error).message || "上传失败，请重试" }).catch(() => undefined);
    useJobs.getState().bump();
  }
  usePlans.getState().bump();
  return res.submission;
}

// ---------------------------------------------------------------- 转发 / 点开卡片

/** 转发出去的链接：App 连的是哪台服务器就用哪台的落地页 */
export function inviteUrl(invite: Invite, assignmentId?: string): string {
  const base = getApiBase();
  const q = assignmentId ? `?a=${assignmentId}` : "";
  if (/^https?:/.test(base)) return `${base}/api/plans/j/${invite.code}${q}`;
  const url = invite.url.split("?")[0] + q;
  return url.startsWith("http") ? url : `${window.location.origin}${url}`;
}

/** 拉起系统分享面板，选微信发给群或同学。用户取消返回 false */
export async function shareInvite(opts: { plan: Pick<PlanInfo, "name" | "teacher">; title?: string; invite: Invite; assignmentId?: string; remind?: boolean }): Promise<boolean> {
  const url = inviteUrl(opts.invite, opts.assignmentId);
  const head = opts.remind ? `还没交「${opts.title}」的同学记得交哦` : opts.title ? `${opts.plan.teacher}布置了「${opts.title}」` : `${opts.plan.teacher}邀请你加入「${opts.plan.name}」`;
  const text = `${head}，点开用上壹课加入「${opts.plan.name}」`;
  try {
    if (isNative) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: opts.plan.name, text, url, dialogTitle: "转发到微信" });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title: opts.plan.name, text, url });
      return true;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    return true;
  } catch (e) {
    if (/cancel|abort/i.test(String((e as Error).name + (e as Error).message))) return false;
    throw e;
  }
}

export interface JoinTarget { code: string; a?: string }
const JOIN_KEY = "syk.plans.join";

/** 从点开的链接里取邀请码：shangyike://plans/join?code=…&a=…，或落地页地址 …/api/plans/j/<code>?a=… */
export function parseJoinUrl(url: string): JoinTarget | null {
  try {
    const m = url.match(/plans\/j\/([a-z0-9]+)/i);
    const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const code = m?.[1] ?? (/plans\/join/.test(url) ? query.get("code") : null);
    if (!code) return null;
    return { code: code.toLowerCase(), a: query.get("a") || undefined };
  } catch {
    return null;
  }
}

/** 还没登录就点开了卡片：先记下，登录 / 注册完再加入 */
export function rememberJoin(target: JoinTarget | null) {
  try {
    if (target) localStorage.setItem(JOIN_KEY, JSON.stringify(target));
    else localStorage.removeItem(JOIN_KEY);
  } catch { /* ignore */ }
}
export function pendingJoin(): JoinTarget | null {
  try {
    const t = JSON.parse(localStorage.getItem(JOIN_KEY) || "null") as JoinTarget | null;
    return t?.code ? t : null;
  } catch {
    return null;
  }
}
export const joinPath = (t: JoinTarget) => `/plans/join?code=${encodeURIComponent(t.code)}${t.a ? `&a=${encodeURIComponent(t.a)}` : ""}`;

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
/** 创建时间：创建于 11月12日 21:03；不是今年的带上年份。直接取服务器给的北京时间，不受手机时区影响 */
export function createdLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso ?? "");
  if (!m) return "";
  const year = Number(m[1]) === new Date().getFullYear() ? "" : `${m[1]}年`;
  const hm = m[4] ? ` ${m[4]}:${m[5]}` : "";
  return `创建于 ${year}${Number(m[2])}月${Number(m[3])}日${hm}`;
}
/** 最新创建的排最前 */
export const byNewest = <T extends { createdAt?: string | null }>(list: T[]): T[] =>
  [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
export const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** 成员的状态：没撤回的作业都交了 = 已交，还有没交的 = 未交，一份作业都没有 = none。老服务器不带 status 时按份数算 */
export const memberState = (m: PlanMemberRow): MemberState => m.status ?? (m.assignments === 0 ? "none" : m.submitted >= m.assignments ? "submitted" : "missing");
export const memberName = (m: { name: string; tail: string }) => (m.tail ? `${m.name}（尾号 ${m.tail}）` : m.name);
export const STATUS_LABEL: Record<MyStatus, string> = { todo: "待交", submitted: "已交", reviewed: "已阅", returned: "退回重做" };
export const fileBadge = (mime: string) => (mime === "application/pdf" ? "PDF" : mime.includes("word") ? "DOC" : "图片");
