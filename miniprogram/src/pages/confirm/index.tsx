import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View, type ITouchEvent } from "@tarojs/components";
import Taro, { useUnload } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { useMenuButton } from "../../components/ui";
import { answerConfirm, confirmingSrc } from "../../lib/confirm";
import { useShare } from "../../lib/share";

/**
 * 拍完照的全屏确认：黑底居中显示照片，左上 × 重拍，底下一排「向左转 / ✓ 用这张 / 向右转」。
 * 右上角是微信的胶囊按钮（··· 和关闭），✓ 放那儿会和胶囊叠在一起、误点到关闭，所以确认挪到底部操作区；
 * 顶栏只留 ×，和胶囊同一行垂直对齐，右侧给胶囊让位。
 * 手势：在照片上往上滑 = 用这张，往下滑 = 重拍。照片跟手移动，过了阈值有提示和轻震，松手飞出去；没过阈值弹回原位。
 */
/** 顶栏在胶囊上下各多留的高度；底部操作区高度（和 .confirm__tools 一致） */
const BAR_PAD = 12;
const TOOLS_H = 88;
/** 滑多远算数（px），或者滑得够快（px/ms）且至少滑了 MIN_FLICK */
const SWIPE_MIN = 72;
const FLICK_SPEED = 0.6;
const MIN_FLICK = 24;
/** 飞出去的动画时长（ms），和 .confirm__drag--fly 一致 */
const FLY_MS = 200;

