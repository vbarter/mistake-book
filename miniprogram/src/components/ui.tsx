/** 通用小组件（和 App 的 components/ui.tsx、v2.tsx 一一对应）：学科方块、状态标签、按钮、底部面板、分段切换、统计格、顶栏… */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Taro from "@tarojs/taro";
import { Button as NativeButton, Image, ScrollView, Text, View } from "@tarojs/components";
import { Icon, type IconName } from "./Icon";
import type { Mark, Subject } from "../lib/types";
import { toSegments } from "../lib/math";
import { SUBJECT_LABEL } from "../lib/format";
import { C } from "../lib/theme";
import { avatarFallback, avatarId, avatarSrc } from "../lib/avatarCache";

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

export const subjectColors = (s: Subject | null | undefined) => (s ? SUBJECT_COLOR[s] : { color: C.secondary, bg: C.fillLight });

/** 学科图标（和 App 的 SubjectTile 一致） */
const SUBJECT_ICON: Record<Subject, IconName> = { english: "bubble", math: "calculator", chinese: "brush", science: "flask", physics: "atom", chemistry: "tube", biology: "leaf", history: "scroll", geography: "map", politics: "scales" };
const TILE_ICON_SIZE = { lg: 28, md: 26, sm: 20, xs: 13 } as const;

/** 学科方块：圆角色块 + 学科图标 */
export function SubjectTile({ subject, size = "md", style, className }: { subject: Subject | null | undefined; size?: "lg" | "md" | "sm" | "xs"; style?: CSSProperties; className?: string }) {
  const c = subjectColors(subject);
  return (
    <View className={`tile tile--${size}${className ? ` ${className}` : ""}`} style={{ background: c.bg, ...style }}>
      <Icon name={subject ? SUBJECT_ICON[subject] : "folder"} size={TILE_ICON_SIZE[size]} color={c.color} stroke={size === "xs" ? 2.4 : 2} />
    </View>
  );
}

/** 文件夹里有多科时叠放两个小方块 */
export function SubjectStack({ subjects }: { subjects: Subject[] }) {
  if (subjects.length <= 1) return <SubjectTile subject={subjects[0] ?? null} size="lg" />;
  return (
    <View style={{ position: "relative", width: "52px", height: "52px", flexShrink: 0 }}>
      <SubjectTile subject={subjects[1]} size="sm" style={{ position: "absolute", right: 0, bottom: 0 }} />
      <SubjectTile subject={subjects[0]} size="sm" style={{ position: "absolute", left: 0, top: 0, boxShadow: `0 0 0 2px ${C.card}` }} />
    </View>
  );
}

/** 知识点图标：按名称粗略匹配，没有就用默认（和 App 一致） */
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
    <View className="tile tile--sm" style={{ background: c.bg }}>
      <Icon name={knowledgeIcon(name)} size={20} color={c.color} stroke={2} />
    </View>
  );
}

/** 设置行：彩色方块图标 + 标题 + 右侧值 + 箭头 */
/**
 * 设置列表的一行。传 contact 时整行换成原生 <button open-type="contact">，点了直接进微信客服会话
 *（只能用原生按钮触发，View 的 onClick 不行）；sessionFrom 会随会话带给客服，用来区分从哪进来的
 */
export function Row({ icon, iconBg, title, value, chevron = true, danger, onClick, contact, sessionFrom }: { icon: IconName; iconBg: string; title: string; value?: ReactNode; chevron?: boolean; danger?: boolean; onClick?: () => void; contact?: boolean; sessionFrom?: string }) {
  const inner = (
    <>
      <View className="prow__icon" style={{ background: iconBg }}>
        <Icon name={icon} size={18} color="#ffffff" stroke={2} />
      </View>
      <Text className={`prow__title${danger ? " c-wrong" : ""}`}>{title}</Text>
      <View className="prow__value">
        {typeof value === "string" ? <Text>{value}</Text> : value}
        {chevron && <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />}
      </View>
    </>
  );
  if (contact)
    return (
      <NativeButton className="prow prow--btn" hoverClass="prow--pressed" openType="contact" sessionFrom={sessionFrom}>
        {inner}
      </NativeButton>
    );
  return (
    <View className="prow" hoverClass={onClick ? "prow--pressed" : "none"} onClick={onClick}>
      {inner}
    </View>
  );
}

