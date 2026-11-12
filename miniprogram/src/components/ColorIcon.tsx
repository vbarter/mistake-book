/** 彩色图标（和 App 的 components/ColorIcon.tsx 同一套画法，lib/colorIcons.ts）：小程序里画成 SVG 图片，跟着主题换。
 *  入口、列表行、状态、空页面用；箭头、关闭这类小操作符号还是用 Icon 的细线图标。 */
import { Image } from "@tarojs/components";
import type { CSSProperties } from "react";
import { colorIconSvg, type ColorIconName, type ThemeName } from "../lib/colorIcons";
import { useTheme } from "../lib/theme";
import { base64 } from "./Icon";

const cache = new Map<string, string>();
export function colorIconUri(name: ColorIconName, theme: ThemeName): string {
  const key = `${theme}|${name}`;
  let u = cache.get(key);
  if (!u) {
    // 图标里没有中文，都是 ASCII，可以直接用 Icon 里那个最简单的 base64
    u = `data:image/svg+xml;base64,${base64(colorIconSvg(name, theme).replace("<svg ", '<svg width="96" height="96" '))}`;
    cache.set(key, u);
  }
  return u;
}

export function ColorIcon({ name, size = 32, muted = false, theme, style, className }: { name: ColorIconName; size?: number; muted?: boolean; /** 不跟当前主题、固定画某一套（主题预览用） */ theme?: ThemeName; style?: CSSProperties; className?: string }) {
  const current = useTheme();
  return <Image className={className} src={colorIconUri(name, theme ?? current)} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px`, flexShrink: 0, ...(muted ? { filter: "grayscale(1)", opacity: 0.55 } : null), ...style }} />;
}
export type { ColorIconName };
