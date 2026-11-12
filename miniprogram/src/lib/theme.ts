/**
 * 主题：两套配色 + 图标画法，在「我的 → 主题」里切换，选择记在本机，默认校园蓝。
 * - 样式里的品牌色是 CSS 变量（app.scss 顶部 page{} 定义校园蓝，.theme-pop 换成元气粉），每个页面的根节点带上 useThemeClass() 给的类名。
 * - JS 里用的颜色（图标、插画、内联样式）读这里的 C，切主题时原地换值。和 App 的 tokens.css 同一套值。
 */
import Taro from "@tarojs/taro";
import { useSyncExternalStore } from "react";
import type { ThemeName } from "./colorIcons";

const BASE = {
  label: "#1c1c1e",
  secondary: "#5b5b63",
  tertiary: "#8e8e93",
  separator: "#d1d1d6",
  fillLight: "#f2f2f7",
  bg: "#f3f4f8",
  card: "#ffffff",
  wrong: "#b42323",
  wrongBg: "#fbe9e9",
  ok: "#1e7a47",
  okBg: "#e3f5ea",
  accent: "#ff8a3d",
  accentBg: "#fff0e3",
  accentOn: "#b35300",
};
const BRAND: Record<ThemeName, { brand: string; brandSolid: string; brandTint: string; tie: string; tieBg: string }> = {
  classic: { brand: "#1f3b73", brandSolid: "#1f3b73", brandTint: "#e6ebf5", tie: "#a3303f", tieBg: "#f8e6e8" },
  pop: { brand: "#e8477c", brandSolid: "#f4608f", brandTint: "#ffe9f0", tie: "#0095c8", tieBg: "#dff5fd" },
};
/** 插画「试卷小人」的颜色 */
const ILL: Record<ThemeName, { paper2: string; line: string; ink: string; tie: string; star: string; shadow: string }> = {
  classic: { paper2: "#dbe2f0", line: "#1f3b73", ink: "#1f2a44", tie: "#a3303f", star: "#e0b252", shadow: "rgba(31,42,68,0.12)" },
  pop: { paper2: "#ffd6e2", line: "#f4608f", ink: "#4a2a36", tie: "#00aeec", star: "#ffc53d", shadow: "rgba(120,40,70,0.12)" },
};

export const THEMES: { id: ThemeName; name: string; note: string; swatch: string }[] = [
  { id: "classic", name: "校园蓝", note: "藏青校服配色，沉稳清楚", swatch: "#1f3b73" },
  { id: "pop", name: "元气粉", note: "粉蓝配色，图标带小表情", swatch: "#fb7299" },
];
const KEY = "zcb.theme";

function saved(): ThemeName {
  try {
    return Taro.getStorageSync(KEY) === "pop" ? "pop" : "classic";
  } catch {
    return "classic";
  }
}
let current: ThemeName = saved();
export const C = { ...BASE, ...BRAND[current] };
export const ILLUST = { ...ILL[current] };

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
export const getTheme = (): ThemeName => current;
export function onThemeChange(fn: () => void): () => void {
  return subscribe(fn);
}
export function setTheme(t: ThemeName) {
  if (t === current) return;
  current = t;
  Object.assign(C, BRAND[t]);
  Object.assign(ILLUST, ILL[t]);
  try { Taro.setStorageSync(KEY, t); } catch { /* 存不下也照样换，只是下次打开回到默认 */ }
  listeners.forEach((fn) => fn());
}
/** 当前主题；切换时用到它的组件会重画 */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
export const themeClass = (t: ThemeName = current): string => (t === "pop" ? " theme-pop" : "");
/** 页面根节点追加的类名（前面带空格）：`className={"page" + tc}` */
export function useThemeClass(): string {
  return themeClass(useTheme());
}
