/** 通用小组件：学科方块、标签、公式文字、空状态、底部面板、分段切换 */
import type { CSSProperties, ReactNode } from "react";
import { Text, View } from "@tarojs/components";
import type { Mark, Subject } from "../lib/types";
import { SUBJECT_LABEL } from "../lib/format";
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
export function SubjectTile({ subject, size = "md", style }: { subject: Subject | null | undefined; size?: "lg" | "md" | "sm" | "xs"; style?: CSSProperties }) {
  const c = subjectColors(subject);
  return (
    <View className={`tile tile--${size}`} style={{ background: c.bg, color: c.color, ...style }}>
      {subject ? SUBJECT_LABEL[subject].slice(0, 1) : "卷"}
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
  if (!open) return null;
  return (
    <View className="sheet" catchMove>
      <View className="sheet__mask" onClick={onClose} />
      <View className="sheet__panel">
        {title && <Text className="sheet__title">{title}</Text>}
        {children}
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
