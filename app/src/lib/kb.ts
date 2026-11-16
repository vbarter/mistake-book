import { api, ApiError, getApiBase } from "../api/client";

/**
 * 试卷知识库（另一个服务）的接口封装，智能聊天「问小壹」用。
 *
 * 鉴权：先向主站要一张短期票（POST /api/kb/token，服务端用单独的密钥签，约 1 小时有效），再拿它直接调知识库。
 * 主站没开通知识库时那个接口返回 503，App 就不显示对话入口。
 *
 * 用到的知识库接口：
 *   POST /v1/personal/papers           上传一份试卷（一次一个文件）→ 后台识别、切题、入库
 *   GET  /v1/tasks/{id}                处理进度
 *   POST /v1/{personal,system}/answers/stream   问答（SSE：citations → delta… → done / error）
 *   POST /v1/{personal,system}/search  检索题目
 *   GET  /v1/{personal,system}/questions/{id}   题目详情（老版本的引用里不带题干时才用）
 */

export class KbError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Session { token: string; base: string; exp: number }
let session: Session | null = null;
let pending: Promise<Session> | null = null;

/** 换账号 / 退出登录：丢掉上一位的票 */
export function resetKbSession() {
  session = null;
  pending = null;
}

async function getSession(force = false): Promise<Session> {
  if (!force && session && session.exp - Date.now() > 60000) return session;
  if (!pending) {
    pending = api<{ token: string; expiresIn: number; base: string }>("/api/kb/token", { method: "POST", timeoutMs: 15000 })
      .then((r) => {
        // 相对地址（/kb）跟着主站走：网页开发时经 Vite 代理，线上就是主站域名下的一个路径
        const base = r.base.startsWith("/") ? `${getApiBase()}${r.base}` : r.base;
        session = { token: r.token, base, exp: Date.now() + r.expiresIn * 1000 };
        return session;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** 这个账号能不能用智能聊天：true 能用；false 服务端没开通；null 这会儿问不到（没网等），过会儿再问 */
export async function kbAvailable(): Promise<boolean | null> {
  try {
    await getSession();
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 503 || e.status === 404)) return false;
    return null;
  }
}

async function kbFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  let s: Session;
  try {
    s = await getSession();
  } catch (e) {
    if (e instanceof ApiError) throw new KbError(e.status, e.code, e.status === 503 ? "智能问答暂时用不了" : e.message);
    throw e;
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${s.token}`);
  // 经 ngrok 免费隧道时不加这个头会先收到一张提示网页
  if (/ngrok/.test(s.base)) headers.set("ngrok-skip-browser-warning", "1");
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, { ...init, headers });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new KbError(0, "offline", "连不上小壹，请检查网络后再试");
  }
  if (res.status === 401 && retry) {
    await getSession(true);
    return kbFetch(path, init, false);
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
    try { body = await res.json(); } catch { /* 不是 JSON（网关的错误页） */ }
    const code = body.error?.code || (res.status === 429 ? "rate_limited" : "error");
    const message = body.error?.message && /[一-龥]/.test(body.error.message) ? body.error.message
      : res.status === 429 ? "问得太快了，歇一会儿再来" : res.status === 413 ? "文件太大了" : res.status >= 500 ? "小壹开小差了，请稍后再试" : "请求失败";
    throw new KbError(res.status, code, message, body.error?.details ?? {});
  }
  return res;
}

// ---------------------------------------------------------------- 上传与进度

export interface KbTask {
  task_id: string;
  paper_id: string;
  stage: string; // uploaded → extracting → ocr → structuring → indexing → ready
  state: string; // queued / running / succeeded / needs_review / failed / cancelled
  progress: number; // 0–1
  error_code?: string | null;
  detail?: { pages?: unknown[]; needs_review?: boolean; integrity?: unknown };
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const UPLOAD_EXTS = ["pdf", "docx", "txt", "jpg", "jpeg", "png", "webp"];

export type UploadResult = { paperId: string; task: KbTask } | { duplicateOf: string };

/** 上传一份试卷。同一个文件传过了返回 duplicateOf（已有那份的 id） */
export async function uploadPaper(file: Blob, filename: string, opts: { title?: string; idemKey: string; signal?: AbortSignal }): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, filename);
  if (opts.title) form.append("title", opts.title.slice(0, 280));
  try {
    const res = await kbFetch("/v1/personal/papers", { method: "POST", body: form, headers: { "Idempotency-Key": opts.idemKey }, signal: opts.signal });
    const data = (await res.json()) as { paper_id: string; task: KbTask };
    return { paperId: data.paper_id, task: data.task };
  } catch (e) {
    if (e instanceof KbError && e.code === "duplicate_file" && typeof e.details.paper_id === "string") return { duplicateOf: e.details.paper_id };
    throw e;
  }
}

export async function getTask(id: string): Promise<KbTask> {
  return (await (await kbFetch(`/v1/tasks/${encodeURIComponent(id)}`)).json()) as KbTask;
}

export const taskDone = (t: KbTask) => t.state === "succeeded" || t.state === "needs_review";
export const taskFailed = (t: KbTask) => t.state === "failed" || t.state === "cancelled";

// ---------------------------------------------------------------- 问答与检索

export interface KbCitation {
  ref: number;
  kb: "personal" | "system";
  questionId: string;
  paperId: string;
  paperTitle: string;
  number: string;
  content?: string;
  options?: { label?: string; text?: string }[];
  /** 这一条是整份试卷（找试卷时）：questionId 是 paper:<试卷 id>，content 是里面相关的几道题 */
  isPaper?: boolean;
}

interface RawItem { ref?: number; kb?: string; scope?: string; question_id: string; paper_id: string; paper_title: string; question_number: string; content?: string; options?: unknown }

function toCitation(raw: RawItem, i: number, kb?: "personal" | "system"): KbCitation {
  const options = Array.isArray(raw.options)
    ? (raw.options as Record<string, unknown>[]).map((o) => ({ label: String(o.label ?? o.key ?? ""), text: String(o.text ?? o.content ?? "") })).filter((o) => o.text)
    : undefined;
  return {
    ref: raw.ref ?? i + 1,
    kb: kb ?? (raw.kb === "system" ? "system" : "personal"),
    questionId: raw.question_id,
    paperId: raw.paper_id,
    paperTitle: raw.paper_title || "未命名试卷",
    number: String(raw.question_number ?? ""),
    content: raw.content || undefined,
    options: options?.length ? options : undefined,
  };
}

export interface Turn { role: "user" | "assistant"; content: string }
export interface AskScope { mine: boolean; system: boolean; paperIds?: string[] }

/** 知识库是老版本（不认 history / paper_ids，多带字段会 422）时记下来，之后把追问拼进问题里发 */
let legacy = false;

function answerBody(question: string, history: Turn[], scope: AskScope, useNew: boolean) {
  const body: Record<string, unknown> = { question: question.slice(0, 2000) };
  if (useNew) {
    if (history.length) body.history = history.slice(-8).map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
    if (scope.paperIds?.length) body.filters = { paper_ids: scope.paperIds.slice(0, 20) };
  } else {
    const prev = [...history].reverse().find((t) => t.role === "user");
    if (prev) body.question = `（接着上一个问题「${prev.content.slice(0, 300)}」）${question}`.slice(0, 2000);
  }
  return body;
}

export interface AnswerHandlers {
  onCitations: (list: KbCitation[]) => void;
  onDelta: (text: string) => void;
}
export type AnswerEnd = { status: "ok" } | { status: "not_found"; message: string } | { status: "error"; message: string };

/**
 * 问一个问题，边生成边回调。只问某几份试卷（paperIds）时只查自己的库；
 * 否则「我的 + 题库」走个人问答并带上系统库，只开题库走系统问答。
 */
export async function askStream(question: string, history: Turn[], scope: AskScope, handlers: AnswerHandlers, signal: AbortSignal): Promise<AnswerEnd> {
  const focused = !!scope.paperIds?.length;
  const path = !focused && !scope.mine ? "/v1/system/answers/stream" : "/v1/personal/answers/stream";
  const post = (useNew: boolean) => {
    const body = answerBody(question, history, scope, useNew);
    if (path.includes("personal")) body.include_system = focused ? false : scope.system;
    return kbFetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  };
  let res: Response;
  try {
    res = await post(!legacy);
  } catch (e) {
    if (!(e instanceof KbError) || e.status !== 422 || legacy) throw e;
    legacy = true;
    res = await post(false);
  }
  if (!res.body) throw new KbError(0, "no_stream", "这台设备收不了流式回答");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let end: AnswerEnd | null = null;
  const handle = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(data.join("\n")); } catch { return; }
    if (event === "citations") handlers.onCitations(((payload.citations as RawItem[]) ?? []).map((c, i) => toCitation(c, i)));
    else if (event === "delta") handlers.onDelta(String(payload.text ?? ""));
    else if (event === "done") end = payload.status === "not_found" ? { status: "not_found", message: String(payload.message || "没有找到相关的内容") } : { status: "ok" };
    else if (event === "error") end = { status: "error", message: String(payload.message || "小壹开小差了，请稍后再试") };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  // 流断了但没收到结束事件：当成没说完
  return end ?? { status: "error", message: "回答中断了" };
}

/** 说了「试卷 / 卷子」又没提「题」：要的是整份试卷，按试卷返回 */
export const wantsPaper = (q: string) => /试卷|卷子|考卷|[份套张].{0,8}卷/.test(q) && !/题/.test(q);

/** 知识库从问题里认出来的标签（学科、年级、地区、考试类型）→ 检索的筛选字段。认出来了就当硬条件再找一遍，不然「初三数学」只是几个字，别的学科也会混进来 */
const SUGGEST_FIELDS: Record<string, string> = { subject: "subject_tag_ids", grade: "grade_tag_ids", source_region: "region_tag_ids", exam_type: "exam_type_tag_ids" };
interface RawPaperHit { paper_id: string; paper_title: string; matched_question_count?: number; matched_questions?: { question_number?: string; snippet?: string }[] }
type RawHit = (RawItem | RawPaperHit) & { score?: number };
interface SearchResp { items?: RawHit[]; interpreted_filters?: { suggested?: Record<string, { id?: string }[]> } }

async function searchPost(path: string, body: Record<string, unknown>): Promise<SearchResp> {
  const res = await kbFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as SearchResp;
}

function suggestedFilters(data: SearchResp): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [type, field] of Object.entries(SUGGEST_FIELDS)) {
    const ids = (data.interpreted_filters?.suggested?.[type] ?? []).map((t) => t.id).filter((id): id is string => !!id);
    if (ids.length) out[field] = ids;
  }
  return Object.keys(out).length ? out : null;
}

function paperCitation(raw: RawPaperHit, i: number, kb: "personal" | "system"): KbCitation {
  const lines = (raw.matched_questions ?? []).map((q) => `第 ${q.question_number ?? "?"} 题　${(q.snippet ?? "").replace(/\s+/g, " ").trim()}`);
  const n = raw.matched_question_count ?? lines.length;
  return {
    ref: i + 1,
    kb,
    questionId: `paper:${raw.paper_id}`,
    paperId: raw.paper_id,
    paperTitle: raw.paper_title || "未命名试卷",
    number: "",
    content: lines.length ? lines.join("\n") : `这份试卷里有 ${n} 道相关的题`,
    isPaper: true,
  };
}

/**
 * 找题 / 找试卷。mine / system 都开时两边各找一遍，按相关度合并。
 * 每个库先按原话找一遍；知识库认出学科、年级这些标签时，带上它们当筛选条件再找一遍，以第二遍为准。
 * 个人库里没打这类标签的试卷照样算（include_unclassified）；系统题库都打过标签，不放宽。
 */
export async function searchQuestions(query: string, scope: AskScope, topK = 6): Promise<KbCitation[]> {
  const focused = !!scope.paperIds?.length;
  const paper = !focused && wantsPaper(query);
  const run = async (kb: "personal" | "system") => {
    const body: Record<string, unknown> = { query, mode: "related", top_k: topK };
    if (paper) body.target = "paper";
    if (focused && !legacy) body.filters = { paper_ids: scope.paperIds };
    let data = await searchPost(`/v1/${kb}/search`, body);
    const extra = focused ? null : suggestedFilters(data);
    if (extra) {
      try {
        data = await searchPost(`/v1/${kb}/search`, { ...body, filters: kb === "personal" ? { ...extra, include_unclassified: true } : extra });
      } catch {
        // 带条件的这一遍没成（条件组合太多、老版本不认）：用第一遍的结果
      }
    }
    return (data.items ?? []).map((it) => ({ it, kb }));
  };
  const targets: ("personal" | "system")[] = focused ? ["personal"] : [...(scope.mine ? ["personal" as const] : []), ...(scope.system ? ["system" as const] : [])];
  const results = await Promise.allSettled(targets.map(run));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!ok.length) {
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;
  }
  ok.sort((a, b) => (b.it.score ?? 0) - (a.it.score ?? 0));
  return ok.slice(0, topK).map(({ it, kb }, i) => (paper ? paperCitation(it as RawPaperHit, i, kb) : toCitation({ ...(it as RawItem), ref: i + 1 }, i, kb)));
}

/** 一份试卷拆出了几道题。老版本知识库不支持按试卷筛选，返回 null */
export async function countQuestions(paperId: string): Promise<number | null> {
  if (legacy) return null;
  try {
    const res = await kbFetch("/v1/personal/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: { paper_ids: [paperId] }, top_k: 1 }) });
    const data = (await res.json()) as { total?: number };
    return typeof data.total === "number" ? data.total : null;
  } catch (e) {
    if (e instanceof KbError && e.status === 422) legacy = true;
    return null;
  }
}

/** 题干全文（引用里没带题干时用） */
export async function fetchQuestion(kb: "personal" | "system", id: string): Promise<{ content: string; options?: { label?: string; text?: string }[] } | null> {
  try {
    const res = await kbFetch(`/v1/${kb}/questions/${encodeURIComponent(id)}`);
    const raw = (await res.json()) as RawItem;
    const c = toCitation(raw, 0, kb);
    return c.content ? { content: c.content, options: c.options } : null;
  } catch {
    return null;
  }
}
