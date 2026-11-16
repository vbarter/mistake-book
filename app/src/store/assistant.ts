import { create } from "zustand";
import { imagesToPdf, imageToJpeg, type PdfPageInput } from "../lib/imagesPdf";
import { askStream, countQuestions, getTask, kbAvailable, KbError, MAX_UPLOAD_BYTES, resetKbSession, searchQuestions, taskDone, wantsPaper, taskFailed, UPLOAD_EXTS, uploadPaper, type KbCitation, type KbTask, type Turn } from "../lib/kb";
import { newId } from "../lib/folders";
import { haptic } from "../lib/native";
import { takeScanPages } from "./scan";

/**
 * 智能聊天「问小壹」的状态：浮层开合、对话、上传到知识库的试卷。
 *
 * 对话层挂在 App 根上（components/Assistant.tsx），不是一个路由：缩小时底下的页面原样不动。
 * 对话记录只存本机（localStorage，按账号分开），最多留 MAX_CONVS 段；试卷本身在知识库里。
 */

export type AssistantMode = "closed" | "half" | "full";

export type AiState = "streaming" | "done" | "stopped" | "error" | "not_found" | "cut";

export type Msg =
  | { id: string; role: "user"; text: string; at: number }
  | {
      id: string;
      role: "ai";
      text: string;
      state: AiState;
      /** answer 回答（下面列出处）；found 找题结果（下面列题目卡片）；note 小壹自己说的话（试卷存好了之类） */
      kind: "answer" | "found" | "note";
      citations: KbCitation[];
      tips?: string[];
      at: number;
    }
  | { id: string; role: "file"; uploadId: string; at: number };

export type UploadState = "preparing" | "uploading" | "processing" | "done" | "failed";

export interface Upload {
  id: string;
  name: string;
  title: string;
  pages?: number;
  bytes?: number;
  state: UploadState;
  stage?: string;
  progress: number; // 0–1
  taskId?: string;
  paperId?: string;
  questions?: number | null;
  needsReview?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  at: number;
  msgs: Msg[];
}

export interface FocusPaper { id: string; title: string }

interface AssistantState {
  /** 这个账号能不能用：null 还不知道（不显示入口） */
  available: boolean | null;
  mode: AssistantMode;
  /** 用过一次以后入口只留头像 */
  seen: boolean;
  /** 同意过「提问和试卷会发给识别与大模型服务」 */
  agreed: boolean;
  /** 入口离屏幕底部的距离（px），拖动后记住；null 用默认位置 */
  orbBottom: number | null;
  unread: boolean;
  /** 入口旁边冒出来的一句话（试卷存好了 / 回答好了） */
  bubble: string | null;
  convs: Conversation[];
  convId: string;
  uploads: Record<string, Upload>;
  scope: { mine: boolean; system: boolean };
  focus: FocusPaper | null;
  /** 正在生成的那条回答 */
  busyId: string | null;
}

const MAX_CONVS = 30;
const MAX_MSGS = 200;

const blank = (): Conversation => ({ id: newId(), title: "", at: Date.now(), msgs: [] });

const first = blank();
export const useAssistant = create<AssistantState>(() => ({
  available: null,
  mode: "closed",
  seen: false,
  agreed: false,
  orbBottom: null,
  unread: false,
  bubble: null,
  convs: [first],
  convId: first.id,
  uploads: {},
  scope: { mine: true, system: true },
  focus: null,
  busyId: null,
}));

const get = useAssistant.getState;
const set = useAssistant.setState;

export const currentConv = (s: AssistantState) => s.convs.find((c) => c.id === s.convId) ?? s.convs[0];
export const isAssistantOpen = () => get().mode !== "closed";

// ---------------------------------------------------------------- 本机存档

let userKey: string | null = null;
const storeKey = () => (userKey ? `zcb.assistant.v1.${userKey}` : null);

interface Saved {
  seen: boolean;
  agreed: boolean;
  orbBottom: number | null;
  convs: Conversation[];
  convId: string;
  uploads: Record<string, Upload>;
  scope: { mine: boolean; system: boolean };
  focus: FocusPaper | null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const key = storeKey();
    if (!key) return;
    const s = get();
    const used = new Set(s.convs.flatMap((c) => c.msgs.flatMap((m) => (m.role === "file" ? [m.uploadId] : []))));
    const data: Saved = {
      seen: s.seen,
      agreed: s.agreed,
      orbBottom: s.orbBottom,
      convs: s.convs.filter((c) => c.msgs.length || c.id === s.convId),
      convId: s.convId,
      uploads: Object.fromEntries(Object.entries(s.uploads).filter(([id]) => used.has(id))),
      scope: s.scope,
      focus: s.focus,
    };
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* 存不下就只留在内存里 */ }
  }, 400);
}

