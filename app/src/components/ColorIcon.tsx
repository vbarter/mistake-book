import type { CSSProperties } from "react";
import { colorIconInner, type ColorIconName } from "../lib/colorIcons";
import { useTheme } from "../lib/theme";

/** 彩色图标：入口、列表行、状态、空页面用；箭头、关闭这类小操作符号还是用 Icon 的细线图标。跟着主题和深浅色换画法。 */
export function ColorIcon({ name, size = 32, muted = false, className, style }: { name: ColorIconName; size?: number; muted?: boolean; className?: string; style?: CSSProperties }) {
  const theme = useTheme((s) => s.theme);
  const dark = useTheme((s) => s.dark);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0, ...(muted ? { filter: "grayscale(1)", opacity: 0.55 } : null), ...style }}
      dangerouslySetInnerHTML={{ __html: colorIconInner(name, theme, dark) }}
    />
  );
}
export type { ColorIconName };
