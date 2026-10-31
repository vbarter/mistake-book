/** 通用小组件：学科方块、标签、公式文字、空状态、底部面板、分段切换 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Taro from "@tarojs/taro";
import { Icon, type IconName } from "./Icon";
import { ScrollView, Text, View } from "@tarojs/components";
import type { Mark, Subject } from "../lib/types";
import { toSegments } from "../lib/math";

export const SUBJECT_COLOR: Record<Subject, { color: string; bg: string }> = {
  math: { color: "#2f6fed", bg: "#e6eefb" },
  chinese: { color: "#9a3a1e", bg: "#fbe9e3" },
  english: { color: "#5b37a8", bg: "#efe8fb" },
  science: { color: "#0b6b6b", bg: "#ddf3f3" },
  physics: { color: "#1f55c4", bg: "#e3ebfb" },
  chemistry: { color: "#0e7c5c", bg: "#ddf5ea" },
  biology: { color: "#4d7c0f", bg: "#ecf7dc" },
  history: { color: "#8a4b00", bg: "#fff0e3" },
  geography: { color: "#0369a1", bg: "#e0f2fe" },
  politics: { color: "#b42323", bg: "#fbe9e9" },
};

export const subjectColors = (s: Subject | null | undefined) => (s ? SUBJECT_COLOR[s] : { color: "#5b5b63", bg: "#f2f2f7" });

/** 学科方块：色块 + 学科首字 */
/** 学科图标（和 App 的 SubjectTile 一致） */
const SUBJECT_ICON: Record<Subject, IconName> = { english: "bubble", math: "calculator", chinese: "brush", science: "flask", physics: "atom", chemistry: "tube", biology: "leaf", history: "scroll", geography: "map", politics: "scales" };
const TILE_ICON_SIZE = { lg: 28, md: 26, sm: 20, xs: 13 } as const;

export function SubjectTile({ subject, size = "md", style }: { subject: Subject | null | undefined; size?: "lg" | "md" | "sm" | "xs"; style?: CSSProperties }) {
  const c = subjectColors(subject);
  return (
    <View className={`tile tile--${size}`} style={{ background: c.bg, ...style }}>
      <Icon name={subject ? SUBJECT_ICON[subject] : "folder"} size={TILE_ICON_SIZE[size]} color={c.color} stroke={size === "xs" ? 2.4 : 2} />
    </View>
  );
}

/** 设置行（和 App 的 Row 一致）：彩色方块图标 + 标题 + 右侧值 + 箭头 */
export function Row({ icon, iconBg, title, value, chevron = true, danger, onClick }: { icon: IconName; iconBg: string; title: string; value?: ReactNode; chevron?: boolean; danger?: boolean; onClick?: () => void }) {
  return (
    <View className="prow" hoverClass={onClick ? "prow--pressed" : "none"} onClick={onClick}>
      <View className="prow__icon" style={{ background: iconBg }}>
        <Icon name={icon} size={18} color="#ffffff" stroke={2} />
      </View>
      <Text className={`prow__title${danger ? " c-wrong" : ""}`}>{title}</Text>
      <View className="prow__value">
        {typeof value === "string" ? <Text>{value}</Text> : value}
        {chevron && <Icon name="chevron-right" size={14} color="#8e8e93" stroke={2.4} />}
      </View>
    </View>
  );
}

export type TagKind = "wrong" | "pending" | "correct" | "neutral" | "info" | "partial" | "accent";

export function Tag({ kind = "neutral", children, style }: { kind?: TagKind; children: ReactNode; style?: CSSProperties }) {
  return (
    <View className={`tag tag--${kind}`} style={style}>
      {children}
    </View>
  );
}