function load(): Partial<AssistantState> {
  const key = storeKey();
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const d = JSON.parse(raw) as Saved;
    // 上次没说完就被关掉的回答：标成「没说完」
    const convs = (d.convs ?? []).map((c) => ({ ...c, msgs: c.msgs.map((m) => (m.role === "ai" && m.state === "streaming" ? { ...m, state: "cut" as const } : m)) }));
    // 还没传上去就被关掉的：照片不在了，只能算失败
    const uploads = Object.fromEntries(Object.entries(d.uploads ?? {}).map(([id, u]) => [id, u.state === "preparing" || u.state === "uploading" ? { ...u, state: "failed" as const, error: "上次没传完，请重新传一次" } : u]));
    if (!convs.length) return { seen: !!d.seen, agreed: !!d.agreed, orbBottom: d.orbBottom ?? null };
    return {
      seen: !!d.seen,
      agreed: !!d.agreed,
      orbBottom: d.orbBottom ?? null,
      convs,
      convId: convs.some((c) => c.id === d.convId) ? d.convId : convs[0].id,
      uploads,
      scope: d.scope && (d.scope.mine || d.scope.system) ? d.scope : { mine: true, system: true },
      focus: d.focus ?? null,
    };
  } catch {
    return {};
  }
}

/** 登录后调用：读这个账号的存档，问服务端开没开通，接着盯没处理完的试卷 */
export function startAssistant(userId: string | number): () => void {
  userKey = String(userId);
  const fresh = blank();
  set({ available: null, mode: "closed", unread: false, bubble: null, busyId: null, convs: [fresh], convId: fresh.id, uploads: {}, focus: null, seen: false, agreed: false, orbBottom: null, scope: { mine: true, system: true }, ...load() });
  let lastAsk = 0;
  const check = () => {
    if (get().available === true || Date.now() - lastAsk < 60000) return;
    lastAsk = Date.now();
    void kbAvailable().then((ok) => {
      if (userKey !== String(userId)) return;
      set({ available: ok });
      if (ok) for (const u of Object.values(get().uploads)) if (u.state === "processing" && u.taskId) watch(u.id);
    });
  };
  check();
  const onVisible = () => { if (document.visibilityState === "visible") check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    stopAnswer();
    for (const t of watchers.values()) clearTimeout(t);
    watchers.clear();
    resetKbSession();
    userKey = null;
    set({ available: null, mode: "closed" });
  };
}

// ---------------------------------------------------------------- 开合

export function openAssistant(mode: Exclude<AssistantMode, "closed"> = "half") {
  set({ mode, unread: false, bubble: null, seen: true });
  save();
}
export function minimizeAssistant() {
  if (get().mode === "closed") return;
  set({ mode: "closed" });
}
export function setAssistantMode(mode: AssistantMode) {
  set({ mode });
}
export function setOrbBottom(px: number) {
  set({ orbBottom: Math.round(px) });
  save();
}
export function agreeAssistant() {
  set({ agreed: true });
  save();
}
export function setScope(scope: { mine: boolean; system: boolean }) {
  if (!scope.mine && !scope.system) return; // 至少留一个
  set({ scope });
  save();
}
export function setFocus(focus: FocusPaper | null) {
  set({ focus });
  save();
}

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
/** 缩小着的时候有了新东西：入口亮红点、冒一句话 */
function notify(text: string) {
  if (get().mode !== "closed") return;
  set({ unread: true, bubble: text });
  void haptic.light();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => set({ bubble: null }), 7000);
}
export const dismissBubble = () => set({ bubble: null });

// ---------------------------------------------------------------- 对话

function patchConv(convId: string, fn: (c: Conversation) => Conversation) {
  set((s) => ({ convs: s.convs.map((c) => (c.id === convId ? fn(c) : c)) }));
  save();
}
function pushMsg(convId: string, msg: Msg) {
  patchConv(convId, (c) => ({ ...c, at: Date.now(), msgs: [...c.msgs, msg].slice(-MAX_MSGS) }));
}
function patchMsg(convId: string, id: string, fn: (m: Extract<Msg, { role: "ai" }>) => Extract<Msg, { role: "ai" }>) {
  patchConv(convId, (c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === id && m.role === "ai" ? fn(m) : m)) }));
}

