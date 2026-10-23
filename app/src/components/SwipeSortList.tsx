/** 可拖动排序 + 左滑删除的列表（手指 / 鼠标都行）。
 *
 * - 按住一项约 0.35 秒不动：它浮起来（有震动反馈），上下拖到想放的位置松手，回调 onReorder(新顺序的 key)
 * - 向左滑一项：露出右侧的「删除」，点它回调 onDelete；滑回去或点别处收起
 * - 普通上下滑动交给原生滚动；滑动 / 拖动过程中的点击不会触发子元素的 onClick
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isNative } from "../lib/native";
import { Icon } from "./Icon";

const LONG_PRESS_MS = 350;
const MOVE_SLOP = 6; // 超过这个距离就不算「按住不动」
const ACTION_W = 88; // 删除按钮宽度
const EDGE = 64; // 拖到滚动区上下边缘多少像素内自动滚动

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  onReorder: (keys: string[]) => void;
  onDelete: (item: T) => void;
  gap?: number;
  deleteLabel?: string;
}

type Drag = { kind: "drag"; key: string; index: number; startY: number; y: number; startScroll: number; tops: number[]; heights: number[]; target: number; el: HTMLElement; scroller: HTMLElement };
type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; key: string; x: number; y: number; timer: number; el: HTMLElement; pointerId: number }
  | { kind: "swipe"; key: string; x: number; from: number }
  | Drag;

/** 最近的能滚动的祖先；没有就是整页 */
function scrollerOf(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const o = getComputedStyle(cur).overflowY;
    if ((o === "auto" || o === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

function haptic(): void {
  if (isNative) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium })).catch(() => undefined);
  } else {
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 不支持就算了 */
    }
  }
}

