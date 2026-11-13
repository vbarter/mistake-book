/**
 * 一张能向左滑出按钮的卡片（学习计划页：创建人删作业；成员把交过的作业「解绑」，这时是卡片里的一行，inline）。
 *
 * - 整张卡片（children）跟手左移，右边露出红色按钮；往哪边滑过三分之一松手就停在哪边，否则回到原位
 * - 同一时间只开一张：open 由页面管，按到别的卡片、点卡片本身或上下滚动时页面把它收回
 * - 「上下滚动收回」用 useSwipeCloseOnScroll：横滑时手指难免带一点上下，页面会跟着动一下甚至被拉出下拉刷新，
 *   这种不算滚动，不然刚滑开就被收回去了
 * - 滑动过的那一下不算点击：swipeGuard.moved 为真时，卡片里各行自己的 onClick 应该直接返回
 * - hint：首次引导，自己滑出一小截再弹回，露一下红色按钮，不加文字
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, type ITouchEvent } from "@tarojs/components";
import Taro, { usePageScroll } from "@tarojs/taro";
import { Icon, type IconName } from "./Icon";

// 样式里的 px 会按屏幕宽度换算（375 设计稿），这里手写的位移也按同一个比例算，不然宽屏上按钮露不全
let ratio = 1;
try {
  ratio = Taro.getSystemInfoSync().windowWidth / 375 || 1;
} catch {
  /* 拿不到就按 375 算 */
}
const ACTION_W = 68; // 删除按钮宽度（和 .swipe-row__action 的宽度一致）
const GAP = 8; // 卡片和按钮之间露出的页面底色
const SHIFT_CARD = Math.round((ACTION_W + GAP) * ratio);
const SHIFT_INLINE = Math.round(ACTION_W * ratio); // 卡片里的一行：按钮贴着右边，不留缝
const HINT = Math.round(36 * ratio); // 首次引导露出多少
const SLOP = 6; // 超过这个距离才判断横滑 / 竖滑

/** 这一次按下有没有变成滑动。页面里各行的 onClick 先看它，是滑动就不当点击处理 */
export const swipeGuard = { moved: false, swiping: false };
let movedTimer: ReturnType<typeof setTimeout> | undefined;

const SETTLE_MS = 400; // 刚滑开的这段时间里页面还可能带着惯性在动
const SCROLL_CLOSE = 12; // 开着之后页面真的滚了这么多才收回

/**
 * 页面上下滚动时把滑开的卡片收回。
 * 不能「一有滚动事件就收」：横滑时页面会跟着手指上下带一点，开着下拉刷新的页面还会被拉下来再弹回去，
 * 这些都会报滚动，卡片刚滑开就自己弹回了。所以：正在滑、刚滑开的一小会儿只记位置；
 * 下拉回弹（scrollTop 小于 0）按 0 算；之后离滑开时的位置超过一小段才算用户在滚页面。
 */
export function useSwipeCloseOnScroll(openId: string | null, close: () => void) {
  const base = useRef({ top: 0, at: 0 });
  const last = useRef(0);
  useEffect(() => {
    if (openId) base.current = { top: last.current, at: Date.now() };
  }, [openId]);
  usePageScroll(({ scrollTop }) => {
    const top = Math.max(0, scrollTop);
    last.current = top;
    if (!openId) return;
    if (swipeGuard.swiping || Date.now() - base.current.at < SETTLE_MS) {
      base.current.top = top;
      return;
    }
    if (Math.abs(top - base.current.top) > SCROLL_CLOSE) close();
  });
}

type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; x: number; y: number; from: number }
  | { kind: "swipe"; x: number; from: number; dx: number }
  | { kind: "pass" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  children: ReactNode;
  label?: string;
  icon?: IconName;
  /** 卡片里的一行（外面已经有 .group 了）：自己不再是一张卡片，按钮直角贴边 */
  inline?: boolean;
  hint?: boolean;
  onHintDone?: () => void;
}

