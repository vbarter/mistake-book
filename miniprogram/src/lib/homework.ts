/** 待办事项，服务端见 server/app/routes/homework.py（和 App 的「今天作业计划」同一张表、同一套计时接口）。
 *
 * 小程序 1.13 起不分天：没做完的都在「待办」，做完的就是「已归档」，可以重新打开。不设提醒、不排时间。
 * 界面稿在项目文件 screenshots/todo-simplify-v4/。
 * 几个页面之间共享一份清单：放在模块里，页面用 useHomework() 订阅。wx.request 没有 PATCH，改清单项用 PUT。
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
  /** 哪一天加的（北京时间 YYYY-MM-DD） */
  day: string;
  title: string;
  subject: HwSubject;
  position: number;
  source: string;
  status: HwStatus;
  /** 已用秒数（拿到数据那一刻） */
  used: number;
  startedAt: string | null;
  firstStartedAt: string | null;
  finishedAt: string | null;
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

export interface HwTodos {
  today: string;
  now: string;
  /** 没做完的：新加的那天在前 */
  todo: HwItem[];
  /** 已归档的：刚做完的在前，最多最近 200 项 */
  archived: HwItem[];
  archivedTotal: number;
  /** 首页打卡：某天加的事项全做完算打一次卡 */
  checkin?: HwCheckin;
  /** 加入时：文字和已有的一样、合并掉没加的有几项，是哪几项 */
  merged?: number;
  mergedTitles?: string[];
}

export interface DraftItem {
  title: string;
  subject: HwSubject;
  est?: number;
  source: "text" | "photo";
}

export const HW_SUBJECTS: HwSubject[] = ["chinese", "math", "english", "science", "physics", "chemistry", "biology", "history", "geography", "politics", "other"];
export const hwSubjectLabel = (s: HwSubject) => (s === "other" ? "其他" : SUBJECT_LABEL[s]);
export const tileSubject = (s: HwSubject): Subject | null => (s === "other" ? null : s);

/* ---------------------------------------------------------------- 共享状态 */

interface State {
  data: HwTodos | null;
  fetchedAt: number;
}
let state: State = { data: null, fetchedAt: 0 };
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
const apply = (data: HwTodos) => {
  emit({ data, fetchedAt: Date.now() });
  return data;
};
const V = "view=todos";

/* ---------------------------------------------------------------- 接口 */

export async function loadTodos(): Promise<HwTodos> {
  return apply(await api<HwTodos>("/api/homework/todos"));
}

/** 从微信聊天里选的文件（PDF、Word）：服务端取出文字再拆 */
export interface PickedFile {
  path: string;
  name: string;
}

/** 把照片、文件拆成一项一项（不落库）。照片先压到 1568 宽 */
export async function parseHomework(imagePaths: string[], files: PickedFile[] = []): Promise<DraftItem[]> {
  const fs = Taro.getFileSystemManager();
  const images: string[] = [];
  for (const p of imagePaths) {
    let path = p;
    try {
      path = (await Taro.compressImage({ src: p, quality: 80, compressedWidth: 1568 } as Taro.compressImage.Option)).tempFilePath || p;
    } catch {
      /* 压不了就传原图 */
    }
    images.push(`data:image/jpeg;base64,${fs.readFileSync(path, "base64") as string}`);
  }
  const docs = files.map((f) => ({ name: f.name, data: fs.readFileSync(f.path, "base64") as string }));
  const res = await api<{ items: Omit<DraftItem, "source">[] }>("/api/homework/parse", { method: "POST", body: { text: "", images, files: docs }, timeoutMs: 120000 });
  const source: DraftItem["source"] = images.length ? "photo" : "text";
  return res.items.map((it) => ({ title: it.title, subject: it.subject, est: it.est, source }));
}

export async function addItems(items: DraftItem[]): Promise<HwTodos> {
  return apply(await api<HwTodos>(`/api/homework/items?${V}`, { method: "POST", body: { items } }));
}

export async function updateItem(id: string, patch: Partial<Pick<HwItem, "title" | "subject">>): Promise<HwTodos> {
  return apply(await api<HwTodos>(`/api/homework/items/${id}?${V}`, { method: "PUT", body: patch }));
}

export async function deleteItem(id: string): Promise<HwTodos> {
  return apply(await api<HwTodos>(`/api/homework/items/${id}?${V}`, { method: "DELETE" }));
}

/** start 开始计时 · pause 暂停 · resume 继续 · finish 完成并归档 · undo 重新打开 */
export type HwAction = "start" | "pause" | "resume" | "finish" | "undo";
export async function act(id: string, action: HwAction): Promise<HwTodos> {
  return apply(await api<HwTodos>(`/api/homework/items/${id}/${action}?${V}`, { method: "POST", body: {} }));
}

/* ---------------------------------------------------------------- 计算 */

export function liveUsed(item: HwItem, fetchedAt: number, now = Date.now()): number {
  return item.status === "running" ? item.used + Math.max(0, Math.floor((now - fetchedAt) / 1000)) : item.used;
}

export const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
};
/** 「18 分」「1 小时 5 分」；不到一分钟算 1 分 */
export const hourMin = (sec: number) => {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ""}` : `${m} 分`;
};
export const clockOf = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}月${d}日 周${"日一二三四五六"[new Date(y, m - 1, d).getDay()]}`;
}

/** 待办按哪天加的分两段：今天添加 / 更早 */
export function splitTodo(items: HwItem[], today: string): { key: string; label: string; note: string; items: HwItem[] }[] {
  const now = items.filter((it) => it.day >= today);
  const old = items.filter((it) => it.day < today);
  return [
    { key: "today", label: "今天添加", note: dayLabel(today), items: now },
    { key: "old", label: "更早", note: "", items: old },
  ].filter((g) => g.items.length);
}

/** 已归档按哪天做完的分三段：今天 / 昨天 / 更早 */
export function splitArchived(items: HwItem[], today: string): { key: string; label: string; items: HwItem[] }[] {
  const yesterday = shiftDay(today, -1);
  const dayOf = (it: HwItem) => (it.finishedAt ?? "").slice(0, 10);
  return [
    { key: "today", label: "今天", items: items.filter((it) => dayOf(it) >= today) },
    { key: "yesterday", label: "昨天", items: items.filter((it) => dayOf(it) === yesterday) },
    { key: "old", label: "更早", items: items.filter((it) => dayOf(it) < yesterday) },
  ].filter((g) => g.items.length);
}

/** 归档列表里「19:22 完成」「昨天 20:15 完成」「11月12日 完成」 */
export function finishedLabel(item: HwItem, today: string): string {
  const at = item.finishedAt;
  if (!at) return "已完成";
  const day = at.slice(0, 10);
  if (day >= today) return `${clockOf(at)} 完成`;
  if (day === shiftDay(today, -1)) return `昨天 ${clockOf(at)} 完成`;
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日 完成`;
}

/** 首页、列表要找「正在做的那一项」：计时中的优先，其次暂停的 */
export const currentItem = (items: HwItem[]) => items.find((it) => it.status === "running") ?? items.find((it) => it.status === "paused") ?? null;

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

/* ---------------------------------------------------------------- 提示 */

/** 加入后的提示：「已合并 2 项重复：复习、英语拓学单」 */
export const mergedText = (d: { merged?: number; mergedTitles?: string[] }) =>
  d.merged ? `已合并 ${d.merged} 项重复：${[...new Set(d.mergedTitles ?? [])].slice(0, 3).join("、")}${(d.mergedTitles?.length ?? 0) > 3 ? " 等" : ""}` : "";