export function newConversation() {
  stopAnswer();
  const cur = currentConv(get());
  if (!cur.msgs.length) return; // 当前这段还是空的，不用再开
  const c = blank();
  set((s) => ({ convs: [c, ...s.convs].slice(0, MAX_CONVS), convId: c.id, focus: null }));
  save();
}
export function pickConversation(id: string) {
  stopAnswer();
  set((s) => ({ convId: id, convs: s.convs.filter((c) => c.msgs.length || c.id === id), focus: null }));
  save();
}
export function deleteConversation(id: string) {
  if (get().busyId && get().convId === id) stopAnswer();
  set((s) => {
    const convs = s.convs.filter((c) => c.id !== id);
    if (!convs.length) convs.push(blank());
    return { convs, convId: convs.some((c) => c.id === s.convId) ? s.convId : convs[0].id };
  });
  save();
}

/** 「找几道勾股定理的题」这类话走检索，排成题目卡片；其余的走问答 */
const FIND_RE = /^(请|帮我|给我|帮忙)?(再)?(找|搜|查找|搜索|搜一下|找一下|找找)(出|到)?.{0,6}?(道|个|些|题|卷)/;

const FOLLOW_UPS = ["再出两道类似的题", "换一种讲法"];

let aborter: AbortController | null = null;

export function stopAnswer() {
  aborter?.abort();
  aborter = null;
}

/** 带给知识库的前几轮对话：只要文字，最多 3 来回 */
function historyOf(conv: Conversation): Turn[] {
  const turns: Turn[] = [];
  for (const m of conv.msgs) {
    if (m.role === "user") turns.push({ role: "user", content: m.text });
    else if (m.role === "ai" && m.kind === "answer" && m.text && (m.state === "done" || m.state === "stopped")) turns.push({ role: "assistant", content: m.text.slice(0, 1500) });
  }
  return turns.slice(-6);
}

export async function sendQuestion(raw: string) {
  const text = raw.trim();
  if (!text || get().busyId) return;
  const s = get();
  const conv = currentConv(s);
  const convId = conv.id;
  const history = historyOf(conv);
  const scope = { ...s.scope, paperIds: s.focus ? [s.focus.id] : undefined };
  const aiId = newId();
  if (!conv.title) patchConv(convId, (c) => ({ ...c, title: text.slice(0, 24) }));
  pushMsg(convId, { id: newId(), role: "user", text, at: Date.now() });
  const finding = FIND_RE.test(text);
  pushMsg(convId, { id: aiId, role: "ai", text: "", state: "streaming", kind: finding ? "found" : "answer", citations: [], at: Date.now() });
  set({ busyId: aiId });
  const ctl = new AbortController();
  aborter = ctl;
  const finish = (patch: Partial<Extract<Msg, { role: "ai" }>>) => {
    patchMsg(convId, aiId, (m) => ({ ...m, ...patch }));
    if (get().busyId === aiId) set({ busyId: null });
    if (aborter === ctl) aborter = null;
  };
  try {
    if (finding) {
      const items = await searchQuestions(text, scope);
      if (ctl.signal.aborted) return finish({ state: "stopped" });
      const papers = !s.focus && wantsPaper(text);
      if (!items.length) return finish({ state: "not_found", text: s.focus ? "这份试卷里没找到相关的题，去掉上面的试卷标签再找找看。" : papers ? "没找到这样的试卷。换个说法试试，或者把试卷传给我。" : "没找到相关的题。换个说法试试，或者把相关的试卷传给我。" });
      finish({ state: "done", text: papers ? `找到 ${items.length} 份相关的试卷，点开看里面的题：` : `找到 ${items.length} 道相关的题，点开看原题：`, citations: items });
      notify("小壹：帮你找到题了，点我看看");
      return;
    }
    // 攒一小会儿再刷界面：逐字 setState 太密，长回答会卡
    let pendingText = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!pendingText) return;
      const add = pendingText;
      pendingText = "";
      patchMsg(convId, aiId, (m) => ({ ...m, text: m.text + add }));
    };
    const end = await askStream(text, history, scope, {
      onCitations: (citations) => patchMsg(convId, aiId, (m) => ({ ...m, citations })),
      onDelta: (t) => {
        pendingText += t;
        if (!flushTimer) flushTimer = setTimeout(flush, 60);
      },
    }, ctl.signal);
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    if (end.status === "ok") {
      finish({ state: "done", tips: FOLLOW_UPS });
      notify("小壹：回答好了，点我看看");
    } else if (end.status === "not_found") {
      finish({ state: "not_found", text: s.focus ? "这份试卷里没找到和这个问题相关的内容。去掉上面的试卷标签，我再到全部试卷里找找。" : `${end.message}\n可以换个说法，或者把相关的试卷传给我。`, citations: [] });
    } else {
      const had = currentConv(get()).msgs.find((m) => m.id === aiId);
      finish(had && had.role === "ai" && had.text ? { state: "cut" } : { state: "error", text: end.message });
    }
  } catch (e) {
    if ((e as Error).name === "AbortError" || ctl.signal.aborted) return finish({ state: "stopped" });
    const had = currentConv(get()).msgs.find((m) => m.id === aiId);
    if (had && had.role === "ai" && had.text) return finish({ state: "cut" });
    finish({ state: "error", text: e instanceof KbError ? e.message : "出了点问题，请再试一次" });
  }
}

