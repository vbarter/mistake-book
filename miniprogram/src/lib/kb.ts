/**
 * 试卷知识库（另一个服务）的接口封装，智能聊天「问小壹」用。和 App 的 app/src/lib/kb.ts 是同一套接口，只是换成小程序的网络调用。
 *
 * 鉴权：先向主站要一张短期票（POST /api/kb/token，约 1 小时有效），再拿它直接调知识库。
 * 主站没开通知识库时那个接口返回 503，小程序就不显示对话入口。
 * 知识库的域名要加进小程序后台的 request 合法域名和 uploadFile 合法域名。
 *
 * 用到的知识库接口：
 *   POST /v1/personal/papers           上传一份试卷（一次一个文件，wx.uploadFile）→ 后台识别、切题、入库
 *   GET  /v1/tasks/{id}                处理进度
 *   POST /v1/{personal,system}/answers/stream   问答（SSE：citations → delta… → done / error；wx.request 的 enableChunked 分块接收）
 *   POST /v1/{personal,system}/search  检索题目
 *   GET  /v1/{personal,system}/questions/{id}   题目详情（引用里不带题干时才用）
 */
import Taro from "@tarojs/taro";
import { api, ApiError } from "./api";

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

/** 用户点了「停止」 */
export class KbAbort extends Error {}

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
    pending = api<{ token: string; expiresIn: number; base: string }>("/api/kb/token", { method: "POST", body: {}, timeoutMs: 15000 })
      .then((r) => {
        // 相对地址（/kb）跟着主站域名走
        const base = r.base.startsWith("/") ? `${API_BASE}${r.base}` : r.base;
        session = { token: r.token, base, exp: Date.now() + r.expiresIn * 1000 };
        return session;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** 这个账号能不能用智能聊天：true 能用；false 服务端没开通；null 这会儿问不到（没网、没登录等），过会儿再问 */
export async function kbAvailable(): Promise<boolean | null> {
  try {
    await getSession();
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 503 || e.status === 404)) return false;
    return null;
  }
}

async function sessionOrThrow(force = false): Promise<Session> {
  try {
    return await getSession(force);
  } catch (e) {
    if (e instanceof ApiError) throw new KbError(e.status, e.code, e.status === 503 ? "智能问答暂时用不了" : e.message);
    throw e;
  }
}

