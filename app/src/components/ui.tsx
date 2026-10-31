import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Mastery, Subject } from "../api/types";
import { MASTERY_LABEL, SUBJECT_LABEL, masteryStyle, subjectStyle } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { useBanner } from "../store/banner";

/* ---------- 导航栏 ---------- */
export function InlineNav({
  title,
  subtitle,
  back,
  backLabel,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  backLabel?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const nav = useNavigate();
  return (
    <header className="nav nav--inline">
      <div className="nav__side">
        {back && (
          <button className="nav-btn" onClick={onBack ?? (() => nav(-1))} aria-label={backLabel ? undefined : "返回"}>
            <Icon name="chevron-left" size={24} stroke={2.2} />
            {backLabel && <span className="ellipsis" style={{ maxWidth: 90 }}>{backLabel}</span>}
          </button>
        )}
      </div>
      <div className="nav__center">
        <span className="t-headline ellipsis" style={{ maxWidth: "100%" }}>{title}</span>
        {subtitle && <span className="t-cap c-sec">{subtitle}</span>}
      </div>
      <div className="nav__side nav__side--end">{right}</div>
    </header>
  );
}

/* ---------- 按钮 ---------- */
export function Button({
  children,
  variant = "primary",
  size,
  onClick,
  disabled,
  icon,
  style,
  type = "button",
  ariaLabel,
}: {
  children?: ReactNode;
  variant?: "primary" | "tinted" | "plain" | "danger" | "black" | "outline";
  size?: "sm" | "xs";
  onClick?: () => void;
  disabled?: boolean;
  icon?: IconName;
  style?: CSSProperties;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn--${variant}${size ? ` btn--${size}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      aria-label={ariaLabel}
    >
      {icon && <Icon name={icon} size={size ? 18 : 20} />}
      {children}
    </button>
  );
}

export function IconButton({ name, label, onClick, fill }: { name: IconName; label: string; onClick?: () => void; fill?: boolean }) {
  return (
    <button className="icon-btn" aria-label={label} onClick={onClick}>
      <Icon name={name} size={26} fill={fill} />
    </button>
  );
}

/* ---------- 胶囊 ---------- */
export function SubjectChip({ subject, small, count }: { subject: Subject; small?: boolean; count?: number }) {
  return (
    <span className={`chip${small ? " chip--sm" : ""}`} style={subjectStyle(subject)}>
      {SUBJECT_LABEL[subject]}
      {count !== undefined && ` ${count}`}
    </span>
  );
}

const masteryIcon: Record<Mastery, IconName> = { due: "clock", learning: "loop", mastered: "seal" };
export function MasteryChip({ mastery, small, prefix }: { mastery: Mastery; small?: boolean; prefix?: string }) {
  return (
    <span className={`chip${small ? " chip--sm" : ""}`} style={masteryStyle(mastery)}>
      <Icon name={masteryIcon[mastery]} size={small ? 12 : 14} stroke={2.2} />
      {prefix}
      {MASTERY_LABEL[mastery]}
    </span>
  );
}

/* ---------- 分段控件 ---------- */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={`seg__item${o.value === value ? " on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- 进度环 ---------- */
export function Ring({ value, size = 72, stroke = 6, color = "var(--brand)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--brand-tint)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="ring__label">{children}</div>
    </div>
  );
}

/* ---------- 空状态 ---------- */
export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={44} stroke={1.5} className="empty__icon" />
      <span className="empty__title">{title}</span>
      {text && <span className="t-sub">{text}</span>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/* ---------- Sheet ---------- */
/**
 * iOS WKWebView 弹出键盘时不缩小网页（布局视口不变），只缩小「可见视口」。
 * position: fixed 的底部面板仍贴着布局视口底部 → 整块被键盘盖住。
 * 这里跟着 visualViewport 算出键盘上方真正看得见的区域，交给 Sheet 去贴齐。
 */
function useVisibleViewport(active: boolean) {
  const [vp, setVp] = useState({ top: 0, height: 0, keyboard: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 用布局视口高度（clientHeight）做基准：iOS 上 window.innerHeight 会跟着可见视口一起变小，拿它算会得 0
        const layoutH = document.documentElement.clientHeight || window.innerHeight;
        const keyboard = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop));
        // 小于 80px 视为没有键盘（地址栏/工具条抖动之类）
        setVp(keyboard > 80 ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height), keyboard } : { top: 0, height: 0, keyboard: 0 });
        // 面板贴好后，确保正在输入的框在面板里也是可见的
        const el = document.activeElement as HTMLElement | null;
        if (keyboard > 80 && el && el.closest(".sheet")) el.scrollIntoView({ block: "nearest" });
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setVp({ top: 0, height: 0, keyboard: 0 });
    };
  }, [active]);
  return vp;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const viewport = useVisibleViewport(open);
  if (!open) return null;
  const kb = viewport.keyboard > 0;
  return (
    <div
      className={`sheet-backdrop${kb ? " sheet-backdrop--kb" : ""}`}
      // 键盘弹出时把整块遮罩缩到「键盘上方的可见区域」，面板贴着键盘顶部，不再被盖住
      style={kb ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
      onClick={onClose}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grabber" />
        {title && <h2 className="t-title3">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/* ---------- 横幅宿主 ---------- */
export function BannerHost() {
  const banners = useBanner((s) => s.banners);
  const dismiss = useBanner((s) => s.dismiss);
  return (
    <div className="banner-host" aria-live="polite">
      {banners.map((b) => (
        <div key={b.id} className={`banner${b.kind === "error" ? " banner--error" : ""}`}>
          <Icon name={b.kind === "error" ? "warning" : b.kind === "success" ? "check" : "info"} size={20} stroke={2.2} />
          <span>{b.text}</span>
          {b.action && (
            <button className="banner__action" onClick={() => { b.action?.onClick(); dismiss(b.id); }}>
              {b.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- 行 ---------- */
export function Row({ icon, iconColor, title, sub, value, chevron = true, onClick, danger }: { icon?: IconName; iconColor?: string; title: string; sub?: string; value?: ReactNode; chevron?: boolean; onClick?: () => void; danger?: boolean }) {
  return (
    <button className="row" onClick={onClick} style={danger ? { color: "var(--wrong)" } : undefined}>
      {icon && (
        <span className="row__icon" style={{ background: iconColor ?? "var(--brand)" }}>
          <Icon name={icon} size={18} stroke={2} />
        </span>
      )}
      <span className="row__main">
        <span className="row__title">{title}</span>
        {sub && <span className="row__sub">{sub}</span>}
      </span>
      <span className="row__value">
        {value}
        {chevron && <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />}
      </span>
    </button>
  );
}

export function Spinner({ text }: { text?: string }) {
  return (
    <div className="empty" style={{ padding: 32 }}>
      <Icon name="refresh" size={28} className="spin" />
      {text && <span className="t-sub">{text}</span>}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
