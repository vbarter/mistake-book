import type { CSSProperties, ReactNode } from "react";
import type { Subject } from "../api/types";
import { SUBJECT_LABEL } from "../lib/format";
import { Icon, type IconName } from "./Icon";

/** 学科方块：圆角色块 + 一个大字符，学生一眼认出是哪一科 */
const TILE: Record<Subject, { icon: IconName; color: string; bg: string }> = {
  english: { icon: "bubble", color: "var(--english)", bg: "var(--english-bg)" },
  math: { icon: "calculator", color: "var(--math)", bg: "var(--math-bg)" },
  chinese: { icon: "brush", color: "var(--chinese)", bg: "var(--chinese-bg)" },
  science: { icon: "flask", color: "var(--science)", bg: "var(--science-bg)" },
  physics: { icon: "atom", color: "var(--physics)", bg: "var(--physics-bg)" },
  chemistry: { icon: "tube", color: "var(--chemistry)", bg: "var(--chemistry-bg)" },
  biology: { icon: "leaf", color: "var(--biology)", bg: "var(--biology-bg)" },
  history: { icon: "scroll", color: "var(--history)", bg: "var(--history-bg)" },
  geography: { icon: "map", color: "var(--geography)", bg: "var(--geography-bg)" },
  politics: { icon: "scales", color: "var(--politics)", bg: "var(--politics-bg)" },
};
const TILE_ICON_SIZE = { lg: 28, md: 26, sm: 20, xs: 13 } as const;

/** 文件夹里有多科时叠放两个小方块 */
export function SubjectStack({ subjects, size = "md" }: { subjects: Subject[]; size?: "md" | "sm" }) {
  if (subjects.length <= 1) return <SubjectTile subject={subjects[0] ?? null} size={size} />;
  const big = size === "md" ? 52 : 38;
  return (
    <span style={{ position: "relative", width: big, height: big, flexShrink: 0, display: "inline-block" }} aria-label={subjects.map((s) => SUBJECT_LABEL[s]).join("、")}>
      <SubjectTile subject={subjects[1]} size="sm" style={{ position: "absolute", right: 0, bottom: 0, width: big * 0.72, height: big * 0.72, fontSize: big * 0.3 }} />
      <SubjectTile subject={subjects[0]} size="sm" style={{ position: "absolute", left: 0, top: 0, width: big * 0.72, height: big * 0.72, fontSize: big * 0.3, boxShadow: "0 0 0 2px var(--card)" }} />
    </span>
  );
}

export function subjectColors(s: Subject | null | undefined): { color: string; bg: string } {
  return s ? { color: TILE[s].color, bg: TILE[s].bg } : { color: "var(--secondary)", bg: "var(--fill-light)" };
}

export function SubjectTile({ subject, size = "md", style }: { subject: Subject | null | undefined; size?: "lg" | "md" | "sm" | "xs"; style?: CSSProperties }) {
  const t = subject ? TILE[subject] : null;
  return (
    <span className={`tile tile--${size}`} style={{ background: t?.bg ?? "var(--fill-light)", color: t?.color ?? "var(--secondary)", ...style }} aria-label={subject ? SUBJECT_LABEL[subject] : "未分学科"}>
      <Icon name={t ? t.icon : "folder"} size={TILE_ICON_SIZE[size]} stroke={size === "xs" ? 2.4 : 2} />
    </span>
  );
}

/** 状态标签：颜色和图标一起变 */
export function Tag({ kind, icon, children, style }: { kind: "wrong" | "correct" | "partial" | "pending" | "info" | "neutral" | "accent"; icon?: IconName; children: ReactNode; style?: CSSProperties }) {
  const defaultIcon: Partial<Record<typeof kind, IconName>> = { wrong: "xmark", correct: "check", partial: "warning", pending: "viewfinder" };
  const name = icon ?? defaultIcon[kind];
  return (
    <span className={`tag tag--${kind}`} style={style}>
      {name && <Icon name={name} size={11} stroke={3} />}
      {children}
    </span>
  );
}

