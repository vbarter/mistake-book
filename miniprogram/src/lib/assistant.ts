/**
 * 智能聊天「问小壹」的状态：对话、上传到知识库的试卷、入口上的红点和提示。和 App 的 app/src/store/assistant.ts 同一套逻辑。
 *
 * 小程序里没有能盖在所有页面上的全局浮层，所以对话是单独一页（pages/assistant），四个 Tab 页右边各放一个入口（components/AssistantOrb）。
 * 状态放在这个模块里：离开对话页，回答照样往下生成、试卷照样往下处理，入口上亮红点提醒。
 * 对话记录只存本机（storage，按账号分开），最多留 MAX_CONVS 段；试卷本身在知识库里。
 */
import Taro from "@tarojs/taro";
import { useSyncExternalStore } from "react";
import { currentUser, isLoggedIn } from "./auth";
import {
  askStream, countQuestions, getTask, kbAvailable, KbAbort, KbError, MAX_UPLOAD_BYTES, newAborter, resetKbSession, searchQuestions, taskDone, taskFailed, UPLOAD_EXTS, uploadPaper,
  type Aborter, type KbCitation, type KbTask, type Turn,
} from "./kb";
import { newId } from "./store";

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
export type AiMsg = Extract<Msg, { role: "ai" }>;

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