export function SwipeRow({ open, onOpenChange, onDelete, children, label = "删除", icon = "trash", inline, hint, onHintDone }: Props) {
  const SHIFT = inline ? SHIFT_INLINE : SHIFT_CARD;
  const g = useRef<Gesture>({ kind: "idle" });
  const [x, setXState] = useState(open ? -SHIFT : 0);
  const [animate, setAnimate] = useState(false);
  const xRef = useRef(x);
  const openRef = useRef(open);
  openRef.current = open;

  const setX = (v: number, withAnimation: boolean) => {
    xRef.current = v;
    setAnimate(withAnimation);
    setXState(v);
  };

  // 页面改了 open（收起别的卡片、滚动、点别处）：跟着动过去
  useEffect(() => {
    if (g.current.kind === "swipe") return;
    setX(open ? -SHIFT : 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 滑到一半卡片没了（比如列表刷新）：别把「正在滑」留在那儿
  useEffect(
    () => () => {
      if (g.current.kind === "swipe") swipeGuard.swiping = false;
    },
    [],
  );

  // 首次引导：滑出一小截再弹回
  useEffect(() => {
    if (!hint) return;
    const t1 = setTimeout(() => setX(-HINT, true), 600);
    const t2 = setTimeout(() => {
      // 演示的这一秒多里用户可能已经自己滑开了：按现在的状态归位，正在滑就不碰
      if (g.current.kind !== "swipe") setX(openRef.current ? -SHIFT : 0, true);
      onHintDone?.();
    }, 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const onTouchStart = (e: ITouchEvent) => {
    clearTimeout(movedTimer);
    swipeGuard.moved = false;
    const t = e.touches[0];
    if (!t) return;
    g.current = { kind: "pending", x: t.clientX, y: t.clientY, from: xRef.current };
  };

  const onTouchMove = (e: ITouchEvent) => {
    const cur = g.current;
    const t = e.touches[0];
    if (!t) return;
    if (cur.kind === "pending") {
      const dx = t.clientX - cur.x;
      const dy = t.clientY - cur.y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        g.current = { kind: "swipe", x: cur.x, from: cur.from, dx: 0 };
        swipeGuard.moved = true;
        swipeGuard.swiping = true;
      } else {
        g.current = { kind: "pass" }; // 竖着滑：交给页面滚动
        return;
      }
    }
    const s = g.current;
    if (s.kind !== "swipe") return;
    s.dx = t.clientX - s.x;
    setX(Math.max(-SHIFT - 20, Math.min(0, s.from + s.dx)), false);
  };

  const onTouchEnd = () => {
    const cur = g.current;
    g.current = { kind: "idle" };
    if (cur.kind !== "swipe") return;
    swipeGuard.swiping = false;
    // 「刚滑过」只管紧跟着的那一下点击；不清掉的话，下一次点别处（不在滑动卡片里的行）会被白白吞掉
    clearTimeout(movedTimer);
    movedTimer = setTimeout(() => {
      swipeGuard.moved = false;
    }, 350);
    // 往哪边滑过三分之一就停在哪边（手势被系统打断时也按滑到的位置算，不一律弹回）
    const wasOpen = cur.from < -SHIFT / 2;
    const at = Math.max(-SHIFT, Math.min(0, cur.from + cur.dx));
    const openIt = wasOpen ? at < -SHIFT * (2 / 3) : at < -SHIFT / 3;
    setX(openIt ? -SHIFT : 0, true);
    if (openIt !== openRef.current) onOpenChange(openIt);
  };

  // 点卡片本身：开着时只收回；刚滑过的那一下不算点击
  const onContentClick = (e: ITouchEvent) => {
    if (swipeGuard.moved) {
      e.stopPropagation();
      return;
    }
    if (open) {
      e.stopPropagation();
      setX(0, true);
      onOpenChange(false);
    }
  };

  return (
    <View className={inline ? "swipe-row swipe-row--inline" : "swipe-row"}>
      <View
        className="swipe-row__action"
        style={{ opacity: x < 0 ? 1 : 0 }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name={icon} size={22} color="#fff" stroke={2} />
        <Text>{label}</Text>
      </View>
      <View
        className={inline ? "swipe-row__content" : "swipe-row__content group"}
        style={{ transform: `translateX(${x}px)`, transition: animate ? "transform 0.22s ease" : "none" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={onContentClick}
      >
        {children}
      </View>
    </View>
  );
}
