/** 今天作业计划（待办事项）：录入作业 → 确认清单 → 每项设提醒时间 → 到点自动开始计时 → 一项一项做完、拍完成照片。
 *
 * 到点自动开始由服务端算（每次读清单时按当前时间推进），这里只负责：拉清单、在页面上让秒表走起来、到点时弹提醒。
 * 服务端见 server/app/routes/homework.py；界面稿见项目文件 screenshots/homework-today/。
 */
import { create } from "zustand";
import { api, getApiBase } from "../api/client";
import type { Subject } from "../api/types";
import { SUBJECT_LABEL } from "./format";

export type HwSubject = Subject | "other";
export type HwStatus = "todo" | "running" | "paused" | "done";

export interface HwItem {
  id: string;
  day: string;
  title: string;
  subject: HwSubject;
  position: number;
  source: string;
  planAssignmentId: string | null;
  remindAt: string | null;
  chain: boolean;
  est: number;
  status: HwStatus;
  /** 已用秒数（拉清单那一刻） */
  used: number;
  startedAt: string | null;
  firstStartedAt: string | null;
  autoStarted: boolean;
  finishedAt: string | null;
  /** 提醒时间过了还没开始（在等上一项做完） */
  late: boolean;
  photos: { id: string; url: string }[];
  photoCount: number;
}

export interface HwSummary {
  total: number;
  done: number;
  left: number;
  used: number;
  est: number;
  currentId: string | null;
  nextId: string | null;
  nextAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  allDone: boolean;
}

export interface HwDay {
  day: string;
  today: string;
  /** 服务端的「现在」（北京时间，不带时区） */
  now: string;
  items: HwItem[];
  summary: HwSummary;
  /** 首页打卡：当天清单全做完算打一次卡（只算今天往前，和 day 参数无关） */
  checkin?: HwCheckin;
}

export interface HwCheckin {
  /** 连续打卡天数；今天还没做完不算断，从昨天往前数 */
  streak: number;
  /** 今天打卡了没有 */
  today: boolean;
  /** 本周一到周日 */
  week: { day: string; done: boolean }[];
  weekDone: number;
}

export interface DraftItem {
  key: string;
  title: string;
  subject: HwSubject;
  est: number;
  source: "text" | "voice" | "photo" | "plan";
  planAssignmentId?: string | null;
  teacher?: string;
}

export interface PlanDue {
  assignmentId: string;
  planId: string;
  title: string;
  planName: string;
  subject: Subject | null;
  dueAt: string | null;
  teacher: string;
}

export const HW_SUBJECTS: HwSubject[] = ["chinese", "math", "english", "science", "physics", "chemistry", "biology", "history", "geography", "politics", "other"];
export const hwSubjectLabel = (s: HwSubject) => (s === "other" ? "其他" : SUBJECT_LABEL[s]);
export const tileSubject = (s: HwSubject): Subject | null => (s === "other" ? null : s);

/* ---------------------------------------------------------------- 状态 */

interface State {
  data: HwDay | null;
  /** 拉到清单时的本机时间，用来让秒表接着走 */
  fetchedAt: number;
  loading: boolean;
  draft: DraftItem[];
  planDue: PlanDue[];
  /** 已经看过「到点提醒」的项，不再弹 */
  acked: Record<string, true>;
  set: (data: HwDay) => void;
  setDraft: (draft: DraftItem[], planDue?: PlanDue[]) => void;
  ack: (id: string) => void;
}

const ACK_KEY = "hw.acked";
function loadAcked(): Record<string, true> {
  try {
    return JSON.parse(sessionStorage.getItem(ACK_KEY) || "{}");
  } catch {
    return {};
  }
}

export const useHomework = create<State>((set) => ({
  data: null,
  fetchedAt: 0,
  loading: false,
  draft: [],
  planDue: [],
  acked: loadAcked(),
  set: (data) => set({ data, fetchedAt: Date.now() }),
  setDraft: (draft, planDue) => set((s) => ({ draft, planDue: planDue ?? s.planDue })),
  ack: (id) =>
    set((s) => {
      const acked = { ...s.acked, [id]: true as const };
      try {
        sessionStorage.setItem(ACK_KEY, JSON.stringify(acked));
      } catch {
        /* 存不下就只记在内存里 */
      }
      return { acked };
    }),
}));