/** 识别出的文字：公式换成可读文字，看不清的字显示红色「未识别」，换行保留 */
export function MathText({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  return (
    <Text className={className} style={style} userSelect>
      {toSegments(text).map((s, i) =>
        s.unrec ? (
          <Text key={i} className="unrec">
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <View className="empty">
      <Text className="empty__title">{title}</Text>
      {text && <Text className="empty__text">{text}</Text>}
      {children}
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <View className="hint">{children}</View>;
}

/** 底部弹出面板 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  // 输入框在 fixed 面板 + ScrollView 里时，微信自带的「上推页面」(adjust-position) 不可靠，面板会被键盘盖住。
  // 面板里的 Input 一律 adjustPosition={false}，由这里按键盘高度把面板整块抬到键盘上方。
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onChange = (res: { height: number }) => setKb(Math.max(0, res.height || 0));
    Taro.onKeyboardHeightChange(onChange);
    return () => {
      Taro.offKeyboardHeightChange?.(onChange);
      setKb(0);
    };
  }, [open]);
  if (!open) return null;
  return (
    // catchMove 挡住背后页面跟着滚；面板里的内容放进 ScrollView，内容多时自己滚（catchMove 会拦掉普通 View 的滚动）
    <View className="sheet" catchMove>
      <View className="sheet__mask" onClick={onClose} />
      <View className={`sheet__panel${kb ? " sheet__panel--kb" : ""}`} style={kb ? { bottom: `${kb}px` } : undefined}>
        {title && <Text className="sheet__title">{title}</Text>}
        <ScrollView scrollY className="sheet__body" enhanced showScrollbar={false}>
          <View className="sheet__content">{children}</View>
        </ScrollView>
      </View>
    </View>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: NoInfer<T>) => void; options: { value: NoInfer<T>; label: string }[] }) {
  return (
    <View className="seg">
      {options.map((o) => (
        <View key={o.value} className={`seg__item${o.value === value ? " on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </View>
      ))}
    </View>
  );
}

/** 判定：对 ✅、错 ❌ */
export function Verdict({ mark, student, grading }: { mark: Mark; student: string; grading?: boolean }) {
  const blank = !student.trim() || student.trim() === "未作答";
  if (mark === "unmarked" && grading && !blank && !/^[□\s]+$/.test(student)) return <Tag kind="info">批改中</Tag>;
  if (mark === "blank" || blank) return <Tag kind="pending">未作答</Tag>;
  if (mark === "unmarked" && /^[□\s,，.。]+$/.test(student)) return <Tag kind="pending">看不清</Tag>;
  if (mark === "correct") return <Text className="verdict">✅</Text>;
  if (mark === "wrong") return <Text className="verdict">❌</Text>;
  if (mark === "partial") return <Tag kind="partial">半对</Tag>;
  return <Tag kind="neutral">未批改</Tag>;
}

export type ErrorFilter = "all" | "wrong" | "blank";

export function applyErrorFilter<T extends { kind: string }>(items: T[], f: ErrorFilter): T[] {
  if (f === "all") return items;
  if (f === "blank") return items.filter((i) => i.kind === "未作答");
  return items.filter((i) => i.kind !== "未作答");
}

/** 答错 / 未作答 两个可点标签，点一下只看这一类，再点取消 */
export function ErrorFilterTags({ value, onChange, counts }: { value: ErrorFilter; onChange: (v: ErrorFilter) => void; counts: { wrong: number; blank: number } }) {
  return (
    <View className="row-wrap">
      <View className={`chip${value === "wrong" ? " chip--wrong-on" : ""}`} onClick={() => onChange(value === "wrong" ? "all" : "wrong")}>
        答错 {counts.wrong}
      </View>
      <View className={`chip${value === "blank" ? " chip--blank-on" : ""}`} onClick={() => onChange(value === "blank" ? "all" : "blank")}>
        未作答 {counts.blank}
      </View>
    </View>
  );
}

/** 错题数圆环 */
export function WrongRing({ wrong }: { wrong: number }) {
  return (
    <View className={`ring${wrong === 0 ? " ring--ok" : ""}`}>
      <Text className="ring__num">{wrong}</Text>
      <Text className="ring__label">错题</Text>
    </View>
  );
}
