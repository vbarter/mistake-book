import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { RecognizedItem } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, InlineNav } from "../../components/ui";
import { clampBox, cropToDataUrl, newId, type Box } from "../../lib/boxes";
import { haptic } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { MAX_BOXES, totalBoxes, useCapture } from "../../store/capture";

type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; orig: Box }
  | { kind: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; orig: Box }
  | { kind: "draw"; id: string; startX: number; startY: number };

const HANDLE = 16;

/** 录题第 1 步：在试卷图上拖拽框选错题。坐标以图片原始像素存储，显示时按比例缩放。 */
export default function Crop() {
  const nav = useNavigate();
  const { pages, setBoxes, setItems } = useCapture();
  const [pageIdx, setPageIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number; elapsed: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const dragRef = useRef<Drag | null>(null);
  const abortRef = useRef(false);

  const page = pages[pageIdx];
  const total = totalBoxes(pages);

  useEffect(() => {
    if (pages.length === 0) nav("/capture", { replace: true });
  }, [pages.length, nav]);

  // 显示比例：容器宽 / 图片原始宽
  const measure = useCallback(() => {
    if (wrapRef.current && page) setScale(wrapRef.current.clientWidth / page.width);
  }, [page]);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const boxes = page?.boxes ?? [];
  const update = (next: Box[]) => page && setBoxes(page.id, next);

  const toImage = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const onPointerDown = (e: React.PointerEvent, target: { kind: "box"; id: string } | { kind: "handle"; id: string; corner: "nw" | "ne" | "sw" | "se" } | { kind: "bg" }) => {
    if (!page) return;
    const p = toImage(e);
    if (target.kind === "bg") {
      if (!addMode) {
        setSelected(null);
        return;
      }
      if (total >= MAX_BOXES) {
        toast(`最多框选 ${MAX_BOXES} 道题`);
        return;
      }
      const id = newId();
      update([...boxes, { id, x: p.x, y: p.y, w: 1, h: 1 }]);
      dragRef.current = { kind: "draw", id, startX: p.x, startY: p.y };
      setSelected(id);
    } else {
      const orig = boxes.find((b) => b.id === target.id)!;
      setSelected(target.id);
      void haptic.selection();
      dragRef.current =
        target.kind === "box"
          ? { kind: "move", id: target.id, startX: p.x, startY: p.y, orig }
          : { kind: "resize", id: target.id, corner: target.corner, startX: p.x, startY: p.y, orig };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !page) return;
    const p = toImage(e);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    const W = page.width;
    const H = page.height;
    update(
      boxes.map((b) => {
        if (b.id !== d.id) return b;
        if (d.kind === "move") return clampBox({ ...b, x: d.orig.x + dx, y: d.orig.y + dy }, W, H);
        if (d.kind === "draw") {
          const x = Math.min(d.startX, p.x);
          const y = Math.min(d.startY, p.y);
          return clampBox({ ...b, x, y, w: Math.abs(dx), h: Math.abs(dy) }, W, H, 1);
        }
        const o = d.orig;
        let { x, y, w, h } = o;
        if (d.corner.includes("w")) { x = o.x + dx; w = o.w - dx; }
        if (d.corner.includes("e")) w = o.w + dx;
        if (d.corner.includes("n")) { y = o.y + dy; h = o.h - dy; }
        if (d.corner.includes("s")) h = o.h + dy;
        if (w < 40) { if (d.corner.includes("w")) x = o.x + o.w - 40; w = 40; }
        if (h < 40) { if (d.corner.includes("n")) y = o.y + o.h - 40; h = 40; }
        return clampBox({ ...b, x, y, w, h }, W, H);
      }),
    );
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "draw") {
      const b = boxes.find((x) => x.id === d.id);
      if (b && (b.w < 40 || b.h < 30)) {
        update(boxes.filter((x) => x.id !== d.id));
        setSelected(null);
      } else {
        setAddMode(false);
      }
    }
  };

  const remove = () => {
    if (!selected) return;
    const removed = boxes.find((b) => b.id === selected);
    update(boxes.filter((b) => b.id !== selected));
    setSelected(null);
    if (removed) {
      toast("已删除框选", "info");
    }
  };

  const recognize = async () => {
    abortRef.current = false;
    const crops: { image: string }[] = [];
    setProgress({ stage: "正在裁剪题目", pct: 5, elapsed: 0 });
    try {
      for (const pg of pages) {
        for (const b of pg.boxes) {
          crops.push({ image: await cropToDataUrl(pg.src, b) });
        }
      }
      if (abortRef.current) return;
      const startedAt = Date.now();
      setProgress({ stage: "正在上传截图", pct: 12, elapsed: 0 });
      // 进度随时间渐近推进（不会停死在某个值），阶段文案按经验时长切换
      const ticker = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const pct = Math.round(12 + 83 * (1 - Math.exp(-elapsed / 30)));
        const stage = elapsed < 6 ? "正在上传截图" : elapsed < 20 ? "正在读题目文字" : elapsed < 35 ? "正在归类知识点" : "正在生成解析";
        setProgress({ stage, pct, elapsed });
      }, 1000);
      let items: RecognizedItem[];
      try {
        const res = await api<{ items: RecognizedItem[] }>("/api/recognize", { method: "POST", body: { crops }, timeoutMs: 150000 });
        // 服务端不回传截图，按 index 回填本地裁剪图
        items = res.items.map((it, i) => ({ ...it, stemImage: crops[it.index ?? i]?.image ?? crops[i]?.image ?? "", reasons: [], note: "" }));
      } finally {
        clearInterval(ticker);
      }
      if (abortRef.current) return;
      setProgress({ stage: "完成", pct: 100, elapsed: Math.round((Date.now() - startedAt) / 1000) });
      setItems(items);
      void haptic.success();
      nav("/capture/review");
    } catch (e) {
      toastError(e);
    } finally {
      setProgress(null);
    }
  };

  const selectedIndex = useMemo(() => {
    let n = 0;
    for (let i = 0; i < pageIdx; i++) n += pages[i].boxes.length;
    return n + boxes.findIndex((b) => b.id === selected) + 1;
  }, [pages, pageIdx, boxes, selected]);

  if (!page) return null;

  return (
    <div className="screen" style={{ background: "#1c1c1e", color: "#f2f2f7" }}>
      <InlineNav
        title="框选错题"
        subtitle="第 1 步，共 2 步"
        back
        backLabel="拍摄"
        right={<button className="nav-btn" style={{ color: "#5b8dff" }} onClick={() => nav("/capture")}>重拍</button>}
      />
      <div className="screen__content screen__content--modal" style={{ gap: 10, padding: "0 12px calc(var(--safe-bottom) + 12px)" }}>
        <div style={{ flex: 1, overflowY: "auto", borderRadius: 8, background: "#000", WebkitOverflowScrolling: "touch" }}>
          <div
            ref={wrapRef}
            style={{ position: "relative", width: "100%", touchAction: addMode ? "none" : "pan-y", userSelect: "none" }}
            onPointerDown={(e) => onPointerDown(e, { kind: "bg" })}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img src={page.src} alt="试卷" style={{ width: "100%", display: "block", pointerEvents: "none" }} onLoad={measure} draggable={false} />
            {boxes.map((b, i) => {
              const on = b.id === selected;
              const color = on ? "#ff9f0a" : "#5b8dff";
              const num = pages.slice(0, pageIdx).reduce((n, p) => n + p.boxes.length, 0) + i + 1;
              return (
                <div
                  key={b.id}
                  role="button"
                  aria-label={`第 ${num} 题框选${on ? "，已选中" : ""}`}
                  style={{
                    position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale,
                    border: `2px solid ${color}`, borderRadius: 6, background: on ? "rgba(255,159,10,.12)" : "rgba(91,141,255,.10)", touchAction: "none", cursor: "move",
                  }}
                  onPointerDown={(e) => onPointerDown(e, { kind: "box", id: b.id })}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <span style={{ position: "absolute", top: -11, left: -2, height: 20, padding: "0 7px", borderRadius: 10, background: color, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center" }}>{num}</span>
                  {on &&
                    (["nw", "ne", "sw", "se"] as const).map((c) => (
                      <span
                        key={c}
                        aria-hidden="true"
                        style={{
                          position: "absolute", width: HANDLE + 12, height: HANDLE + 12, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none",
                          left: c.includes("w") ? -(HANDLE + 12) / 2 : undefined, right: c.includes("e") ? -(HANDLE + 12) / 2 : undefined,
                          top: c.includes("n") ? -(HANDLE + 12) / 2 : undefined, bottom: c.includes("s") ? -(HANDLE + 12) / 2 : undefined,
                          cursor: `${c}-resize`,
                        }}
                        onPointerDown={(e) => onPointerDown(e, { kind: "handle", id: b.id, corner: c })}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                      >
                        <span style={{ width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, background: "#fff", border: "2.5px solid #ff9f0a" }} />
                      </span>
                    ))}
                </div>
              );
            })}
          </div>
        </div>

        {pages.length > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16 }}>
            <button className="icon-btn" style={{ color: "#f2f2f7" }} aria-label="上一页" disabled={pageIdx === 0} onClick={() => { setPageIdx((i) => i - 1); setSelected(null); }}><Icon name="chevron-left" /></button>
            <span className="t-sub num">第 {pageIdx + 1} / {pages.length} 页</span>
            <button className="icon-btn" style={{ color: "#f2f2f7" }} aria-label="下一页" disabled={pageIdx === pages.length - 1} onClick={() => { setPageIdx((i) => i + 1); setSelected(null); }}><Icon name="chevron-right" /></button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="t-sub" style={{ fontWeight: 600 }}>
            已框选 {total} 题 <span style={{ color: "#a1a1aa", fontWeight: 500 }}>· 最多 {MAX_BOXES} 题</span>
          </span>
          <span className="t-foot" style={{ color: "#ff9f0a", fontWeight: 600 }}>
            {addMode ? "在空白处拖出一个框" : selected ? `拖动橙色角点调整第 ${selectedIndex} 题` : "点一下框可以调整"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn--sm" style={{ flex: 1, background: addMode ? "#ff9f0a" : "#2c2c2e", color: addMode ? "#000" : "#f2f2f7" }} onClick={() => { setAddMode((v) => !v); setSelected(null); }} aria-pressed={addMode}>
            <Icon name="viewfinder" size={20} />
            {addMode ? "取消新增" : "新增框选"}
          </button>
          <button className="btn btn--sm" style={{ flex: 1, background: "#2c2c2e", color: "#f2f2f7" }} onClick={remove} disabled={!selected}>
            <Icon name="trash" size={20} />
            删除此框
          </button>
        </div>
        <Button onClick={recognize} disabled={total === 0 || Boolean(progress)}>
          识别 {total} 道错题
        </Button>
      </div>

      {progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }} role="dialog" aria-live="polite">
          <div className="card" style={{ width: "100%", maxWidth: 360, alignItems: "center", textAlign: "center", gap: 14, color: "var(--label)" }}>
            <Icon name="sparkles" size={36} style={{ color: "var(--brand)" }} />
            <h2 className="t-title3">AI 正在识别错题</h2>
            <p className="t-sub c-sec">{progress.stage}…</p>
            <div className="bar" style={{ width: "100%" }}><span style={{ width: `${progress.pct}%`, background: "var(--brand)", transition: "width .9s linear" }} /></div>
            <span className="t-foot c-sec num">
              {progress.elapsed > 0 ? `已用 ${progress.elapsed} 秒 · ` : ""}通常 {Math.max(10, total * 8)} 秒左右
            </span>
            {progress.elapsed >= 30 && (
              <span className="t-foot" style={{ color: "var(--due)", fontWeight: 500 }}>网络有点慢，正在等待服务器返回，请稍候</span>
            )}
            <Button variant="plain" onClick={() => { abortRef.current = true; setProgress(null); }} style={{ height: 44 }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}
