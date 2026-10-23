import type { CSSProperties, ReactNode } from "react";
import type { Subject } from "../api/types";
import { SUBJECT_LABEL } from "../lib/format";
import { Icon, type IconName } from "./Icon";

/** 学科方块：圆角色块 + 一个大字符，学生一眼认出是哪一科 */
const TILE: Record<Subject, { glyph: string; color: string; bg: string }> = {
  english: { glyph: "Aa", color: "var(--english)", bg: "var(--english-bg)" },
  math: { glyph: "π", color: "var(--math)", bg: "var(--math-bg)" },
  chinese: { glyph: "文", color: "var(--chinese)", bg: "var(--chinese-bg)" },
  science: { glyph: "⚗", color: "var(--science)", bg: "var(--science-bg)" },
};

export function subjectColors(s: Subject | null | undefined): { color: string; bg: string } {
  return s ? { color: TILE[s].color, bg: TILE[s].bg } : { color: "var(--secondary)", bg: "var(--fill-light)" };
}

export function SubjectTile({ subject, size = "md", style }: { subject: Subject | null | undefined; size?: "lg" | "md" | "sm" | "xs"; style?: CSSProperties }) {
  const t = subject ? TILE[subject] : null;
  return (
    <span className={`tile tile--${size}`} style={{ background: t?.bg ?? "var(--fill-light)", color: t?.color ?? "var(--secondary)", ...style }} aria-label={subject ? SUBJECT_LABEL[subject] : "未分学科"}>
      {t ? (subject === "science" ? <Icon name="sparkles" size={size === "lg" ? 24 : size === "xs" ? 12 : 20} /> : t.glyph) : <Icon name="folder" size={size === "xs" ? 12 : 22} />}
    </span>
  );
}

/** 状态标签：颜色和图标一起变 */
export function Tag({ kind, icon, children, style }: { kind: "wrong" | "correct" | "partial" | "pending" | "info" | "neutral" | "accent"; icon?: IconName; children: ReactNode; style?: CSSProperties }) {
  const defaultIcon: Partial<Record<typeof kind, IconName>> = { wrong: "xmark", correct: "check", partial: "warning", pending: "viewfinder", accent: "sparkles" };
  const name = icon ?? defaultIcon[kind];
  return (
    <span className={`tag tag--${kind}`} style={style}>
      {name && <Icon name={name} size={11} stroke={3} />}
      {children}
    </span>
  );
}

/** 错题进度环：红色是还没订正的，全订正变绿 */
export function WrongRing({ wrong, corrected, size = 48 }: { wrong: number; corrected: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const done = wrong === 0 ? 1 : corrected / wrong;
  const all = wrong > 0 && corrected >= wrong;
  const color = all || wrong === 0 ? "var(--mastered)" : "var(--wrong)";
  const track = all || wrong === 0 ? "var(--mastered-bg)" : "var(--wrong-bg)";
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }} aria-label={`错 ${wrong} 题，已订正 ${corrected}`}>
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
