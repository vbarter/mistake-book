/**
 * 智能聊天「问小壹」的入口：贴在屏幕右边缘的小人头像，放在四个 Tab 页里，点一下打开对话页（pages/assistant）。
 * 可以上下拖，位置记在本机；后台有试卷在处理时外圈是进度环，有新消息亮红点、冒一句话。
 * 没登录、服务端没开通知识库（/api/kb/token 返回 503）时不显示。
 */
import { Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dismissBubble, ensureAssistant, setOrbBottom, useAssistant, workingOf } from "../lib/assistant";
import type { ThemeName } from "../lib/colorIcons";
import { roleIconInner } from "../lib/roleIcons";
import { C, useTheme } from "../lib/theme";
import { base64 } from "./Icon";

export const ASSISTANT_PAGE = "/pages/assistant/index";

const faceCache = new Map<string, string>();
/** 小壹的头像：试卷小人的上半张（图里没有中文，可以直接用最简单的 base64） */
export function faceUri(theme: ThemeName): string {
  let u = faceCache.get(theme);
  if (!u) {
    u = `data:image/svg+xml;base64,${base64(`<svg xmlns="http://www.w3.org/2000/svg" width="184" height="184" viewBox="14 46 92 92" fill="none">${roleIconInner("face", theme, false, false)}</svg>`)}`;
    faceCache.set(theme, u);
  }
  return u;
}

export function Face({ size }: { size: number }) {
  const theme = useTheme();
  return (
    <View className="as-face" style={{ width: `${size}px`, height: `${size}px` }}>
      <Image src={faceUri(theme)} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px` }} />
    </View>
  );
}

/** raised：这一页底部还有一排固定按钮（分析页的「导出错题本」），默认位置抬高一截 */
export function AssistantOrb({ raised = false }: { raised?: boolean }) {
  useTheme();
  const available = useAssistant((s) => s.available);
  const seen = useAssistant((s) => s.seen);
  const unread = useAssistant((s) => s.unread);
  const bubble = useAssistant((s) => s.bubble);
  const orbBottom = useAssistant((s) => s.orbBottom);
  const uploads = useAssistant((s) => s.uploads);
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ y: number; bottom: number; moved: boolean } | null>(null);
  const live = useRef<number | null>(null);

  useDidShow(ensureAssistant);
  useEffect(() => {
    ensureAssistant();
    Taro.eventCenter.on("auth", ensureAssistant);
    return () => { Taro.eventCenter.off("auth", ensureAssistant); };
  }, []);

  if (!available) return null;

  const { count, progress } = workingOf(uploads);
  const open = () => {
    void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    void Taro.navigateTo({ url: ASSISTANT_PAGE });
  };

  const winH = () => Taro.getSystemInfoSync().windowHeight;
  const clamp = (b: number) => Math.max(64, Math.min(winH() - 160, b));
  const onStart = (ev: unknown) => {
    const e = ev as { touches: { clientY: number }[] };
    // 手指按下时入口底边离屏幕底部多远：拖过的用记下的值，没拖过的现量一次
    const y = e.touches[0].clientY;
    drag.current = { y, bottom: orbBottom ?? -1, moved: false };
    if (orbBottom == null) {
      Taro.createSelectorQuery().select("#as-orb").boundingClientRect((r) => {
        const rect = r as { bottom?: number } | null;
        if (drag.current && rect?.bottom != null) drag.current.bottom = winH() - rect.bottom;
      }).exec();
    }
  };
  const onMove = (ev: unknown) => {
    const e = ev as { touches: { clientY: number }[] };
    const d = drag.current;
    if (!d || d.bottom < 0) return;
    const dy = e.touches[0].clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    live.current = clamp(d.bottom - dy);
    setDragY(live.current);
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && live.current != null) setOrbBottom(live.current);
    live.current = null;
    setDragY(null);
  };

  const bottom = dragY ?? orbBottom;
  const style: CSSProperties | undefined = bottom != null ? { bottom: `${bottom}px` } : undefined;
  return (
    <>
      {bubble && (
        <View className={`as-bubble${raised && bottom == null ? " as-bubble--raised" : ""}`} style={bottom != null ? { bottom: `${bottom + 62}px` } : undefined} onClick={() => { dismissBubble(); open(); }}>
          <Text>{bubble}</Text>
        </View>
      )}
      <View
        id="as-orb"
        className={`as-orb${dragY != null ? " as-orb--drag" : ""}${raised && bottom == null ? " as-orb--raised" : ""}`}
        style={style}
        catchMove
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        onClick={open}
      >
        <View className="as-orb__ring" style={count ? { background: `conic-gradient(${C.brand} ${Math.round(progress * 360)}deg, ${C.brandTint} 0)` } : undefined}>
          <Face size={44} />
        </View>
        {unread && <View className="as-orb__dot" />}
        {!seen && (
          <View className="as-orb__txt">
            <Text className="as-orb__name">问小壹</Text>
            <Text>有题就问</Text>
          </View>
        )}
      </View>
    </>
  );
}
