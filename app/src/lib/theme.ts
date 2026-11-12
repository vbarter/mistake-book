import { create } from "zustand";
import type { ThemeName } from "./colorIcons";

/** 主题：两套配色 + 图标画法，在「我的 → 主题」里切换，选择记在本机。颜色在 styles/tokens.css 里按 html[data-theme] 分。 */
export const THEMES: { id: ThemeName; name: string; note: string; swatch: [string, string, string] }[] = [
  { id: "classic", name: "校园蓝", note: "藏青校服配色，沉稳清楚", swatch: ["#1f3b73", "#a3303f", "#ffb547"] },
  { id: "pop", name: "元气粉", note: "粉蓝配色，图标带小表情", swatch: ["#fb7299", "#00aeec", "#ffc53d"] },
];
const KEY = "zcb.theme";

function saved(): ThemeName {
  try {
    return localStorage.getItem(KEY) === "pop" ? "pop" : "classic";
  } catch {
    return "classic";
  }
}
const scheme = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const apply = (t: ThemeName) => { document.documentElement.dataset.theme = t; };

interface ThemeState { theme: ThemeName; dark: boolean; setTheme: (t: ThemeName) => void }
export const useTheme = create<ThemeState>((set) => ({
  theme: saved(),
  dark: !!scheme?.matches,
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* 存不下也照样换，只是下次打开回到默认 */ }
    apply(theme);
    set({ theme });
  },
}));
apply(useTheme.getState().theme);
scheme?.addEventListener?.("change", (e) => useTheme.setState({ dark: e.matches }));