export function SwipeSortList<T>({ items, keyOf, render, onReorder, onDelete, gap = 12, deleteLabel = "删除" }: Props<T>) {
  const [open, setOpen] = useState<string | null>(null); // 露出删除按钮的那一项
  const [dragKey, setDragKey] = useState<string | null>(null);
  const g = useRef<Gesture>({ kind: "idle" });
  const moved = useRef(false); // 这次按下有没有变成滑动 / 拖动：有就吞掉随后的 click
  const els = useRef(new Map<string, HTMLElement>());
  const raf = useRef(0);
  const keys = items.map(keyOf);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const content = (key: string) => els.current.get(key)?.querySelector<HTMLElement>(".swipe-item__content");
  const setX = (key: string, x: number, animate: boolean) => {
    const c = content(key);
    if (!c) return;
    c.style.transition = animate ? "transform 0.22s ease" : "none";
    c.style.transform = x ? `translateX(${x}px)` : "";
  };
  const close = () => {
    setOpen((cur) => {
      if (cur) setX(cur, 0, true);
      return null;
    });
  };

  useEffect(() => {
    // 拖动中禁止页面跟着手指滚动（touch-action 在手势开始后改不了，只能在这里拦）
    const block = (e: TouchEvent) => {
      if (g.current.kind === "drag") e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    // 点到列表外面：收起已露出的删除按钮
    const outside = (e: PointerEvent) => {
      if (!open) return;
      const el = els.current.get(open);
      if (el && !el.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("touchmove", block);
      document.removeEventListener("pointerdown", outside, true);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 按当前手指位置摆放所有项：被拖的跟手，其它的让位 */
  const layout = (d: Drag) => {
    const dy = d.y - d.startY + (d.scroller.scrollTop - d.startScroll);
    const h = d.heights[d.index] + gap;
    const center = d.tops[d.index] + d.heights[d.index] / 2 + dy;
    const ks = keysRef.current;
    d.target = ks.reduce((n, _k, j) => (j !== d.index && d.tops[j] + d.heights[j] / 2 < center ? n + 1 : n), 0);
    ks.forEach((k, j) => {
      const el = els.current.get(k);
      if (!el) return;
      if (j === d.index) {
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px) scale(1.03)`;
      } else {
        el.style.transition = "transform 0.18s ease";
        el.style.transform = j < d.index && j >= d.target ? `translateY(${h}px)` : j > d.index && j <= d.target ? `translateY(${-h}px)` : "";
      }
    });
  };

  /** 靠近滚动区上下边缘时自动滚动，直到松手 */
  const autoScroll = () => {
    const d = g.current;
    if (d.kind !== "drag") return;
    const isPage = d.scroller === document.scrollingElement || d.scroller === document.documentElement;
    const top = isPage ? 0 : d.scroller.getBoundingClientRect().top;
    const bottom = isPage ? window.innerHeight : d.scroller.getBoundingClientRect().bottom;
    const speed = d.y < top + EDGE ? -8 : d.y > bottom - EDGE ? 8 : 0;
    if (speed) {
      d.scroller.scrollTop += speed;
      layout(d);
    }
    raf.current = requestAnimationFrame(autoScroll);
  };

  const startDrag = (p: Extract<Gesture, { kind: "pending" }>) => {
    const ks = keysRef.current;
    const index = ks.indexOf(p.key);
    if (index < 0) return;
    close();
    const scroller = scrollerOf(p.el);
    const tops: number[] = [];
    const heights: number[] = [];
    ks.forEach((k) => {
      const r = els.current.get(k)?.getBoundingClientRect();
      tops.push((r?.top ?? 0) + scroller.scrollTop);
      heights.push(r?.height ?? 0);
    });
    g.current = { kind: "drag", key: p.key, index, startY: p.y, y: p.y, startScroll: scroller.scrollTop, tops, heights, target: index, el: p.el, scroller };
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      /* 手指已经抬起等情况：忽略 */
    }
    moved.current = true;
    setDragKey(p.key);
    haptic();
    layout(g.current);
    raf.current = requestAnimationFrame(autoScroll);
  };

  const finishDrag = (d: Drag) => {
    cancelAnimationFrame(raf.current);
    const ks = keysRef.current;
    const next = ks.filter((k) => k !== d.key);
    next.splice(d.target, 0, d.key);
    // 先让浮起的卡片滑进目标位置，再提交新顺序并清掉所有位移
    const slotTop = d.target < d.index ? d.tops[d.target] : d.tops[d.target] + d.heights[d.target] - d.heights[d.index];
    d.el.style.transition = "transform 0.18s ease";
    d.el.style.transform = `translateY(${slotTop - d.tops[d.index]}px)`;
    window.setTimeout(() => {
      ks.forEach((k) => {
        const el = els.current.get(k);
        if (el) {
          el.style.transition = "none";
          el.style.transform = "";
        }
      });
      setDragKey(null);
      if (next.some((k, i) => k !== ks[i])) onReorder(next);
    }, 180);
  };

  const onPointerDown = (key: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || g.current.kind !== "idle") return;
    moved.current = false;
    if (open && open !== key) {
      close();
      moved.current = true; // 这一下只是收起别的行
      return;
    }
    // 这里先不抓 pointer capture：抓了之后 click 会落在外层容器上，卡片自己的 onClick 就收不到了；等真的变成滑动 / 拖动再抓
    const el = e.currentTarget;
    const timer = window.setTimeout(() => {
      if (g.current.kind === "pending" && g.current.timer === timer) startDrag(g.current);
    }, LONG_PRESS_MS);
    g.current = { kind: "pending", key, x: e.clientX, y: e.clientY, timer, el, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const cur = g.current;
    if (cur.kind === "pending") {
      const dx = e.clientX - cur.x;
      const dy = e.clientY - cur.y;
      if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
      window.clearTimeout(cur.timer);
      if (Math.abs(dx) > Math.abs(dy)) {
        cur.el.setPointerCapture?.(e.pointerId);
        g.current = { kind: "swipe", key: cur.key, x: cur.x, from: open === cur.key ? -ACTION_W : 0 };
        moved.current = true;
      } else {
        g.current = { kind: "idle" }; // 竖着滑：交给原生滚动
      }
    } else if (cur.kind === "swipe") {
      setX(cur.key, Math.max(-ACTION_W - 24, Math.min(0, cur.from + e.clientX - cur.x)), false);
    } else if (cur.kind === "drag") {
      e.preventDefault();
      cur.y = e.clientY;
      layout(cur);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const cur = g.current;
    g.current = { kind: "idle" };
    if (cur.kind === "pending") window.clearTimeout(cur.timer);
    else if (cur.kind === "swipe") {
      const openIt = cur.from + e.clientX - cur.x < -ACTION_W / 2;
      setX(cur.key, openIt ? -ACTION_W : 0, true);
      setOpen(openIt ? cur.key : null);
    } else if (cur.kind === "drag") finishDrag(cur);
  };

  const onPointerCancel = () => {
    const cur = g.current;
    g.current = { kind: "idle" };
    if (cur.kind === "pending") window.clearTimeout(cur.timer);
    else if (cur.kind === "swipe") setX(cur.key, open === cur.key ? -ACTION_W : 0, true);
    else if (cur.kind === "drag") finishDrag(cur);
  };

  return (
    <div className="swipe-list" style={{ gap }}>
      {items.map((item) => {
        const key = keyOf(item);
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) els.current.set(key, el);
              else els.current.delete(key);
            }}
            className={`swipe-item${dragKey === key ? " swipe-item--drag" : ""}${open === key ? " swipe-item--open" : ""}`}
            onPointerDown={onPointerDown(key)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClickCapture={(e) => {
              if (moved.current) {
                e.stopPropagation();
                e.preventDefault();
                moved.current = false;
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="swipe-item__actions" aria-hidden={open !== key}>
              <button className="swipe-item__delete" tabIndex={open === key ? 0 : -1} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setX(key, 0, true); setOpen(null); onDelete(item); }}>
                <Icon name="trash" size={20} stroke={2.2} />
                <span>{deleteLabel}</span>
              </button>
            </div>
            <div className="swipe-item__content">{render(item)}</div>
          </div>
        );
      })}
    </div>
  );
}