/** 重新回答：把那条回答和它前面的提问去掉，再问一遍 */
export function retryAnswer(aiId: string) {
  if (get().busyId) return;
  const conv = currentConv(get());
  const i = conv.msgs.findIndex((m) => m.id === aiId);
  const q = i > 0 ? conv.msgs[i - 1] : null;
  if (!q || q.role !== "user") return;
  patchConv(conv.id, (c) => ({ ...c, msgs: c.msgs.filter((m) => m.id !== aiId && m.id !== q.id) }));
  void sendQuestion(q.text);
}

// ---------------------------------------------------------------- 上传试卷

function patchUpload(id: string, p: Partial<Upload>) {
  set((s) => (s.uploads[id] ? { uploads: { ...s.uploads, [id]: { ...s.uploads[id], ...p } } } : s));
  save();
}

function note(convId: string, text: string, tips?: string[]) {
  pushMsg(convId, { id: newId(), role: "ai", text, state: "done", kind: "note", citations: [], tips, at: Date.now() });
}

const PAPER_TIPS = ["这张卷子考了哪些知识点", "挑 3 道最难的讲讲", "出几道类似的题"];

const watchers = new Map<string, ReturnType<typeof setTimeout>>();
/** 每条上传属于哪段对话（处理完往那段里说一声） */
const uploadConv = new Map<string, string>();

function convOfUpload(id: string): string {
  return uploadConv.get(id) ?? get().convs.find((c) => c.msgs.some((m) => m.role === "file" && m.uploadId === id))?.id ?? get().convId;
}

async function finishUpload(id: string, task: KbTask) {
  const u = get().uploads[id];
  if (!u || u.state === "done") return;
  const paperId = task.paper_id || u.paperId;
  const questions = paperId ? await countQuestions(paperId) : null;
  const needsReview = task.state === "needs_review" || !!task.detail?.needs_review;
  patchUpload(id, { state: "done", progress: 1, stage: "ready", paperId, questions, needsReview });
  const convId = convOfUpload(id);
  const count = questions != null ? `，共 ${questions} 道题` : "";
  if (questions === 0) {
    note(convId, `《${u.title}》传上来了，但没拆出题目。可能是照片不清楚或者不是试卷，换一份清楚的再传一次试试。`);
  } else {
    note(convId, `《${u.title}》存好了${count}${needsReview ? "。有几道题没拆完整，回答时遇到我会提醒你" : ""}。想从哪儿开始？`, PAPER_TIPS);
    if (paperId && get().convId === convId) setFocus({ id: paperId, title: u.title });
  }
  notify(`小壹：《${u.title}》存好了${count}，点我接着问`);
}

function watch(id: string) {
  if (watchers.has(id)) return;
  let errors = 0;
  const tick = async () => {
    const u = get().uploads[id];
    if (!u || u.state !== "processing" || !u.taskId) return void watchers.delete(id);
    try {
      const task = await getTask(u.taskId);
      errors = 0;
      if (taskDone(task)) {
        watchers.delete(id);
        return void finishUpload(id, task);
      }
      if (taskFailed(task)) {
        watchers.delete(id);
        patchUpload(id, { state: "failed", error: "没处理成功，换一份清楚的再传一次试试" });
        notify(`小壹：《${u.title}》没处理成功`);
        return;
      }
      patchUpload(id, { stage: task.stage, progress: Math.max(u.progress, task.progress || 0) });
    } catch (e) {
      // 任务查不到了（404）就别再问；其他错误多试几次
      if ((e instanceof KbError && e.status === 404) || ++errors > 20) {
        watchers.delete(id);
        patchUpload(id, { state: "failed", error: "查不到处理进度了，请重新传一次" });
        return;
      }
    }
    // 开着对话 2 秒问一次，缩小了或切到后台放慢
    watchers.set(id, setTimeout(tick, get().mode === "closed" || document.visibilityState !== "visible" ? 5000 : 2000));
  };
  watchers.set(id, setTimeout(tick, 1200));
}