/** 错题数小圆环：有错题是红色，没有错题是绿色 */
export function WrongRing({ wrong, size = 48 }: { wrong: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const done = 1;
  const all = false;
  const color = wrong === 0 ? "var(--mastered)" : "var(--wrong)";
  const track = wrong === 0 ? "var(--mastered-bg)" : "var(--wrong-bg)";
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }} aria-label={`错 ${wrong} 题`}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * Math.max(0.02, done)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        {all && wrong > 0 ? (
          <Icon name="check" size={18} stroke={3} style={{ color }} />
        ) : (
          <>
            <span className="num" style={{ fontSize: 14, fontWeight: 800, color }}>{wrong}</span>
            <span style={{ fontSize: 9, color: "var(--tertiary)", marginTop: 2 }}>错题</span>
          </>
        )}
      </span>
    </span>
  );
}

/** 知识点图标：按名称粗略匹配，没有就用默认 */
export function knowledgeIcon(name: string): IconName {
  if (/构词|词形|词性|单词|词汇/.test(name)) return "letters";
  if (/句型|转换|疑问|被动|从句/.test(name)) return "arrows";
  if (/阅读|短文|完形|理解|语文|古诗/.test(name)) return "book";
  if (/时态|过去|现在|将来/.test(name)) return "clock";
  if (/几何|图形|三角|圆/.test(name)) return "target";
  if (/方程|代数|计算|数与|分数|小数/.test(name)) return "chart";
  if (/写作|作文|造句/.test(name)) return "pencil";
  return "brain";
}

export function KnowledgeIcon({ name, subject }: { name: string; subject?: Subject }) {
  const c = subjectColors(subject);
  return (
    <span className="tile tile--sm" style={{ background: c.bg, color: c.color }}>
      <Icon name={knowledgeIcon(name)} size={20} stroke={2} />
    </span>
  );
}

export function Stat({ label, value, icon, color }: { label: string; value: ReactNode; icon: IconName; color?: string }) {
  return (
    <div className="stat">
      <span className="stat__label" style={color ? { color } : undefined}>
        <Icon name={icon} size={13} stroke={2.4} />
        {label}
      </span>
      <span className="stat__value num" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

/** 带图标的分段控件 */
export function IconSegmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon: IconName }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg seg--icons" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={`seg__item${o.value === value ? " on" : ""}`} onClick={() => onChange(o.value)}>
          <Icon name={o.icon} size={15} stroke={2.2} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Hint({ icon = "info", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px 0" }}>
      <Icon name={icon} size={24} stroke={1.8} style={{ color: "var(--tertiary)", flexShrink: 0 }} />
      <span className="t-foot c-sec" style={{ lineHeight: "18px" }}>{children}</span>
    </div>
  );
}

export type ErrorFilter = "all" | "wrong" | "blank";

/** 错题列表上方的两个可点标签：答错 / 未作答，点一下只看这一类，再点取消 */
export function ErrorFilterTags({ value, onChange, counts }: { value: ErrorFilter; onChange: (v: ErrorFilter) => void; counts: { wrong: number; blank: number } }) {
  const items: { key: Exclude<ErrorFilter, "all">; label: string; kind: "wrong" | "pending"; icon: IconName; count: number }[] = [
    { key: "wrong", label: "答错", kind: "wrong", icon: "xmark", count: counts.wrong },
    { key: "blank", label: "未作答", kind: "pending", icon: "alert", count: counts.blank },
  ];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="筛选">
      {items.map((it) => {
        const on = value === it.key;
        return (
          <button key={it.key} className={`tag tag--${it.kind}`} aria-pressed={on} onClick={() => onChange(on ? "all" : it.key)} style={{ height: 30, padding: "0 11px", fontSize: 13, border: `1.5px solid ${on ? "currentColor" : "transparent"}`, opacity: value !== "all" && !on ? 0.55 : 1 }}>
            <Icon name={it.icon} size={12} stroke={3} />
            {it.label} {it.count}
          </button>
        );
      })}
    </div>
  );
}

export function applyErrorFilter<T extends { kind: string }>(items: T[], f: ErrorFilter): T[] {
  if (f === "all") return items;
  if (f === "blank") return items.filter((i) => i.kind === "未作答");
  return items.filter((i) => i.kind !== "未作答");
}