export interface AssistantState {
  /** 这个账号能不能用：null 还不知道（不显示入口） */
  available: boolean | null;
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

const MAX_CONVS = 20;
const MAX_MSGS = 200;
/** 小程序单个 storage 键最多 1 MB：存档超过这个字数就从最旧的对话开始丢 */
const MAX_SAVE_CHARS = 400000;

const blank = (): Conversation => ({ id: newId(), title: "", at: Date.now(), msgs: [] });

function initial(): AssistantState {
  const c = blank();
  return { available: null, seen: false, agreed: false, orbBottom: null, unread: false, bubble: null, convs: [c], convId: c.id, uploads: {}, scope: { mine: true, system: true }, focus: null, busyId: null };
}

let state: AssistantState = initial();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
const get = () => state;
function set(patch: Partial<AssistantState> | ((s: AssistantState) => Partial<AssistantState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((fn) => fn());
}

export function useAssistant<T>(selector: (s: AssistantState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export const currentConv = (s: AssistantState) => s.convs.find((c) => c.id === s.convId) ?? s.convs[0];

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
    let convs = s.convs.filter((c) => c.msgs.length || c.id === s.convId);
    for (;;) {
      const used = new Set(convs.flatMap((c) => c.msgs.flatMap((m) => (m.role === "file" ? [m.uploadId] : []))));
      const data: Saved = {
        seen: s.seen,
        agreed: s.agreed,
        orbBottom: s.orbBottom,
        convs,
        convId: s.convId,
        uploads: Object.fromEntries(Object.entries(s.uploads).filter(([id]) => used.has(id))),
        scope: s.scope,
        focus: s.focus,
      };
      const text = JSON.stringify(data);
      // 太大了：丢掉最旧的一段（不是当前这段）再试
      const oldest = [...convs].filter((c) => c.id !== s.convId).sort((a, b) => a.at - b.at)[0];
      if (text.length > MAX_SAVE_CHARS && oldest) {
        convs = convs.filter((c) => c.id !== oldest.id);
        continue;
      }
      try { Taro.setStorageSync(key, text); } catch { /* 存不下就只留在内存里 */ }
      return;
    }
  }, 500);
}

function load(): Partial<AssistantState> {
  const key = storeKey();
  if (!key) return {};
  try {
    const raw = Taro.getStorageSync(key);
    if (!raw || typeof raw !== "string") return {};
    const d = JSON.parse(raw) as Saved;
    // 上次没说完就被关掉的回答：标成「没说完」
    const convs = (d.convs ?? []).map((c) => ({ ...c, msgs: c.msgs.map((m) => (m.role === "ai" && m.state === "streaming" ? { ...m, state: "cut" as const } : m)) }));
    // 还没传上去就被关掉的：文件不在了，只能算失败
    const uploads = Object.fromEntries(Object.entries(d.uploads ?? {}).map(([id, u]) => [id, u.state === "preparing" || u.state === "uploading" ? { ...u, state: "failed" as const, error: "上次没传完，请重新传一次" } : u]));
    const base = { seen: !!d.seen, agreed: !!d.agreed, orbBottom: d.orbBottom ?? null };
    if (!convs.length) return base;
    return {
      ...base,
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

// ---------------------------------------------------------------- 启动、换账号

let lastAsk = 0;

function stopAll() {
  stopAnswer();
  for (const t of watchers.values()) clearTimeout(t);
  watchers.clear();
  sources.clear();
  uploadConv.clear();
  resetKbSession();
}

/**
 * 页面显示、登录状态变化时调：没登录就收起来；换了账号读那个账号的存档；
 * 还不知道服务端开没开通就问一次（一分钟内不重复问），开通了接着盯没处理完的试卷。
 */
export function ensureAssistant() {
  const uid = isLoggedIn() ? currentUser()?.id : null;
  const key = uid != null ? String(uid) : null;
  if (key !== userKey) {
    stopAll();
    userKey = key;
    lastAsk = 0;
    state = { ...initial(), ...load() };
    listeners.forEach((fn) => fn());
  }
  if (!key || get().available === true || Date.now() - lastAsk < 60000) return;
  lastAsk = Date.now();
  void kbAvailable().then((ok) => {
    if (userKey !== key) return;
    set({ available: ok });
    if (ok) for (const u of Object.values(get().uploads)) if (u.state === "processing" && u.taskId) watch(u.id);
  });
}

// ---------------------------------------------------------------- 入口、范围

/** 对话页开着没有：开着就不用亮红点，查进度也勤一点 */
let pageOpen = false;
export function setAssistantPageOpen(open: boolean) {
  pageOpen = open;
  if (open) {
    set({ unread: false, bubble: null, seen: true });
    save();
  }
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
/** 不在对话页的时候有了新东西：入口亮红点、冒一句话 */
function notify(text: string) {
  if (pageOpen) return;
  set({ unread: true, bubble: text });
  void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
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
function patchMsg(convId: string, id: string, fn: (m: AiMsg) => AiMsg) {
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

let aborter: Aborter | null = null;

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
  const ctl = newAborter();
  aborter = ctl;
  const finish = (patch: Partial<AiMsg>) => {
    patchMsg(convId, aiId, (m) => ({ ...m, ...patch }));
    if (get().busyId === aiId) set({ busyId: null });
    if (aborter === ctl) aborter = null;
  };
  const textSoFar = () => {
    const m = get().convs.find((c) => c.id === convId)?.msgs.find((x) => x.id === aiId);
    return m && m.role === "ai" ? m.text : "";
  };
  // 攒一小会儿再刷界面：逐字刷太密，长回答会卡
  let pendingText = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!pendingText) return;
    const add = pendingText;
    pendingText = "";
    patchMsg(convId, aiId, (m) => ({ ...m, text: m.text + add }));
  };
  try {
    if (finding) {
      const items = await searchQuestions(text, scope);
      if (ctl.aborted) return finish({ state: "stopped" });
      if (!items.length) return finish({ state: "not_found", text: s.focus ? "这份试卷里没找到相关的题，去掉上面的试卷标签再找找看。" : "没找到相关的题。换个说法试试，或者把相关的试卷传给我。" });
      finish({ state: "done", text: `找到 ${items.length} 道相关的题，点开看原题：`, citations: items });
      notify("小壹：帮你找到题了，点我看看");
      return;
    }
    const end = await askStream(text, history, scope, {
      onCitations: (citations) => patchMsg(convId, aiId, (m) => ({ ...m, citations })),
      onDelta: (t) => {
        if (ctl.aborted) return;
        pendingText += t;
        if (!flushTimer) flushTimer = setTimeout(flush, 120);
      },
    }, ctl);
    flush();
    if (end.status === "ok") {
      finish({ state: "done", tips: FOLLOW_UPS });
      notify("小壹：回答好了，点我看看");
    } else if (end.status === "not_found") {
      finish({ state: "not_found", text: s.focus ? "这份试卷里没找到和这个问题相关的内容。去掉上面的试卷标签，我再到全部试卷里找找。" : `${end.message}\n可以换个说法，或者把相关的试卷传给我。`, citations: [] });
    } else {
      finish(textSoFar() ? { state: "cut" } : { state: "error", text: end.message });
    }
  } catch (e) {
    flush();
    if (e instanceof KbAbort || ctl.aborted) return finish({ state: "stopped" });
    if (textSoFar()) return finish({ state: "cut" });
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
  set((s) => (s.uploads[id] ? { uploads: { ...s.uploads, [id]: { ...s.uploads[id], ...p } } } : {}));
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
    if (!watchers.has(id)) return; // 中途换了账号
    // 开着对话页 2 秒问一次，不在这一页放慢
    watchers.set(id, setTimeout(tick, pageOpen ? 2000 : 5000));
  };
  watchers.set(id, setTimeout(tick, 1200));
}

interface UploadSource {
  title: string;
  /** 现成的文件（PDF / Word / txt）：本机路径和扩展名 */
  file?: { path: string; ext: string };
  /** 几张照片：一张直接传，多张先合成一份 PDF */
  images?: string[];
}

const sources = new Map<string, UploadSource>();

const UP_DIR = `${Taro.env.USER_DATA_PATH}/kb-up`;
function upPath(id: string, ext: string): string {
  const fs = Taro.getFileSystemManager();
  try { fs.accessSync(UP_DIR); } catch { fs.mkdirSync(UP_DIR, true); }
  return `${UP_DIR}/${id}.${ext}`;
}
const unlink = (path: string) => {
  try { Taro.getFileSystemManager().unlinkSync(path); } catch { /* 本来就没有 */ }
};
function fileSize(path: string): number {
  try {
    return (Taro.getFileSystemManager().statSync(path) as { size: number }).size;
  } catch {
    return 0;
  }
}

/** 照片压成 JPEG（不管原来是什么格式），顺便小一点；压不了就用原图 */
async function toJpeg(src: string): Promise<string> {
  try {
    return (await Taro.compressImage({ src, quality: 82 })).tempFilePath || src;
  } catch {
    return src;
  }
}

interface JpegInfo { width: number; height: number; comps: number; orientation: number }

/** 读 JPEG 的尺寸、颜色通道数和 EXIF 方向；不是 JPEG 返回 null */
function jpegInfo(buf: ArrayBuffer): JpegInfo | null {
  const b = new Uint8Array(buf);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation = 1;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9], orientation };
    }
    // APP1 里的 EXIF：找方向标记 0x0112
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF 头
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24) : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const ifd = t + u32(t + 4);
      if (ifd + 2 < i + 2 + len) {
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (e + 12 > b.length) break;
          if (u16(e) === 0x0112) { orientation = u16(e + 8); break; }
        }
      }
    }
    if (marker === 0xda) break; // 图像数据开始了还没见到尺寸
    i += 2 + len;
  }
  return null;
}

