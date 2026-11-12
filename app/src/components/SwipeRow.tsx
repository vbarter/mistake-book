/**
 * 一张能向左滑出「删除」的卡片（学习计划页创建人删作业用，和小程序一致）。
 *
 * - 整张卡片（children）跟手左移，右边露出红色按钮；滑过一半松手就停在打开位置，否则弹回
 * - 同一时间只开一张：open 由页面管；按到卡片外面、页面滚动、点卡片本身都会收回
 * - 滑动过的那一下不算点击，卡片开着时点它也只是收回，里面各行的 onClick 不会触发
 * - hint：首次引导，自己滑出一小截再弹回，露一下红色按钮，不加文字
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

const ACTION_W = 68; // 删除按钮宽度（和 .swipe-row__action 的宽度一致）
const GAP = 8; // 卡片和按钮之间露出的页面底色
const SHIFT = ACTION_W + GAP;
const SLOP = 6; // 超过这个距离才判断横滑 / 竖滑

type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; x: number; y: number }
  | { kind: "swipe"; x: number; from: number }
  | { kind: "pass" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  children: ReactNode;
  className?: string; // 加在卡片本身上（比如 group）
  label?: string;
  hint?: boolean;
  onHintDone?: () => void;
}

export function SwipeRow({ open, onOpenChange, onDelete, children, className = "", label = "删除", hint, onHintDone }: Props) {
  const g = useRef<Gesture>({ kind: "idle" });
  const root = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const x = useRef(0);
  const moved = useRef(false); // 这次按下有没有变成滑动：有就吞掉随后的 click
  const openRef = useRef(open);
  openRef.current = open;

  const setX = (v: number, animate: boolean) => {
    x.current = v;
    const el = content.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s ease" : "none";
    el.style.transform = v ? `translateX(${v}px)` : "";
    root.current?.classList.toggle("swipe-row--shown", v < 0);
  };

  // 页面改了 open：跟着动过去
  useEffect(() => {
    if (g.current.kind === "swipe") return;
    setX(open ? -SHIFT : 0, true);
  }, [open]);

  // 开着的时候：按到卡片外面或页面滚动就收回
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const scrolled = () => onOpenChange(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 首次引导：滑出一小截再弹回
  useEffect(() => {
    if (!hint) return;
    const t1 = window.setTimeout(() => setX(-36, true), 600);
    const t2 = window.setTimeout(() => {
      setX(openRef.current ? -SHIFT : 0, true);
      onHintDone?.();
    }, 1400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    moved.current = false;
    g.current = { kind: "pending", x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cur = g.current;
    if (cur.kind === "pending") {
      const dx = e.clientX - cur.x;
      const dy = e.clientY - cur.y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        g.current = { kind: "pass" }; // 竖着滑：交给原生滚动
        return;
      }
      // 到这里才抓 pointer capture：一按下就抓的话，普通点击会落不到里面的按钮上
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 手指已经抬起等情况：忽略 */
      }
      g.current = { kind: "swipe", x: cur.x, from: x.current };
      moved.current = true;
    }
    const s = g.current;
    if (s.kind !== "swipe") return;
    setX(Math.max(-SHIFT - 20, Math.min(0, s.from + e.clientX - s.x)), false);
  };
  const finish = (cancelled: boolean) => {
    const cur = g.current;
    g.current = { kind: "idle" };
    if (cur.kind !== "swipe") return;
    const openIt = cancelled ? openRef.current : x.current < -SHIFT / 2;
    setX(openIt ? -SHIFT : 0, true);
    if (openIt !== openRef.current) onOpenChange(openIt);
  };

  return (
    <div className="swipe-row" ref={root}>
      <button
        className="swipe-row__action"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash" size={22} stroke={2} />
        <span>{label}</span>
      </button>
      <div
        className={`swipe-row__content ${className}`}
        ref={content}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onClickCapture={(e) => {
          if (moved.current) {
            // 刚滑过的那一下
            moved.current = false;
            e.stopPropagation();
            e.preventDefault();
          } else if (openRef.current) {
            // 卡片开着：这一下只收回
            e.stopPropagation();
            e.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
