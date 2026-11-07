import { useEffect, useMemo, useRef, useState } from "react";
import { haptic, pushBackHandler } from "../lib/native";
import { hamming } from "../lib/photoPrint";
import { findIssues } from "../lib/scanProcess";
import { useBanner } from "../store/banner";
import { removeShot, restoreShot, rotateShot, useScan } from "../store/scan";
import { Icon } from "./Icon";
import { QuadEditor } from "./QuadEditor";

/** 滑多远算数（px），或者滑得够快（px/ms）且至少滑了 MIN_FLICK。和小程序拍照确认页一致 */
const SWIPE_MIN = 72;
const FLICK_SPEED = 0.6;
const MIN_FLICK = 24;
const FLY_MS = 200;

/**
 * 连拍扫描的逐张查看：全屏黑底，左右滑翻页。
 * 沿用拍照确认页的手势：往上滑 = 留下（翻到下一张，最后一张就关掉），往下滑 = 删掉这张（可撤销）。
 * 照片跟手移动，过了阈值有提示和轻震，松手飞出去；没过阈值弹回原位。
 * 底部：向左转、调整四角、向右转、删除。
 */
export function ScanViewer({ start, onClose }: { start: number; onClose: () => void }) {
  const shots = useScan((s) => s.shots);
  const [index, setIndex] = useState(() => Math.min(start, Math.max(0, shots.length - 1)));
  const [editing, setEditing] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState<"idle" | "drag" | "back" | "fly">("idle");
  const touch = useRef<{ x: number; y: number; t: number; lastX: number; lastY: number; lastT: number; armed: boolean; dir: "v" | "h" | null } | null>(null);
  const threshold = Math.max(SWIPE_MIN, Math.round(window.innerHeight * 0.12));

  // 都删光了就关掉；删到最后一张之后，停在新的最后一张
  useEffect(() => {
    if (!shots.length) onClose();
    else if (index > shots.length - 1) setIndex(shots.length - 1);
  }, [shots.length, index, onClose]);

  // 安卓返回键：先关调四角，再关查看
  useEffect(() => pushBackHandler(() => {
    if (editing) setEditing(null);
    else onClose();
    return true;
  }), [editing, onClose]);

  const issues = useMemo(() => findIssues(shots.map((s) => ({ id: s.id, dhash: s.page?.dhash, sharp: s.sharp })), hamming), [shots]);
  const shot = shots[index];
  if (!shot) return null;
  const issue = issues.get(shot.id);

  const del = () => {
    const r = removeShot(shot.id);
    if (!r) return;
    void haptic.light();
    useBanner.getState().show(`已删掉这张，还剩 ${useScan.getState().shots.length} 张`, { action: { label: "撤销", onClick: () => restoreShot(r) } });
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (drag === "fly" || e.touches.length !== 1) return;
    const p = e.touches[0];
    const now = Date.now();
    touch.current = { x: p.clientX, y: p.clientY, t: now, lastX: p.clientX, lastY: p.clientY, lastT: now, armed: false, dir: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t || e.touches.length !== 1) return;
    const p = e.touches[0];
    const ddx = p.clientX - t.x;
    const ddy = p.clientY - t.y;
    if (t.dir === null) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      t.dir = Math.abs(ddy) > Math.abs(ddx) ? "v" : "h";
    }
    t.lastX = p.clientX;
    t.lastY = p.clientY;
    t.lastT = Date.now();
    setDrag("drag");
    if (t.dir === "h") {
      setDx(ddx);
      return;
    }
    const armed = Math.abs(ddy) >= threshold;
    if (armed && !t.armed) void haptic.selection();
    t.armed = armed;
    setDy(ddy);
  };
  const onTouchEnd = () => {
    const t = touch.current;
    touch.current = null;
    if (!t || !t.dir) return;
    if (t.dir === "h") {
      const total = t.lastX - t.x;
      const next = total < -60 ? index + 1 : total > 60 ? index - 1 : index;
      setDrag("back");
      setDx(0);
      if (next !== index && next >= 0 && next < shots.length) setIndex(next);
      return;
    }
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
    window.setTimeout(() => {
      setDrag("idle");
      setDy(0);
      if (up) {
        // 留下：看下一张；最后一张就看完了
        if (index >= shots.length - 1) onClose();
        else setIndex(index + 1);
      } else del();
    }, FLY_MS);
  };

  const progress = Math.min(1, Math.abs(dy) / threshold);
  const hint = drag === "drag" && Math.abs(dy) > 16 ? (dy < 0 ? "up" : "down") : null;
  const armed = progress >= 1;
  const src = shot.page?.src ?? shot.raw;

  return (
    <div className="sview" role="dialog" aria-modal="true" aria-label="逐张查看">
      <div className="sview__top">
        <button className="scan-btn" aria-label="返回" onClick={onClose}><Icon name="chevron-left" size={26} stroke={2.2} /></button>
        <span className="sview__title">{index + 1} / {shots.length}</span>
        <button className="scan-btn" aria-label="接着拍" onClick={onClose}><Icon name="camera" size={22} stroke={2} /></button>
      </div>
      {shots.length <= 12 ? (
        <div className="sview__dots">{shots.map((s, i) => <i key={s.id} className={i === index ? "on" : ""} />)}</div>
      ) : <div className="sview__dots" />}
      <div className="sview__guide"><Icon name="chevron-up" size={16} stroke={2.4} />上滑留下，看下一张</div>
      <div className="sview__stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div
          className={`sview__drag sview__drag--${drag}`}
          style={{
            transform: `translate(${dx}px, ${dy}px) scale(${drag === "fly" ? 0.85 : 1 - progress * 0.06})`,
            opacity: drag === "fly" ? 0 : 1 - progress * 0.25,
          }}
        >
          <img className="sview__img" src={src} alt={`第 ${index + 1} 张`} draggable={false} />
        </div>
        {shot.status === "busy" && <div className="sview__busy"><span><i className="mini-spin" />正在调正</span></div>}
        {hint === "up" && (
          <div className={`sview__hint sview__hint--up${armed ? " sview__hint--ok" : ""}`}>
            <Icon name="check" size={18} stroke={2.6} />{armed ? "松手留下" : "继续上滑留下"}
          </div>
        )}
        {hint === "down" && (
          <div className={`sview__hint sview__hint--down${armed ? " sview__hint--no" : ""}`}>
            <Icon name="trash" size={18} stroke={2.2} />{armed ? "松手删掉" : "继续下滑删掉"}
          </div>
        )}
      </div>
      <div className="sview__flag">
        {shot.status === "fail" ? (
          <span className="sflag sflag--fail"><Icon name="warning" size={13} stroke={2.4} />没处理好，点「调整四角」重试</span>
        ) : issue?.kind === "dup" ? (
          <span className="sflag sflag--dup"><Icon name="warning" size={13} stroke={2.4} />和第 {(issue.of ?? 0) + 1} 张几乎一样</span>
        ) : issue?.kind === "blur" ? (
          <span className="sflag sflag--blur"><Icon name="warning" size={13} stroke={2.4} />有点糊，字可能看不清</span>
        ) : null}
      </div>
      <div className="sview__guide">下滑删掉这张<Icon name="chevron-down" size={16} stroke={2.4} /></div>
      <div className="sview__tools">
        <button className="sview__tool" onClick={() => rotateShot(shot.id, -1)}><Icon name="rotate" size={24} stroke={2} style={{ transform: "scaleX(-1)" }} />向左转</button>
        <button className="sview__tool" disabled={shot.fromAlbum && !shot.raw} onClick={() => setEditing(shot.id)}><Icon name="corners" size={24} stroke={2} />调整四角</button>
        <button className="sview__tool" onClick={() => rotateShot(shot.id, 1)}><Icon name="rotate" size={24} stroke={2} />向右转</button>
        <button className="sview__tool sview__tool--danger" onClick={del}><Icon name="trash" size={24} stroke={2} />删除</button>
      </div>
      {editing && <QuadEditor id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