export type TagKind = "wrong" | "pending" | "correct" | "neutral" | "info" | "partial" | "accent";

const TAG_COLOR: Record<TagKind, string> = { wrong: C.wrong, pending: C.accentOn, partial: C.accentOn, correct: C.ok, info: C.brand, neutral: C.secondary, accent: "#ffffff" };
const TAG_ICON: Partial<Record<TagKind, IconName>> = { wrong: "xmark", correct: "check", partial: "warning", pending: "viewfinder" };

/** 头像：有图用图，没有（或图加载失败）用名字最后一个字 */
export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  // 同一版头像记一下试到哪一步：0 用缓存，1 缓存显示不出来改用最新地址，2 都不行用名字
  const id = url ? avatarId(url) : "";
  const [fail, setFail] = useState<{ id: string; step: number; src: string }>({ id: "", step: 0, src: "" });
  const step = fail.id === id ? fail.step : 0;
  const box: CSSProperties = { width: `${size}px`, height: `${size}px`, borderRadius: `${size / 2}px` };
  if (url && step < 2) {
    const src = step === 1 ? fail.src : avatarSrc(url);
    const onError = () => {
      const fresh = step === 0 ? avatarFallback(url) : "";
      setFail(fresh && fresh !== src ? { id, step: 1, src: fresh } : { id, step: 2, src: "" });
    };
    return <Image className="avatar-img" src={src} mode="aspectFill" style={box} onError={onError} />;
  }
  return (
    <View className="plan-avatar" style={{ ...box, fontSize: `${Math.round(size * 0.42)}px` }}>
      <Text>{name.slice(-1)}</Text>
    </View>
  );
}

