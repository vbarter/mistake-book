import type { CSSProperties } from "react";
import { roleIconInner, type RoleName } from "../lib/roleIcons";
import { useTheme } from "../lib/theme";

/** 角色图标：拿着道具的「试卷小人」（首页四块黑板上用），跟着主题和深浅色换配色。画法在 lib/roleIcons.ts */
export function RoleIcon({ name, size = 88, shadow = true, className, style }: { name: RoleName; size?: number; shadow?: boolean; className?: string; style?: CSSProperties }) {
  const theme = useTheme((s) => s.theme);
  const dark = useTheme((s) => s.dark);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: roleIconInner(name, theme, dark, shadow) }}
    />
  );
}
export type { RoleName };
