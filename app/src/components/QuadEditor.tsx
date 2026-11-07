import { useEffect, useRef, useState } from "react";
import type { Pt, Quad } from "../lib/docDetect";
import { isConvex } from "../lib/docDetect";
import { haptic } from "../lib/native";
import { detectInImage } from "../lib/scanProcess";
import { toast } from "../store/banner";
import { setQuad, useScan } from "../store/scan";
import { Icon } from "./Icon";

const FULL: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
const LOUPE = 104;
const ZOOM = 2.5;

/**
 * 调整四角：在原图上拖四个角（或四条边的中点，一次挪两个角），按住时角上出放大镜看清纸边。
 * 「重新识别」= 回到自动找的框（拍下时没找到就再找一次）；「整张不裁」= 用原图。完成后后台重新拉正。
 */
export function QuadEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const shot = useScan((s) => s.shots.find((x) => x.id === id));
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [q, setQ] = useState<Quad>(() => (shot?.quad ?? shot?.autoQuad ?? FULL).map((p) => [...p]) as Quad);
  const [whole, setWhole] = useState(!shot?.quad);
  const [active, setActive] = useState<{ kind: "c" | "e"; i: number } | null>(null);
  const [finding, setFinding] = useState(false);
  const grab = useRef<{ start: Quad; px: number; py: number } | null>(null);

  // 原图按比例放进可用区域
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !shot) return;
    const fit = () => {
      const pad = 24;
      const W = el.clientWidth - pad * 2;
      const H = el.clientHeight - pad * 2;
      const s = Math.min(W / shot.rawW, H / shot.rawH);
      const w = shot.rawW * s;
      const h = shot.rawH * s;
      setBox({ x: (el.clientWidth - w) / 2, y: (el.clientHeight - h) / 2, w, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot]);

  if (!shot) return null;

  const toView = ([x, y]: Pt): Pt => (box ? [box.x + x * box.w, box.y + y * box.h] : [0, 0]);
  const pts = q.map(toView);
  const mids = [0, 1, 2, 3].map((i) => {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt;
  });

  const pointer = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as Pt;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!box) return;
    const [px, py] = pointer(e);
    // 找最近的角或边中点（手指够得着的范围内）
    let best: { kind: "c" | "e"; i: number; d: number } | null = null;
    pts.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < 44 && (!best || d < best.d)) best = { kind: "c", i, d };
    });
    mids.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < 30 && (!best || d < best.d - 6)) best = { kind: "e", i, d };
    });
    if (!best) return;
    const b = best as { kind: "c" | "e"; i: number };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    grab.current = { start: q.map((p) => [...p]) as Quad, px, py };
    setActive({ kind: b.kind, i: b.i });
    setWhole(false);
    void haptic.selection();
  };

  const onMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || !active || !box) return;
    const [px, py] = pointer(e);
    const dx = (px - g.px) / box.w;
    const dy = (py - g.py) / box.h;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const next = g.start.map((p) => [...p]) as Quad;
    const move = (i: number) => { next[i] = [clamp(g.start[i][0] + dx), clamp(g.start[i][1] + dy)]; };
    if (active.kind === "c") move(active.i);
    else { move(active.i); move((active.i + 1) % 4); }
    if (isConvex(next)) setQ(next);
  };

  const onUp = () => {
    grab.current = null;
    setActive(null);
  };

  const redetect = async () => {
    setFinding(true);
    try {
      const found = shot.autoQuad ?? (await detectInImage(shot.raw));
      if (found) {
        setQ(found.map((p) => [...p]) as Quad);
        setWhole(false);
      } else toast("没找到试卷的边，可以手动拖四个角");
    } finally {
      setFinding(false);
    }
  };

  const done = () => {
    setQuad(id, whole ? null : q);
    onClose();
  };

  // 放大镜：显示正在拖的那个点附近；点在左上角时放到右上角，免得挡住手指
  let loupe: React.ReactNode = null;
  if (active && box) {
    const p = active.kind === "c" ? pts[active.i] : mids[active.i];
    const left = p[0] < 140 && p[1] < 160 ? (stageRef.current?.clientWidth ?? 0) - LOUPE - 16 : 16;
    loupe = (
      <div
        className="qedit__loupe"
        style={{
          left,
          top: 16,
          backgroundImage: `url(${shot.raw})`,
          backgroundSize: `${box.w * ZOOM}px ${box.h * ZOOM}px`,
          backgroundPosition: `${LOUPE / 2 - (p[0] - box.x) * ZOOM}px ${LOUPE / 2 - (p[1] - box.y) * ZOOM}px`,
        }}
      />
    );
  }

  return (
    <div className="qedit" role="dialog" aria-modal="true" aria-label="调整四角">
      <div className="qedit__top">
        <button onClick={onClose}>取消</button>
        <span className="sview__title">调整四角</span>
        <button className="ok" onClick={done}>完成</button>
      </div>
      <div className="qedit__stage" ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {box && <img className="qedit__img" src={shot.raw} alt="原图" draggable={false} style={{ left: box.x, top: box.y, width: box.w, height: box.h, filter: whole ? "none" : "brightness(.7)" }} />}
        {box && (
          <svg className="qedit__svg">
            {whole ? (
              <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="var(--scan)" strokeWidth={2.5} strokeDasharray="8 6" />
            ) : (
              <>
                <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="rgba(255,255,255,.08)" stroke="var(--scan)" strokeWidth={2.5} strokeLinejoin="round" />
                {mids.map(([x, y], i) => {
                  const a = pts[i];
                  const b = pts[(i + 1) % 4];
                  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
                  return <rect key={`m${i}`} x={x - 10} y={y - 4} width={20} height={8} rx={4} fill="#fff" stroke="var(--scan)" strokeWidth={2} transform={`rotate(${ang} ${x} ${y})`} />;
                })}
                {pts.map(([x, y], i) => {
                  const on = active?.kind === "c" && active.i === i;
                  return <circle key={`c${i}`} cx={x} cy={y} r={on ? 15 : 12} fill={on ? "var(--scan)" : "rgba(255,255,255,.9)"} stroke="var(--scan)" strokeWidth={3} />;
                })}
              </>
            )}
          </svg>
        )}
        {loupe}
      </div>
      <div className="qedit__tools">
        <button className="sview__tool" disabled={finding} onClick={redetect}><Icon name="refresh" size={24} stroke={2} />重新识别</button>
        <button className="sview__tool" onClick={() => { setWhole(true); setQ(FULL.map((p) => [...p]) as Quad); }}><Icon name="viewfinder" size={24} stroke={2} />整张不裁</button>
      </div>
    </div>
  );
}