/** 几张 JPEG 照片拼成一份 PDF（一张一页，照片原样嵌进去不重新压缩）。返回 PDF 的字节 */
function jpegsToPdf(pages: { data: ArrayBuffer; info: JpegInfo }[]): ArrayBuffer {
  const parts: Uint8Array[] = [];
  let size = 0;
  const offsets: number[] = [];
  const str = (s: string) => {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    parts.push(a);
    size += a.length;
  };
  const bin = (a: Uint8Array) => { parts.push(a); size += a.length; };
  const obj = (n: number, body: string) => { offsets[n] = size; str(`${n} 0 obj\n${body}\nendobj\n`); };
  str("%PDF-1.4\n%\xff\xff\xff\xff\n");
  // 对象号：1 目录，2 页面树，之后每页三个（页、内容、图片）
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach(({ data, info }, i) => {
    const pageNo = 3 + i * 3;
    // 页面宽 595pt（A4 的宽），高按照片比例
    const w = 595;
    const h = Math.max(1, Math.round((595 * info.height) / info.width));
    // EXIF 说照片要转着看：PDF 不认 EXIF，在页面上写旋转
    const rotate = info.orientation === 6 ? 90 : info.orientation === 3 ? 180 : info.orientation === 8 ? 270 : 0;
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pageNo, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]${rotate ? ` /Rotate ${rotate}` : ""} /Resources << /XObject << /Im0 ${pageNo + 2} 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
    obj(pageNo + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const cs = info.comps === 1 ? "/DeviceGray" : info.comps === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    offsets[pageNo + 2] = size;
    str(`${pageNo + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${info.comps === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : ""} /Length ${data.byteLength} >>\nstream\n`);
    bin(new Uint8Array(data));
    str("\nendstream\nendobj\n");
  });
  const total = 2 + pages.length * 3;
  const xref = size;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  str(`${table}trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

/** 把来源整理成一个能直接上传的文件；made = 这个文件是我们临时生成的，传完要删 */
async function prepare(id: string, src: UploadSource): Promise<{ path: string; made: boolean }> {
  const fs = Taro.getFileSystemManager();
  if (src.file) {
    // 上传时服务端按文件名的扩展名认类型：临时路径的扩展名不对就按对的名字复制一份
    if (new RegExp(`\\.${src.file.ext}$`, "i").test(src.file.path)) return { path: src.file.path, made: false };
    const dest = upPath(id, src.file.ext);
    fs.copyFileSync(src.file.path, dest);
    return { path: dest, made: true };
  }
  const images = src.images ?? [];
  if (!images.length) throw new KbError(0, "empty", "没有可传的内容");
  if (images.length === 1) {
    const jpg = await toJpeg(images[0]);
    if (/\.jpe?g$/i.test(jpg)) return { path: jpg, made: false };
    const dest = upPath(id, "jpg");
    fs.copyFileSync(jpg, dest);
    return { path: dest, made: true };
  }
  const pages: { data: ArrayBuffer; info: JpegInfo }[] = [];
  for (const img of images) {
    const jpg = await toJpeg(img);
    const data = fs.readFileSync(jpg) as ArrayBuffer;
    const info = jpegInfo(data);
    if (!info || !info.width || !info.height) throw new KbError(0, "bad_image", "有一张照片的格式处理不了，换一张再试");
    pages.push({ data, info });
  }
  const dest = upPath(id, "pdf");
  fs.writeFileSync(dest, jpegsToPdf(pages));
  return { path: dest, made: true };
}

async function runUpload(id: string) {
  const src = sources.get(id);
  if (!src) return patchUpload(id, { state: "failed", error: "文件不在了，请重新选一次" });
  let made: string | null = null;
  try {
    patchUpload(id, { state: src.file ? "uploading" : "preparing", error: undefined });
    const file = await prepare(id, src);
    if (file.made) made = file.path;
    const bytes = fileSize(file.path);
    if (bytes > MAX_UPLOAD_BYTES) throw new KbError(413, "too_large", "文件太大了，最多 50 MB");
    patchUpload(id, { state: "uploading", bytes: bytes || undefined });
    const result = await uploadPaper(file.path, { title: src.title, idemKey: `mp-${id}` });
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
  } finally {
    if (made) unlink(made);
  }
}

function addUpload(src: UploadSource, name: string, pages?: number, bytes?: number) {
  const id = newId();
  const convId = get().convId;
  sources.set(id, src);
  uploadConv.set(id, convId);
  set((s) => ({ uploads: { ...s.uploads, [id]: { id, name, title: src.title, pages, bytes, state: src.file ? "uploading" : "preparing", progress: 0 } } }));
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

/** 拍的、相册选的、已有试卷里的照片（本机路径）：当成一份试卷传 */
export function uploadImages(images: string[], title?: string) {
  if (!images.length) return;
  const t = (title || `拍的试卷 ${stamp()}`).trim();
  addUpload({ title: t, images }, images.length > 1 ? `${t}.pdf` : `${t}.jpg`, images.length);
}

/** 从聊天里选的 PDF / Word / txt。不支持的类型、太大的直接说，不建卡片。返回提示语（没问题返回 null） */
export function uploadFile(file: { path: string; name: string; size: number }): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!UPLOAD_EXTS.includes(ext)) return "只能传 PDF、Word（docx）、图片或 txt";
  if (file.size > MAX_UPLOAD_BYTES) return "文件太大了，最多 50 MB";
  if (!file.size) return "这个文件是空的";
  addUpload({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "试卷", file: { path: file.path, ext } }, file.name, undefined, file.size);
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

/** 正在传、正在处理的有几份，平均进度多少（入口外圈的进度环用） */
export function workingOf(uploads: Record<string, Upload>): { count: number; progress: number } {
  const working = Object.values(uploads).filter((u) => u.state === "preparing" || u.state === "uploading" || u.state === "processing");
  const progress = working.length ? working.reduce((n, u) => n + (u.state === "processing" ? Math.max(0.1, u.progress) : 0.05), 0) / working.length : 0;
  return { count: working.length, progress };
}