const store = () => useHomework.getState();
const apply = (d: HwDay) => {
  store().set(d);
  return d;
};

/* ---------------------------------------------------------------- 接口 */

export async function loadDay(day?: string): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework${day ? `?day=${day}` : ""}`));
}

export async function parseHomework(text: string, images: string[], day?: string): Promise<{ items: DraftItem[]; planDue: PlanDue[] }> {
  const res = await api<{ items: Omit<DraftItem, "key" | "source">[]; planDue: PlanDue[] }>("/api/homework/parse", { method: "POST", body: { text, images, day }, timeoutMs: 120000 });
  const source: DraftItem["source"] = images.length ? "photo" : "text";
  return { items: res.items.map((it) => ({ ...it, key: newKey(), source })), planDue: res.planDue };
}

export async function addItems(items: (Omit<DraftItem, "key"> & { remindAt?: string | null; chain?: boolean })[], day?: string): Promise<HwDay> {
  return apply(await api<HwDay>("/api/homework/items", { method: "POST", body: { day, items } }));
}

export async function updateItem(id: string, patch: Partial<Pick<HwItem, "title" | "subject" | "remindAt" | "chain" | "position">>): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework/items/${id}`, { method: "PATCH", body: patch }));
}

export async function deleteItem(id: string): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework/items/${id}`, { method: "DELETE" }));
}

export async function schedule(from: string | null, day?: string): Promise<HwDay> {
  return apply(await api<HwDay>("/api/homework/schedule", { method: "POST", body: from ? { day, from } : { day, off: true } }));
}

export type HwAction = "start" | "pause" | "resume" | "finish" | "undo" | "snooze" | "skip";
export async function act(id: string, action: HwAction, body?: Record<string, unknown>): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework/items/${id}/${action}`, { method: "POST", body: body ?? {} }));
}

const absolute = (url: string) => (url.startsWith("/") ? `${getApiBase()}${url}` : url);

/** 完成照片：登记 → 直传 → 确认 */
export async function uploadPhotos(id: string, photos: string[]): Promise<HwDay | null> {
  if (!photos.length) return null;
  const { uploads } = await api<{ uploads: { id: string; method: string; url: string; headers?: Record<string, string> }[] }>(`/api/homework/items/${id}/photos`, { method: "POST", body: { count: photos.length } });
  const ok: string[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    const blob = await (await fetch(photos[i])).blob();
    const res = await fetch(absolute(u.url), { method: u.method || "PUT", body: blob, headers: { "Content-Type": "image/jpeg", ...(u.headers ?? {}) } });
    if (res.ok) ok.push(u.id);
  }
  const day = apply(await api<HwDay>(`/api/homework/items/${id}/photos/uploaded`, { method: "POST", body: { ids: ok } }));
  if (ok.length < photos.length) throw new Error(`有 ${photos.length - ok.length} 张照片没传上去`);
  return day;
}

/* ---------------------------------------------------------------- 计算 */

/** 「到点提醒」看过的记号：同一项晚 10 分钟后再自动开始，算新的一次 */
export const alarmKey = (item: HwItem) => `${item.id}@${item.firstStartedAt ?? ""}`;

export const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 现在这一刻的已用秒数（计时中的接着走） */
export function liveUsed(item: HwItem, fetchedAt: number, now = Date.now()): number {
  return item.status === "running" ? item.used + Math.max(0, Math.floor((now - fetchedAt) / 1000)) : item.used;
}

/** 服务端「现在」换算成本机时间轴：本机时间 + 偏差 = 服务端时间（都按北京时间的钟点算） */
export function serverClockOffset(data: HwDay, fetchedAt: number): number {
  return parseLocal(data.now) - fetchedAt;
}

/** 「2026-11-14T18:45:00」按本机时区解析成毫秒（只用来算差值，时区抵消） */
export function parseLocal(iso: string): number {
  const [d, t = "00:00:00"] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, s || 0).getTime();
}

/** 某天某个钟点到现在还有多少毫秒（负数 = 已经过了） */
export function msUntil(data: HwDay, fetchedAt: number, hhmm: string, now = Date.now()): number {
  return parseLocal(`${data.day}T${hhmm}:00`) - (now + serverClockOffset(data, fetchedAt));
}