interface UploadSource {
  name: string;
  title: string;
  pages?: number;
  /** 现成的文件（PDF / Word / 单张图） */
  file?: Blob;
  /** 几张照片：一张直接传，多张先合成一份 PDF */
  images?: PdfPageInput[];
}

const sources = new Map<string, UploadSource>();

async function runUpload(id: string) {
  const src = sources.get(id);
  if (!src) return patchUpload(id, { state: "failed", error: "文件不在了，请重新选一次" });
  try {
    let file = src.file;
    let name = src.name;
    if (!file && src.images?.length) {
      patchUpload(id, { state: "preparing", error: undefined });
      if (src.images.length === 1) {
        file = await imageToJpeg(src.images[0].src);
        name = `${src.title}.jpg`;
      } else {
        file = await imagesToPdf(src.images);
        name = `${src.title}.pdf`;
      }
    }
    if (!file) throw new KbError(0, "empty", "没有可传的内容");
    if (file.size > MAX_UPLOAD_BYTES) throw new KbError(413, "too_large", "文件太大了，最多 50 MB");
    patchUpload(id, { state: "uploading", bytes: file.size, error: undefined });
    const result = await uploadPaper(file, name, { title: src.title, idemKey: `app-${id}` });
    sources.delete(id);
    const convId = convOfUpload(id);
    if ("duplicateOf" in result) {
      const questions = await countQuestions(result.duplicateOf);
      patchUpload(id, { state: "done", progress: 1, paperId: result.duplicateOf, questions });
      note(convId, `《${src.title}》之前传过了，不用再传，直接问吧。`, PAPER_TIPS);
      if (get().convId === convId) setFocus({ id: result.duplicateOf, title: src.title });
      return;
    }
    patchUpload(id, { state: "processing", taskId: result.task.task_id, paperId: result.paperId, stage: result.task.stage, progress: result.task.progress || 0 });
    if (taskDone(result.task)) return void finishUpload(id, result.task);
    watch(id);
  } catch (e) {
    const error = e instanceof KbError ? (e.code === "quota_exceeded" ? "知识库里的试卷已经到上限了" : e.message) : "没传上去，请再试一次";
    patchUpload(id, { state: "failed", error });
  }
}

function addUpload(src: UploadSource) {
  const id = newId();
  const convId = get().convId;
  sources.set(id, src);
  uploadConv.set(id, convId);
  set((s) => ({ uploads: { ...s.uploads, [id]: { id, name: src.name, title: src.title, pages: src.pages, bytes: src.file?.size, state: src.file ? "uploading" : "preparing", progress: 0 } } }));
  const conv = currentConv(get());
  if (!conv.title) patchConv(convId, (c) => ({ ...c, title: src.title.slice(0, 24) }));
  pushMsg(convId, { id: newId(), role: "file", uploadId: id, at: Date.now() });
  void runUpload(id);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 拍的、相册选的、已有试卷里的照片：当成一份试卷传 */
export function uploadImages(images: PdfPageInput[], title?: string) {
  if (!images.length) return;
  const t = (title || `拍的试卷 ${stamp()}`).trim();
  addUpload({ name: images.length > 1 ? `${t}.pdf` : `${t}.jpg`, title: t, pages: images.length, images });
}

/** 文件选择器选的 PDF / Word / 图片。不支持的类型、太大的直接说，不建卡片。返回提示语（没问题返回 null） */
export function uploadFile(file: File): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!UPLOAD_EXTS.includes(ext)) return "只能传 PDF、Word（docx）、图片或 txt";
  if (file.size > MAX_UPLOAD_BYTES) return "文件太大了，最多 50 MB";
  if (!file.size) return "这个文件是空的";
  addUpload({ name: file.name, title: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "试卷", file });
  return null;
}

export function retryUpload(id: string) {
  const u = get().uploads[id];
  if (!u || u.state !== "failed") return;
  if (!sources.has(id)) return patchUpload(id, { error: "文件不在了，请重新选一次" });
  void runUpload(id);
}

export const STAGE_STEPS = ["上传", "识别", "切题", "入库"] as const;
/** 进度条上亮到第几步（0 起），已经全好了返回 4 */
export function stepOf(u: Upload): number {
  if (u.state === "done") return 4;
  if (u.state === "preparing" || u.state === "uploading") return 0;
  switch (u.stage) {
    case "structuring": return 2;
    case "indexing": return 3;
    case "ready": return 4;
    default: return 1; // uploaded / extracting / ocr
  }
}

/** 连拍扫描页里点了「完成」：回到对话，等照片都拉正了当成一份试卷传上去 */
export async function finishChatScan() {
  openAssistant("full");
  const pages = await takeScanPages();
  uploadImages(pages);
}