/** 状态标签：颜色和图标一起变（icon 传 null 不要图标） */
export function Tag({ kind = "neutral", icon, children, style }: { kind?: TagKind; icon?: IconName | null; children: ReactNode; style?: CSSProperties }) {
  const name = icon === null ? undefined : (icon ?? TAG_ICON[kind]);
  return (
    <View className={`tag tag--${kind}`} style={style}>
      {name && <Icon name={name} size={11} color={TAG_COLOR[kind]} stroke={3} />}
      <Text>{children}</Text>
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

/** 按钮（和 App 的 Button 同样的几种样式） */
export function Button({ children, variant = "primary", size, icon, disabled, onClick, style, className }: { children?: ReactNode; variant?: "primary" | "tinted" | "plain" | "danger" | "outline"; size?: "sm" | "xs"; icon?: IconName; disabled?: boolean; onClick?: () => void; style?: CSSProperties; className?: string }) {
  const color = variant === "primary" ? "#ffffff" : variant === "danger" ? C.wrong : C.brand;
  const cls = ["btn", variant !== "primary" && `btn--${variant}`, size && `btn--${size}`, disabled && "btn--disabled", className].filter(Boolean).join(" ");
  return (
    <View className={cls} hoverClass={disabled ? "none" : "btn--hover"} style={style} onClick={() => !disabled && onClick?.()}>
      {icon && <Icon name={icon} size={size ? 18 : 20} color={color} stroke={2.2} />}
      {typeof children === "string" ? <Text>{children}</Text> : children}
    </View>
  );
}

/** 空状态：插画或图标 + 标题 + 说明 + 操作 */
export function Empty({ icon, art, title, text, children }: { icon?: IconName; art?: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <View className="empty rise">
      {art ?? (icon && <Icon name={icon} size={44} color={C.tertiary} stroke={1.5} />)}
      <Text className="empty__title">{title}</Text>
      {text && <Text className="empty__text">{text}</Text>}
      {children}
    </View>
  );
}

/** 灰色小提示：左边图标，右边一行说明 */
export function Hint({ icon = "info", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <View className="hint">
      <Icon name={icon} size={24} color={C.tertiary} stroke={1.8} />
      <Text className="flex1">{children}</Text>
    </View>
  );
}

/** 底部弹出面板 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  // 输入框在 fixed 面板 + ScrollView 里时，微信自带的「上推页面」(adjust-position) 不可靠，面板会被键盘盖住。
  // 面板里的 Input 一律 adjustPosition={false}，由这里按键盘高度把面板整块抬到键盘上方。
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (!open) return;
    // 自定义 Tab 栏盖在页面上面：在 Tab 页打开面板时先把它藏起来，关掉再放出来（不是 Tab 页时这两个调用会失败，忽略）
    void Taro.hideTabBar({ animation: false }).catch(() => undefined);
    const onChange = (res: { height: number }) => setKb(Math.max(0, res.height || 0));
    Taro.onKeyboardHeightChange(onChange);
    return () => {
      Taro.offKeyboardHeightChange?.(onChange);
      setKb(0);
      void Taro.showTabBar({ animation: false }).catch(() => undefined);
    };
  }, [open]);
  if (!open) return null;
  return (
    // catchMove 挡住背后页面跟着滚；面板里的内容放进 ScrollView，内容多时自己滚（catchMove 会拦掉普通 View 的滚动）
    <View className="sheet" catchMove>
      <View className="sheet__mask" onClick={onClose} />
      <View className={`sheet__panel${kb ? " sheet__panel--kb" : ""}`} style={kb ? { bottom: `${kb}px` } : undefined}>
        <View className="sheet__grabber" />
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

/** 带图标的分段控件 */
export function IconSegmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: NoInfer<T>) => void; options: { value: NoInfer<T>; label: string; icon: IconName }[] }) {
  return (
    <View className="seg seg--icons">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <View key={o.value} className={`seg__item${on ? " on" : ""}`} onClick={() => onChange(o.value)}>
            <Icon name={o.icon} size={15} color={on ? C.label : C.secondary} stroke={2.2} />
            <Text>{o.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** 统计格：小图标 + 标签 + 大数字 */
export function Stat({ label, value, icon, color, center }: { label: string; value: ReactNode; icon?: IconName; color?: string; center?: boolean }) {
  return (
    <View className={`stat${center ? " stat--center" : ""}`}>
      {center ? null : (
        <View className="stat__label" style={color ? { color } : undefined}>
          {icon && <Icon name={icon} size={13} color={color ?? C.secondary} stroke={2.4} />}
          <Text>{label}</Text>
        </View>
      )}
      <Text className="stat__value num" style={color ? { color } : undefined}>
        {value}
      </Text>
      {center && <Text className="stat__label">{label}</Text>}
    </View>
  );
}

/** 进度条（带流光） */
export function Progress({ value, className, style }: { value: number; className?: string; style?: CSSProperties }) {
  return (
    <View className={`progress${className ? ` ${className}` : ""}`} style={style}>
      <View className="progress__bar" style={{ width: `${Math.max(6, Math.min(100, value))}%` }}>
        <View className="progress__shine" />
      </View>
    </View>
  );
}

/** 判定：对 ✅、错 ❌ */
export function Verdict({ mark, student, grading }: { mark: Mark; student: string; grading?: boolean }) {
  const blank = !student.trim() || student.trim() === "未作答";
  if (mark === "unmarked" && grading && !blank && !/^[□\s]+$/.test(student)) return <Tag kind="info" icon={null}>批改中</Tag>;
  if (mark === "blank" || blank) return <Tag kind="pending" icon={null}>未作答</Tag>;
  if (mark === "unmarked" && /^[□\s,，.。]+$/.test(student)) return <Tag kind="pending" icon={null}>看不清</Tag>;
  if (mark === "correct") return <Text className="verdict">✅</Text>;
  if (mark === "wrong") return <Text className="verdict">❌</Text>;
  if (mark === "partial") return <Tag kind="partial" icon={null}>半对</Tag>;
  return <Tag kind="neutral">未批改</Tag>;
}

export type ErrorFilter = "all" | "wrong" | "blank";

export function applyErrorFilter<T extends { kind: string }>(items: T[], f: ErrorFilter): T[] {
  if (f === "all") return items;
  if (f === "blank") return items.filter((i) => i.kind === "未作答");
  return items.filter((i) => i.kind !== "未作答");
}

/** 错题列表上方的两个可点标签：答错 / 未作答，点一下只看这一类，再点取消 */
export function ErrorFilterTags({ value, onChange, counts }: { value: ErrorFilter; onChange: (v: ErrorFilter) => void; counts: { wrong: number; blank: number } }) {
  const items: { key: Exclude<ErrorFilter, "all">; label: string; kind: "wrong" | "pending"; icon: IconName; color: string; count: number }[] = [
    { key: "wrong", label: "答错", kind: "wrong", icon: "xmark", color: C.wrong, count: counts.wrong },
    { key: "blank", label: "未作答", kind: "pending", icon: "alert", color: C.accentOn, count: counts.blank },
  ];
  return (
    <View className="row-wrap" style={{ gap: "8px" }}>
      {items.map((it) => {
        const on = value === it.key;
        return (
          <View key={it.key} className={`tag tag--${it.kind} tag--filter${on ? " tag--filter-on" : ""}${value !== "all" && !on ? " tag--dim" : ""}`} onClick={() => onChange(on ? "all" : it.key)}>
            <Icon name={it.icon} size={12} color={it.color} stroke={3} />
            <Text>
              {it.label} {it.count}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** 错题数小圆环：有错题是红色，没有错题是绿色 */
export function WrongRing({ wrong }: { wrong: number }) {
  return (
    <View className={`ring${wrong === 0 ? " ring--ok" : ""}`}>
      <Text className="ring__num num">{wrong}</Text>
      <Text className="ring__label">错题</Text>
    </View>
  );
}

/** 学科名 + 题数的小色块标签 */
export function SubjectTag({ subject, children }: { subject: Subject; children?: ReactNode }) {
  const c = subjectColors(subject);
  return (
    <Text className="tag" style={{ background: c.bg, color: c.color }}>
      {children ?? SUBJECT_LABEL[subject]}
    </Text>
  );
}

/** 胶囊按钮的位置：自定义导航栏要和它对齐、给它让位 */
export function useMenuButton() {
  return useMemo(() => {
    const sys = Taro.getSystemInfoSync();
    let rect: { top: number; bottom: number; left: number; height: number } | null = null;
    try {
      rect = Taro.getMenuButtonBoundingClientRect();
    } catch {
      rect = null;
    }
    const statusBar = sys.statusBarHeight || 20;
    const top = rect?.top || statusBar + 6;
    const height = rect?.height || 32;
    const bottom = rect?.bottom || top + height;
    const right = rect?.left ? sys.windowWidth - rect.left + 8 : 104;
    return { top, height, bottom, right };
  }, []);
}

/** Tab 页的细顶栏（页面用 navigationStyle: custom）：和右上角胶囊按钮同一行，左边一行小字，右边给胶囊让位 */
export function TopBar({ children }: { children?: ReactNode }) {
  const mb = useMenuButton();
  return (
    <View className="topbar" style={{ height: `${mb.bottom + 8}px` }}>
      <View className="topbar__row" style={{ height: `${mb.height}px`, marginBottom: "8px", paddingRight: `${mb.right - 16}px` }}>
        {children}
      </View>
    </View>
  );
}
