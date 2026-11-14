/** 今天作业计划（待办事项），和 App 的 lib/homework.ts 同一套接口和算法。服务端见 server/app/routes/homework.py。
 *
 * 小程序几个页面之间共享一份清单：放在模块里，页面用 useHomework() 订阅。wx.request 没有 PATCH，改清单项用 PUT。
 */
import Taro from "@tarojs/taro";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { SUBJECT_LABEL } from "./format";
import type { Subject } from "./types";

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
  used: number;
  startedAt: string | null;
  firstStartedAt: string | null;
  autoStarted: boolean;
  finishedAt: string | null;
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

/* ---------------------------------------------------------------- 共享状态 */

interface State {
  data: HwDay | null;
  fetchedAt: number;
  draft: DraftItem[];
  planDue: PlanDue[];
  acked: Record<string, true>;
}
let state: State = { data: null, fetchedAt: 0, draft: [], planDue: [], acked: {} };
const listeners = new Set<() => void>();
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const hwState = () => state;
export function useHomework(): State {
  return useSyncExternalStore(subscribe, hwState, hwState);
}
export const setDraft = (draft: DraftItem[], planDue?: PlanDue[]) => emit({ draft, planDue: planDue ?? state.planDue });
export const ack = (key: string) => emit({ acked: { ...state.acked, [key]: true } });
const apply = (data: HwDay) => {
  emit({ data, fetchedAt: Date.now() });
  return data;
};

/* ---------------------------------------------------------------- 接口 */

export async function loadDay(day?: string): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework${day ? `?day=${day}` : ""}`));
}

export async function parseHomework(text: string, imagePaths: string[], day?: string): Promise<{ items: DraftItem[]; planDue: PlanDue[] }> {
  const images: string[] = [];
  for (const p of imagePaths) {
    let path = p;
    try {
      path = (await Taro.compressImage({ src: p, quality: 80, compressedWidth: 1568 } as Taro.compressImage.Option)).tempFilePath || p;
    } catch {
      /* 压不了就传原图 */
    }
    images.push(`data:image/jpeg;base64,${Taro.getFileSystemManager().readFileSync(path, "base64") as string}`);
  }
  const res = await api<{ items: Omit<DraftItem, "key" | "source">[]; planDue: PlanDue[] }>("/api/homework/parse", { method: "POST", body: { text, images, day }, timeoutMs: 120000 });
  const source: DraftItem["source"] = images.length ? "photo" : "text";
  return { items: res.items.map((it) => ({ ...it, key: newKey(), source })), planDue: res.planDue };
}

export async function addItems(items: (Omit<DraftItem, "key"> & { remindAt?: string | null; chain?: boolean })[], day?: string): Promise<HwDay> {
  return apply(await api<HwDay>("/api/homework/items", { method: "POST", body: { day, items } }));
}

export async function updateItem(id: string, patch: Partial<Pick<HwItem, "title" | "subject" | "remindAt" | "chain" | "position">>): Promise<HwDay> {
  return apply(await api<HwDay>(`/api/homework/items/${id}`, { method: "PUT", body: patch }));
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

/** 完成照片：登记 → 直传 → 确认 */
export async function uploadPhotos(id: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { uploads } = await api<{ uploads: { id: string; method: string; url: string; headers?: Record<string, string> }[] }>(`/api/homework/items/${id}/photos`, { method: "POST", body: { count: paths.length } });
  const ok: string[] = [];
  const fs = Taro.getFileSystemManager();
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    let path = paths[i];
    try {
      path = (await Taro.compressImage({ src: path, quality: 80, compressedWidth: 1600 } as Taro.compressImage.Option)).tempFilePath || path;
    } catch {
      /* 原图 */
    }
    const data = fs.readFileSync(path) as ArrayBuffer;
    try {
      const res = await Taro.request({ url: u.url.startsWith("/") ? `${API_BASE}${u.url}` : u.url, method: "PUT", data, header: { "Content-Type": "image/jpeg", ...(u.headers ?? {}) }, timeout: 120000 });
      if (res.statusCode >= 200 && res.statusCode < 300) ok.push(u.id);
    } catch {
      /* 这张没传上去 */
    }
  }
  apply(await api<HwDay>(`/api/homework/items/${id}/photos/uploaded`, { method: "POST", body: { ids: ok } }));
  if (ok.length < paths.length) throw new Error(`有 ${paths.length - ok.length} 张照片没传上去`);
}

/* ---------------------------------------------------------------- 计算（和 App 一致） */

export const alarmKey = (item: HwItem) => `${item.id}@${item.firstStartedAt ?? ""}`;
export const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function liveUsed(item: HwItem, fetchedAt: number, now = Date.now()): number {
  return item.status === "running" ? item.used + Math.max(0, Math.floor((now - fetchedAt) / 1000)) : item.used;
}

export function parseLocal(iso: string): number {
  const [d, t = "00:00:00"] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, s || 0).getTime();
}
export const serverClockOffset = (data: HwDay, fetchedAt: number) => parseLocal(data.now) - fetchedAt;
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
export const minSec = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? `${m} 分${s ? ` ${s} 秒` : ""}` : `${s} 秒`;
};
export const hourMin = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ""}` : `${m} 分`;
};
export const clockOf = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

export function groupBySubject<T extends { subject: HwSubject }>(items: T[]): { subject: HwSubject; items: T[] }[] {
  const groups: { subject: HwSubject; items: T[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.subject === it.subject);
    if (!g) groups.push((g = { subject: it.subject, items: [] }));
    g.items.push(it);
  }
  return groups;
}
export function orderOf(items: HwItem[], id: string): number {
  return groupBySubject(items).flatMap((g) => g.items).findIndex((it) => it.id === id) + 1;
}
export function nextTodo(items: HwItem[], exceptId?: string): HwItem | null {
  return groupBySubject(items).flatMap((g) => g.items).find((it) => it.status !== "done" && it.id !== exceptId) ?? null;
}
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}月${d}日 周${"日一二三四五六"[new Date(y, m - 1, d).getDay()]}`;
}
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
/** 现在往后取整到 5 分钟，再加 5 分钟 */
export function defaultStart(serverNow: string): string {
  const [h, m] = serverNow.slice(11, 16).split(":").map(Number);
  const mins = Math.min(23 * 60 + 55, Math.ceil((h * 60 + m + 5) / 5) * 5);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
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