export const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
};

/** 「22 分 18 秒」 */
export const minSec = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? `${m} 分${s ? ` ${s} 秒` : ""}` : `${s} 秒`;
};

/** 「2 小时 21 分」/「31 分」 */
export const hourMin = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ""}` : `${m} 分`;
};

export const clockOf = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

/** 按学科分组，保持清单顺序（哪一科先出现排前面） */
export function groupBySubject<T extends { subject: HwSubject }>(items: T[]): { subject: HwSubject; items: T[] }[] {
  const groups: { subject: HwSubject; items: T[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.subject === it.subject);
    if (!g) groups.push((g = { subject: it.subject, items: [] }));
    g.items.push(it);
  }
  return groups;
}

/** 清单里排第几项（从 1 开始），按页面上的显示顺序 */
export function orderOf(items: HwItem[], id: string): number {
  const flat = groupBySubject(items).flatMap((g) => g.items);
  return flat.findIndex((it) => it.id === id) + 1;
}

/** 下一项要做的：没做完的里，按显示顺序的第一项（跳过当前这一项） */
export function nextTodo(items: HwItem[], exceptId?: string): HwItem | null {
  const flat = groupBySubject(items).flatMap((g) => g.items);
  return flat.find((it) => it.status !== "done" && it.id !== exceptId) ?? null;
}

/** 「11月14日 周六」 */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const w = "日一二三四五六"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日 周${w}`;
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** 清单右边那颗提醒时间的文字 */
export function remindText(item: HwItem): string {
  if (item.chain) return "接着上一项";
  return item.remindAt ?? "";
}

/* ---------------------------------------------------------------- 计时页的粉笔圆环 */

/** 计时页黑板上粉笔字的三种颜色（和 assets/chalk/num 里烘好的数字一致）：白、超时黄、做完绿 */
export const CHALK = { w: "#ffffff", o: "#ffe08a", g: "#b9f2cf" } as const;
export type ChalkTone = keyof typeof CHALK;

/**
 * 计时页的圆环（232×232）：外圈 60 个刻度（5 分钟一根长的），里面一道淡淡的底，进度是一道粉笔线，头上一颗领带色的点。
 * 超时：整圈变淡，多出来的部分用黄粉笔再画一段。filter 传一个 SVG 滤镜 id 就加粉笔颗粒（App 用；小程序的图片里不加）。
 * App 和小程序各一份，内容保持一致。
 */
export function focusRingSvg(o: { used: number; est: number; paused: boolean; done: boolean; tie: string; filter?: string }): string {
  const C = 116, R = 92, est = Math.max(60, o.est);
  const ratio = o.done ? 1 : Math.min(1, o.used / est);
  const extra = !o.done && o.used > est ? Math.min(1, (o.used - est) / est) : 0;
  const over = extra > 0;
  const at = (a: number, r: number) => [(C + Math.sin(a) * r).toFixed(1), (C - Math.cos(a) * r).toFixed(1)];
  let ticks = "";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, long = i % 5 === 0;
    const [x1, y1] = at(a, 108), [x2, y2] = at(a, long ? 100 : 104);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="${long ? 2.4 : 1.4}" stroke-linecap="round" opacity="${i / 60 < ratio ? 0.75 : 0.28}"/>`;
  }
  const len = 2 * Math.PI * R;
  const arc = (part: number, color: string, op: number) =>
    part > 0 ? `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(len * part).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${C} ${C})" opacity="${op}"/>` : "";
  const knob = (part: number, color: string) => {
    const [x, y] = at(part * Math.PI * 2, R);
    return `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="#fff" stroke-width="2.5"/>`;
  };
  const main = o.done ? CHALK.g : CHALK.w;
  const g = `${ticks}<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#fff" stroke-width="11" opacity=".14"/>` +
    arc(ratio, main, o.paused ? 0.5 : over ? 0.55 : 0.95) + (over ? arc(extra, CHALK.o, 1) : "");
  const tip = o.done || o.paused ? "" : over ? knob(extra, CHALK.o) : knob(ratio, o.tie);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="232" height="232" viewBox="0 0 232 232" fill="none"><g${o.filter ? ` filter="url(#${o.filter})"` : ""}>${g}</g>${tip}</svg>`;
}