export default function ConfirmPage() {
  useShare();
  const src = useMemo(() => confirmingSrc(), []);
  const mb = useMenuButton();
  const [turns, setTurns] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const sys = useMemo(() => Taro.getSystemInfoSync(), []);

  useEffect(() => {
    if (!src) {
      void Taro.navigateBack();
      return;
    }
    Taro.getImageInfo({ src })
      .then((i) => setSize({ w: i.width, h: i.height }))
      .catch(() => setSize({ w: 3, h: 4 }));
  }, [src]);

  // 结果在页面关掉时才交回去：拍照流程接着要起相机，得等这一页退出以后。没点 × / ✓ 就离开（返回键、侧滑）当作不要这张
  const result = useRef<{ turns: number } | null>(null);
  useUnload(() => {
    answerConfirm(result.current);
  });

  const done = (ok: boolean) => {
    if (leaving) return;
    setLeaving(true);
    result.current = ok ? { turns } : null;
    void Taro.navigateBack();
  };

  // 上滑用这张 / 下滑重拍
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState<"idle" | "drag" | "back" | "fly">("idle");
  const touch = useRef<{ x: number; y: number; t: number; lastY: number; lastT: number; armed: boolean; vertical: boolean | null } | null>(null);
  const threshold = Math.max(SWIPE_MIN, Math.round(sys.windowHeight * 0.12));

  const onTouchStart = (e: ITouchEvent) => {
    if (leaving || drag === "fly" || e.touches.length !== 1) return;
    const p = e.touches[0];
    const now = Date.now();
    touch.current = { x: p.clientX, y: p.clientY, t: now, lastY: p.clientY, lastT: now, armed: false, vertical: null };
  };
  const onTouchMove = (e: ITouchEvent) => {
    const t = touch.current;
    if (!t || e.touches.length !== 1) return;
    const p = e.touches[0];
    const ddx = p.clientX - t.x;
    const ddy = p.clientY - t.y;
    // 先判断方向：横着划的不当成上下滑
    if (t.vertical === null) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      t.vertical = Math.abs(ddy) > Math.abs(ddx);
    }
    if (!t.vertical) return;
    t.lastY = p.clientY;
    t.lastT = Date.now();
    const armed = Math.abs(ddy) >= threshold;
    if (armed && !t.armed) void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    t.armed = armed;
    setDrag("drag");
    setDy(ddy);
  };
  const onTouchEnd = () => {
    const t = touch.current;
    touch.current = null;
    if (!t || !t.vertical) return;
    const total = t.lastY - t.y;
    const speed = total / Math.max(1, t.lastT - t.t);
    const go = Math.abs(total) >= threshold || (Math.abs(speed) >= FLICK_SPEED && Math.abs(total) >= MIN_FLICK);
    if (!go) {
      setDrag("back");
      setDy(0);
      return;
    }
    const up = total < 0;
    setDrag("fly");
    setDy(up ? -sys.windowHeight : sys.windowHeight);
    setTimeout(() => done(up), FLY_MS);
  };

  // 照片框：转了奇数次时宽高对调，按转过以后的样子塞进可用区域
  const stageW = sys.windowWidth;
  const barTop = Math.max(0, mb.top - BAR_PAD);
  const barH = mb.height + BAR_PAD * 2;
  const stageH = sys.windowHeight - (barTop + barH) - TOOLS_H - (sys.safeArea ? sys.screenHeight - sys.safeArea.bottom : 0);
  const odd = turns % 2 === 1;
  const box = size
    ? (() => {
        const s = odd ? Math.min(stageW / size.h, stageH / size.w) : Math.min(stageW / size.w, stageH / size.h);
        return { width: `${Math.round(size.w * s)}px`, height: `${Math.round(size.h * s)}px` };
      })()
    : { width: "0px", height: "0px" };

  // 拖动时照片略缩小、变淡，提示文字按方向出现在照片上 / 下
  const progress = Math.min(1, Math.abs(dy) / threshold);
  const dragStyle = {
    transform: `translateY(${dy}px) scale(${drag === "fly" ? 0.85 : 1 - progress * 0.06})`,
    opacity: drag === "fly" ? 0 : 1 - progress * 0.25,
  };
  const hint = drag === "drag" && Math.abs(dy) > 16 ? (dy < 0 ? "up" : "down") : null;
  const armed = progress >= 1;

  return (
    <View className="confirm" catchMove>
      <View style={{ height: `${barTop}px` }} />
      <View className="confirm__bar" style={{ height: `${barH}px`, paddingRight: `${mb.right}px` }}>
        <View className="confirm__btn" hoverClass="confirm__btn--hover" onClick={() => done(false)}>
          <Icon name="xmark" size={28} color="#ffffff" stroke={2.2} />
        </View>
      </View>
      <View className="confirm__stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <View className={`confirm__drag confirm__drag--${drag}`} style={dragStyle}>
          {src && <Image className="confirm__img" src={src} mode="scaleToFill" style={{ ...box, transform: `rotate(${turns * 90}deg)` }} />}
        </View>
        {hint === "up" && (
          <View className={`confirm__hint confirm__hint--up${armed ? " confirm__hint--ok" : ""}`}>
            <Icon name="check" size={18} color={armed ? "#000000" : "#ffffff"} stroke={2.6} />
            <Text>{armed ? "松手用这张" : "继续上滑用这张"}</Text>
          </View>
        )}
        {hint === "down" && (
          <View className={`confirm__hint confirm__hint--down${armed ? " confirm__hint--no" : ""}`}>
            <Icon name="xmark" size={18} color="#ffffff" stroke={2.4} />
            <Text>{armed ? "松手重拍" : "继续下滑重拍"}</Text>
          </View>
        )}
        {drag === "idle" && <Text className="confirm__tip">上滑用这张 · 下滑重拍</Text>}
      </View>
      <View className="confirm__tools">
        <View className="confirm__tool" hoverClass="confirm__tool--hover" onClick={() => setTurns((t) => (t + 3) % 4)}>
          <Icon name="rotate" size={22} color="#ffffff" stroke={2} style={{ transform: "scaleX(-1)" }} />
          <Text>向左转</Text>
        </View>
        <View className="confirm__ok" hoverClass="confirm__ok--hover" onClick={() => done(true)}>
          <Icon name="check" size={22} color="#000000" stroke={2.6} />
          <Text>用这张</Text>
        </View>
        <View className="confirm__tool" hoverClass="confirm__tool--hover" onClick={() => setTurns((t) => (t + 1) % 4)}>
          <Icon name="rotate" size={22} color="#ffffff" stroke={2} />
          <Text>向右转</Text>
        </View>
      </View>
    </View>
  );
}
