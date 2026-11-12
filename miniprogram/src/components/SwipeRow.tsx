/**
 * 一张能向左滑出「删除」的卡片（学习计划页创建人删作业用）。
 *
 * - 整张卡片（children）跟手左移，右边露出红色按钮；滑过一半松手就停在打开位置，否则弹回
 * - 同一时间只开一张：open 由页面管，按到别的卡片、点卡片本身或上下滚动时页面把它收回
 * - 滑动过的那一下不算点击：swipeGuard.moved 为真时，卡片里各行自己的 onClick 应该直接返回
 * - hint：首次引导，自己滑出一小截再弹回，露一下红色按钮，不加文字
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, type ITouchEvent } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Icon } from "./Icon";

// 样式里的 px 会按屏幕宽度换算（375 设计稿），这里手写的位移也按同一个比例算，不然宽屏上按钮露不全
let ratio = 1;
try {
  ratio = Taro.getSystemInfoSync().windowWidth / 375 || 1;
} catch {
  /* 拿不到就按 375 算 */
}
const ACTION_W = 68; // 删除按钮宽度（和 .swipe-row__action 的宽度一致）
const GAP = 8; // 卡片和按钮之间露出的页面底色
const SHIFT = Math.round((ACTION_W + GAP) * ratio);
const HINT = Math.round(36 * ratio); // 首次引导露出多少
const SLOP = 6; // 超过这个距离才判断横滑 / 竖滑

/** 这一次按下有没有变成滑动。页面里各行的 onClick 先看它，是滑动就不当点击处理 */
export const swipeGuard = { moved: false };

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
  hint?: boolean;
  onHintDone?: () => void;
}

export function SwipeRow({ open, onOpenChange, onDelete, children, label = "删除", hint, onHintDone }: Props) {
  const g = useRef<Gesture>({ kind: "idle" });
  const [x, setXState] = useState(open ? -SHIFT : 0);
  const [animate, setAnimate] = useState(false);
  const xRef = useRef(x);

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

  // 首次引导：滑出一小截再弹回
  useEffect(() => {
    if (!hint) return;
    const t1 = setTimeout(() => setX(-HINT, true), 600);
    const t2 = setTimeout(() => {
      setX(open ? -SHIFT : 0, true);
      onHintDone?.();
    }, 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const onTouchStart = (e: ITouchEvent) => {
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
    const openIt = cur.from + cur.dx < -SHIFT / 2;
    setX(openIt ? -SHIFT : 0, true);
    if (openIt !== open) onOpenChange(openIt);
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
      swipeGuard.moved = true;
    }
  };

  return (
    <View className="swipe-row">
      <View
        className="swipe-row__action"
        style={{ opacity: x < 0 ? 1 : 0 }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash" size={22} color="#fff" stroke={2} />
        <Text>{label}</Text>
      </View>
      <View
        className="swipe-row__content group"
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
