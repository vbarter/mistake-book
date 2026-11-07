import { useEffect, useRef, useState, type TouchEvent } from "react";
import { haptic, rotateImage } from "../lib/native";
import { answerPhotoConfirm, usePhotoConfirm } from "../store/photoConfirm";
import { Icon } from "./Icon";

/**
 * 拍完照的全屏确认（和小程序的确认页一样）：黑底居中显示照片，底下一排「向左转 / 向右转」把横着或倒着拍的试卷摆正。
 * 没有确认按钮：在照片上往上滑 = 用这张，往下滑 = 重拍（系统返回键也是重拍）。照片跟手移动，过了阈值有提示和轻震，松手飞出去；没过阈值弹回原位。
 * 第一次拖动之前，照片下方循环播放上滑引导。
 */
/** 滑多远算数（px），或者滑得够快（px/ms）且至少滑了 MIN_FLICK */
const SWIPE_MIN = 72;
const FLICK_SPEED = 0.6;
const MIN_FLICK = 24;
/** 飞出去的动画时长（ms），和 .photo-confirm__drag--fly 一致 */
const FLY_MS = 200;

type Drag = "idle" | "drag" | "back" | "fly";

export function PhotoConfirmHost() {
  const src = usePhotoConfirm((s) => s.src);
  const [turns, setTurns] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState<Drag>("idle");
  // 用户第一次上下拖过以后就不再显示上滑引导
  const [touched, setTouched] = useState(false);
  const touch = useRef<{ x: number; y: number; t: number; lastY: number; lastT: number; armed: boolean; vertical: boolean | null } | null>(null);
  // 拿最新的照片和转换状态给飞出去以后的回调用
  const latest = useRef({ shown, src, busy });
  latest.current = { shown, src, busy };

  // 换了一张照片：从没转过、没拖过开始
  useEffect(() => {
    setTurns(0);
    setShown(src);
    setDy(0);
    setDrag("idle");
    setTouched(false);
    touch.current = null;
  }, [src]);

  // 每次都从原图转，转几次也只压缩一回
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setBusy(true);
    rotateImage(src, turns)
      .then((out) => { if (alive) setShown(out); })
      .catch(() => { if (alive) setTurns(0); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [src, turns]);

  // 打开时页面不跟着滚动
  useEffect(() => {
    if (!src) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [src]);

  if (!src) return null;

  const threshold = Math.max(SWIPE_MIN, Math.round(window.innerHeight * 0.12));

  const onTouchStart = (e: TouchEvent) => {
    if (drag === "fly" || e.touches.length !== 1) return;
    const p = e.touches[0];
    const now = Date.now();
    touch.current = { x: p.clientX, y: p.clientY, t: now, lastY: p.clientY, lastT: now, armed: false, vertical: null };
  };
  const onTouchMove = (e: TouchEvent) => {
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
    if (armed && !t.armed) void haptic.light();
    t.armed = armed;
    setDrag("drag");
    setTouched(true);
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
    setDy(up ? -window.innerHeight : window.innerHeight);
    setTimeout(() => {
      if (!up) {
        answerPhotoConfirm(null);
        return;
      }
      // 还在转方向的话等转好再交出去，保证拿到的是转正后的那张
      const finish = () => {
        const cur = latest.current;
        if (cur.busy) setTimeout(finish, 50);
        else answerPhotoConfirm(cur.shown ?? cur.src);
      };
      finish();
    }, FLY_MS);
  };

  // 拖动时照片略缩小、变淡，提示文字按方向出现在照片上 / 下
  const progress = Math.min(1, Math.abs(dy) / threshold);
  const dragStyle = {
    transform: `translateY(${dy}px) scale(${drag === "fly" ? 0.85 : 1 - progress * 0.06})`,
    opacity: drag === "fly" ? 0 : 1 - progress * 0.25,
  };
  const hint = drag === "drag" && Math.abs(dy) > 16 ? (dy < 0 ? "up" : "down") : null;
  const armed = progress >= 1;

  return (
    <div className="photo-confirm" role="dialog" aria-modal="true" aria-label="确认这张照片：上滑用这张，下滑重拍">
      <div className="photo-confirm__stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className={`photo-confirm__drag photo-confirm__drag--${drag}${!touched && drag === "idle" ? " photo-confirm__drag--nudge" : ""}`} style={dragStyle}>
          <img className="photo-confirm__img" src={shown ?? src} alt="刚拍的照片" />
        </div>
        {hint === "up" && (
          <div className={`photo-confirm__hint photo-confirm__hint--up${armed ? " photo-confirm__hint--ok" : ""}`}>
            <Icon name="check" size={18} stroke={2.6} />
            <span>{armed ? "松手用这张" : "继续上滑用这张"}</span>
          </div>
        )}
        {hint === "down" && (
          <div className={`photo-confirm__hint photo-confirm__hint--down${armed ? " photo-confirm__hint--no" : ""}`}>
            <Icon name="xmark" size={18} stroke={2.4} />
            <span>{armed ? "松手重拍" : "继续下滑重拍"}</span>
          </div>
        )}
        {!touched && (
          <div className="photo-confirm__guide" aria-hidden="true">
            <div className="photo-confirm__chevrons">
              <Icon className="photo-confirm__chev photo-confirm__chev--1" name="chevron-up" size={22} stroke={2.6} />
              <Icon className="photo-confirm__chev photo-confirm__chev--2" name="chevron-up" size={22} stroke={2.6} />
              <Icon className="photo-confirm__chev photo-confirm__chev--3" name="chevron-up" size={22} stroke={2.6} />
            </div>
            <span className="photo-confirm__guide-text">上滑用这张</span>
            <span className="photo-confirm__guide-sub">↓ 下滑重拍</span>
          </div>
        )}
      </div>
      <div className="photo-confirm__tools">
        <button className="photo-confirm__tool" aria-label="向左转 90 度" disabled={busy || drag === "fly"} onClick={() => setTurns((t) => (t + 3) % 4)}>
          <Icon name="rotate" size={24} stroke={2} style={{ transform: "scaleX(-1)" }} />
          <span>向左转</span>
        </button>
        <button className="photo-confirm__tool" aria-label="向右转 90 度" disabled={busy || drag === "fly"} onClick={() => setTurns((t) => (t + 1) % 4)}>
          <Icon name="rotate" size={24} stroke={2} />
          <span>向右转</span>
        </button>
      </div>
    </div>
  );
}
