import type { CSSProperties } from "react";

/**
 * 插画：一个圆滚滚的「试卷小人」和它的道具。纯 SVG + CSS 动画（漂浮、眨眼、闪光、扫描线），深色模式跟着令牌走。
 * scene：hero 首页（拿着铅笔、旁边飘着对勾和星星）· scan 识别中（扫描线来回）· chart 分析（举着小柱状图）· empty 空状态（打招呼）
 */
export type Scene = "hero" | "scan" | "chart" | "empty";

export function Buddy({ scene = "hero", size = 140, style }: { scene?: Scene; size?: number; style?: CSSProperties }) {
  return (
    <svg className={`buddy buddy--${scene}`} width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true" style={style}>
      {/* 地面影子 */}
      <ellipse className="buddy__shadow" cx="80" cy="148" rx="38" ry="6" fill="var(--ill-shadow)" />
      <g className="buddy__body">
        {/* 后面那张纸 */}
        <rect x="52" y="22" width="68" height="88" rx="12" fill="var(--ill-paper2)" transform="rotate(8 86 66)" />
        {/* 试卷本体 */}
        <rect x="40" y="26" width="72" height="96" rx="14" fill="var(--ill-paper)" stroke="var(--ill-line)" strokeWidth="2.5" />
        <path d="M52 42h36M52 52h48M52 62h28" stroke="var(--ill-ink)" strokeWidth="4" strokeLinecap="round" opacity=".18" />
        {/* 脸 */}
        <g className="buddy__eyes">
          <ellipse cx="64" cy="86" rx="4" ry="5" fill="var(--ill-ink)" />
          <ellipse cx="88" cy="86" rx="4" ry="5" fill="var(--ill-ink)" />
        </g>
        <path d="M70 98q6 6 12 0" stroke="var(--ill-ink)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="56" cy="96" r="5" fill="var(--ill-cheek)" />
        <circle cx="96" cy="96" r="5" fill="var(--ill-cheek)" />
        {/* 校服领子和领带 */}
        <path d="M58 122l18-12 18 12" fill="var(--ill-line)" />
        <path d="M70 110l6 5 6-5" fill="#ffffff" stroke="var(--ill-line)" strokeWidth="1.5" strokeLinejoin="round" />
        <path className="buddy__tie" d="M76 114l-4 3 2 4-3 9 5 4 5-4-3-9 2-4z" fill="var(--ill-tie)" />
        {/* 小手 */}
        {scene === "empty" ? (
          <path className="buddy__wave" d="M112 78q14-6 16-20" stroke="var(--ill-line)" strokeWidth="5" strokeLinecap="round" />
        ) : (
          <path d="M112 84q10 2 14-6" stroke="var(--ill-line)" strokeWidth="5" strokeLinecap="round" />
        )}
        <path d="M40 88q-10 4-12 14" stroke="var(--ill-line)" strokeWidth="5" strokeLinecap="round" />
        {scene === "hero" && (
          <g className="buddy__pencil">
            <rect x="120" y="52" width="9" height="34" rx="3" fill="var(--ill-accent)" transform="rotate(28 124 69)" />
            <path d="M115 85l5 8 3-9z" fill="var(--ill-ink)" opacity=".7" />
          </g>
        )}
        {scene === "chart" && (
          <g className="buddy__chart">
            <rect x="118" y="44" width="34" height="30" rx="6" fill="var(--ill-paper)" stroke="var(--ill-line)" strokeWidth="2" />
            <rect className="buddy__barA" x="124" y="58" width="5" height="10" rx="1.5" fill="var(--ill-brand)" />
            <rect className="buddy__barB" x="132" y="52" width="5" height="16" rx="1.5" fill="var(--ill-brand)" />
            <rect className="buddy__barC" x="140" y="62" width="5" height="6" rx="1.5" fill="var(--ill-accent)" />
          </g>
        )}
        {scene === "scan" && <rect className="buddy__scan" x="36" y="30" width="80" height="4" rx="2" fill="var(--ill-brand)" />}
      </g>
      {/* 飘着的小东西 */}
      {scene !== "scan" && (
        <>
          <g className="buddy__float buddy__float--a">
            <circle cx="26" cy="40" r="11" fill="var(--ill-ok-bg)" />
            <path d="M21 40l4 4 7-8" stroke="var(--ill-ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <path className="buddy__spark buddy__spark--a" d="M136 20l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="var(--ill-star)" />
          <path className="buddy__spark buddy__spark--b" d="M22 112l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" fill="var(--ill-brand)" />
        </>
      )}
    </svg>
  );
}
