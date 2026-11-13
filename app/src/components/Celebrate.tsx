import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Buddy } from "./Illustration";

/**
 * 庆祝层（小程序 components/Celebrate.tsx 同一套）：做成一件事时，小人跳出来举手、撒一把纸屑、一句话，约 1.8 秒自己收起。
 * 不接触摸（pointer-events: none），不挡下面的操作；动画全在 motion.css 的 .cele，这里只管摆节点和到点收起。
 * 系统开了「减弱动态效果」时不跳、不撒纸屑，只淡入淡出那句话。
 * 用法：const [cele, celebrate] = useCelebrate(); celebrate({ title: "交上啦！", sub: "…" }); 页面里放 {cele}。
 */
export type Cheer = { title: string; sub?: string; /** 大场面（比如作业全交齐）：纸屑多一些 */ big?: boolean };

const LIFE = 1900; // 和 .cele 的动画总长一致
const COLORS = ["var(--brand)", "var(--ill-tie)", "var(--ill-star)", "var(--ill-ok)", "#ff8a3d", "var(--ill-cheek)"];

/** 一把纸屑：每片的落点、转角、延迟、大小固定算出来（不用随机数，每次样子一样） */
function bits(n: number): CSSProperties[] {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const a = ((-90 + (r() - 0.5) * 150) * Math.PI) / 180;
    const d = 100 + r() * 120;
    const w = Math.round(6 + r() * 5);
    const round = r() < 0.3;
    return {
      "--x": `${Math.round(Math.cos(a) * d)}px`,
      "--y": `${Math.round(Math.sin(a) * d + 80)}px`,
      "--r": `${Math.round(r() * 720 - 360)}deg`,
      animationDelay: `${150 + Math.round(r() * 120)}ms`,
      width: w,
      height: round ? w : Math.round(w * 1.8),
      background: COLORS[i % COLORS.length],
      borderRadius: round ? "50%" : 2,
    } as CSSProperties;
  });
}

export function Celebrate({ cheer, onDone }: { cheer: Cheer; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, LIFE);
    return () => clearTimeout(t);
  }, [onDone]);
  const list = useMemo(() => bits(cheer.big ? 34 : 22), [cheer.big]);
  return createPortal(
    <div className="cele" role="status">
      <div className="cele__veil" />
      <div className="cele__burst" aria-hidden="true">
        {list.map((st, i) => (
          <i key={i} className="cele__bit" style={st} />
        ))}
      </div>
      <div className="cele__center">
        <Buddy scene="cheer" size={170} />
        <div className="cele__title">{cheer.title}</div>
        {cheer.sub ? <div className="cele__sub">{cheer.sub}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** [要放进页面的节点, 触发一次庆祝]；连着触发时后一次顶掉前一次、从头播 */
export function useCelebrate(): [ReactNode, (c: Cheer) => void] {
  const [cur, setCur] = useState<(Cheer & { n: number }) | null>(null);
  const done = useCallback(() => setCur(null), []);
  const fire = useCallback((c: Cheer) => setCur((p) => ({ ...c, n: (p?.n ?? 0) + 1 })), []);
  return [cur ? <Celebrate key={cur.n} cheer={cur} onDone={done} /> : null, fire];
}