function authHeader(s: Session, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${s.token}`, ...extra };
  // 经 ngrok 免费隧道时不加这个头会先收到一张提示网页
  if (/ngrok/.test(s.base)) h["ngrok-skip-browser-warning"] = "1";
  return h;
}

function netError(e: unknown): KbError {
  const msg = String((e as { errMsg?: string })?.errMsg || (e as Error)?.message || "");
  if (/domain|合法域名/i.test(msg)) return new KbError(0, "domain", "小壹的服务器域名还没加到小程序后台的合法域名");
  if (/timeout/i.test(msg)) return new KbError(0, "timeout", "小壹半天没回应，请稍后再试");
  return new KbError(0, "offline", "连不上小壹，请检查网络后再试");
}

type ErrBody = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function httpError(status: number, data: unknown): KbError {
  let body: ErrBody = {};
  if (data && typeof data === "object") body = data as ErrBody;
  else if (typeof data === "string") {
    try { body = JSON.parse(data) as ErrBody; } catch { /* 不是 JSON（网关的错误页） */ }
  }
  const err = body.error && typeof body.error === "object" ? body.error : {};
  const code = err.code || (status === 429 ? "rate_limited" : "error");
  const message = err.message && /[一-龥]/.test(err.message) ? err.message
    : status === 429 ? "问得太快了，歇一会儿再来" : status === 413 ? "文件太大了" : status >= 500 ? "小壹开小差了，请稍后再试" : "请求失败";
  return new KbError(status, code, message, err.details ?? {});
}

async function kbJson<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown } = {}, retry = true): Promise<T> {
  const s = await sessionOrThrow();
  let res: Taro.request.SuccessCallbackResult;
  try {
    res = await Taro.request({
      url: `${s.base}${path}`,
      method: opts.method ?? "GET",
      data: opts.body as Record<string, unknown> | undefined,
      header: authHeader(s, opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      timeout: 60000,
      dataType: "json",
    });
  } catch (e) {
    throw netError(e);
  }
  if (res.statusCode === 401 && retry) {
    await sessionOrThrow(true);
    return kbJson<T>(path, opts, false);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) throw httpError(res.statusCode, res.data);
  return res.data as T;
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

/** 上传一份试卷（本机文件路径，文件名要带对的扩展名）。同一个文件传过了返回 duplicateOf（已有那份的 id） */
export async function uploadPaper(filePath: string, opts: { title?: string; idemKey: string }, retry = true): Promise<UploadResult> {
  const s = await sessionOrThrow();
  let res: Taro.uploadFile.SuccessCallbackResult;
  try {
    res = await Taro.uploadFile({
      url: `${s.base}/v1/personal/papers`,
      filePath,
      name: "file",
      formData: opts.title ? { title: opts.title.slice(0, 280) } : {},
      header: authHeader(s, { "Idempotency-Key": opts.idemKey }),
      timeout: 300000,
    });
  } catch (e) {
    throw netError(e);
  }
  if (res.statusCode === 401 && retry) {
    await sessionOrThrow(true);
    return uploadPaper(filePath, opts, false);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err = httpError(res.statusCode, res.data);
    if (err.code === "duplicate_file" && typeof err.details.paper_id === "string") return { duplicateOf: err.details.paper_id };
    throw err;
  }
  let data: { paper_id: string; task: KbTask };
  try {
    data = JSON.parse(res.data) as { paper_id: string; task: KbTask };
  } catch {
    throw new KbError(res.statusCode, "bad_response", "小壹开小差了，请稍后再试");
  }
  return { paperId: data.paper_id, task: data.task };
}

export const getTask = (id: string) => kbJson<KbTask>(`/v1/tasks/${encodeURIComponent(id)}`);

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

/** 分块到达的 UTF-8：一个汉字可能被切在两块中间，没收全的字节留到下一块 */
function utf8Decoder() {
  let rest: number[] = [];
  return (chunk: ArrayBuffer): string => {
    const bytes = rest.concat(Array.from(new Uint8Array(chunk)));
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      const need = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (i + need > bytes.length) break;
      let cp: number;
      if (need === 1) cp = b;
      else if (need === 2) cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      else if (need === 3) cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      else cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += cp > 0xffff ? String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)) : String.fromCharCode(cp);
      i += need;
    }
    rest = bytes.slice(i);
    return out;
  };
}

export interface AnswerHandlers {
  onCitations: (list: KbCitation[]) => void;
  onDelta: (text: string) => void;
}
export type AnswerEnd = { status: "ok" } | { status: "not_found"; message: string } | { status: "error"; message: string };
/** 停止用的把手：abort() 之后 askStream 以 KbAbort 结束 */
export interface Aborter { aborted: boolean; abort: () => void }
export function newAborter(): Aborter {
  const a: Aborter = { aborted: false, abort: () => { a.aborted = true; } };
  return a;
}

interface ChunkTask { abort: () => void; onChunkReceived?: (fn: (r: { data: ArrayBuffer }) => void) => void }
declare const wx: { request: (o: Record<string, unknown>) => ChunkTask };

/** 发一次流式请求：边收边交给 onText；返回状态码和（出错时的）整段正文 */
function streamOnce(s: Session, path: string, body: Record<string, unknown>, onText: (t: string) => void, aborter: Aborter): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    if (aborter.aborted) return reject(new KbAbort());
    const decode = utf8Decoder();
    let all = "";
    let chunked = false;
    // 直接用微信原生的 wx.request：要它返回的任务对象来分块接收（enableChunked + onChunkReceived）和中途停止
    const task = wx.request({
      url: `${s.base}${path}`,
      method: "POST",
      data: body,
      header: authHeader(s, { "Content-Type": "application/json", Accept: "text/event-stream" }),
      timeout: 300000,
      enableChunked: true,
      responseType: "arraybuffer",
      success: (res: { statusCode: number; data?: unknown }) => {
        if (aborter.aborted) return reject(new KbAbort());
        // 基础库不支持分块时整段正文在 data 里一次给回来
        if (!chunked && res.data) {
          const t = res.data instanceof ArrayBuffer ? decode(res.data) : typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          all += t;
          if (res.statusCode >= 200 && res.statusCode < 300) onText(t);
        }
        resolve({ status: res.statusCode, text: all });
      },
      fail: (e: unknown) => reject(aborter.aborted ? new KbAbort() : netError(e)),
    });
    aborter.abort = () => {
      aborter.aborted = true;
      try { task.abort(); } catch { /* 已经结束了 */ }
      reject(new KbAbort());
    };
    task.onChunkReceived?.((r) => {
      if (aborter.aborted) return;
      chunked = true;
      const t = decode(r.data);
      all += t;
      // 出错时正文是一段 JSON，不是事件流；先攒着，等状态码出来再说
      if (all.length < 4096 && /^\s*\{/.test(all)) return;
      onText(t);
    });
  });
}

/**
 * 问一个问题，边生成边回调。只问某几份试卷（paperIds）时只查自己的库；
 * 否则「我的 + 题库」走个人问答并带上系统库，只开题库走系统问答。
 */
export async function askStream(question: string, history: Turn[], scope: AskScope, handlers: AnswerHandlers, aborter: Aborter): Promise<AnswerEnd> {
  const focused = !!scope.paperIds?.length;
  const path = !focused && !scope.mine ? "/v1/system/answers/stream" : "/v1/personal/answers/stream";

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
  const onText = (t: string) => {
    buf += t.replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  };

  const post = async (useNew: boolean, retry = true): Promise<{ status: number; text: string }> => {
    const s = await sessionOrThrow();
    const body = answerBody(question, history, scope, useNew);
    if (path.includes("personal")) body.include_system = focused ? false : scope.system;
    buf = "";
    const r = await streamOnce(s, path, body, onText, aborter);
    if (r.status === 401 && retry) {
      await sessionOrThrow(true);
      return post(useNew, false);
    }
    return r;
  };

  let r = await post(!legacy);
  if (r.status === 422 && !legacy) {
    legacy = true;
    r = await post(false);
  }
  if (r.status < 200 || r.status >= 300) throw httpError(r.status, r.text);
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

const searchPost = (path: string, body: Record<string, unknown>) => kbJson<SearchResp>(path, { method: "POST", body });

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
  const results = await Promise.all(targets.map((t) => run(t).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }))));
  const ok = results.flatMap((x) => (x.ok ? x.v : []));
  if (!ok.length) {
    const failed = results.find((x) => !x.ok);
    if (failed && !failed.ok) throw failed.e;
  }
  ok.sort((a, b) => (b.it.score ?? 0) - (a.it.score ?? 0));
  return ok.slice(0, topK).map(({ it, kb }, i) => (paper ? paperCitation(it as RawPaperHit, i, kb) : toCitation({ ...(it as RawItem), ref: i + 1 }, i, kb)));
}

/** 一份试卷拆出了几道题。老版本知识库不支持按试卷筛选，返回 null */
export async function countQuestions(paperId: string): Promise<number | null> {
  if (legacy) return null;
  try {
    const data = await kbJson<{ total?: number }>("/v1/personal/search", { method: "POST", body: { filters: { paper_ids: [paperId] }, top_k: 1 } });
    return typeof data.total === "number" ? data.total : null;
  } catch (e) {
    if (e instanceof KbError && e.status === 422) legacy = true;
    return null;
  }
}

/** 题干全文（引用里没带题干时用） */
export async function fetchQuestion(kb: "personal" | "system", id: string): Promise<{ content: string; options?: { label?: string; text?: string }[] } | null> {
  try {
    const raw = await kbJson<RawItem>(`/v1/${kb}/questions/${encodeURIComponent(id)}`);
    const c = toCitation(raw, 0, kb);
    return c.content ? { content: c.content, options: c.options } : null;
  } catch {
    return null;
  }
}
