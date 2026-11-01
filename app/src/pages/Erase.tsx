import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, InlineNav, Sheet } from "../components/ui";
import { IconSegmented } from "../components/v2";
import { clearErased, getFolder, loadErased, loadPhoto, saveErased, type Folder, type FolderPage } from "../lib/folders";
import { erasePaper, isErased, useErasing } from "../lib/erase";
import { toast, toastError } from "../store/banner";
import { useExports } from "../store/exports";
import "../styles/erase.css";

type Srcs = { original?: string | null; erased?: string | null };

/** 擦除手写的预览页：擦后 / 原图拖动对比，手动补擦（擦除笔 / 恢复笔），恢复原图，导出空白卷 PDF。 */
export function ErasePaper() {
  const { folderId = "", paperId = "" } = useParams();
  const [folder, setFolder] = useState<Folder>();
  const [index, setIndex] = useState(0);
  const [srcs, setSrcs] = useState<Record<string, Srcs>>({});
  const [mode, setMode] = useState<"compare" | "brush">("compare");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const progress = useErasing((s) => s.running[paperId]);
  const warning = useErasing((s) => s.warnings[paperId]);
  const submitExport = useExports((s) => s.submit);
  const started = useRef(false);

  const paper = folder?.papers.find((p) => p.id === paperId);
  const page: FolderPage | undefined = paper?.pages[Math.min(index, (paper?.pages.length ?? 1) - 1)];

  const reload = useCallback(async () => {
    const f = await getFolder(folderId);
    setFolder(f);
    return f;
  }, [folderId]);

  // 读当前这张的原图和擦后图（擦后图每次擦完都重新读）
  const loadSrcs = useCallback(async (pg: FolderPage) => {
    const [original, erased] = await Promise.all([loadPhoto(pg), loadErased(pg)]);
    setSrcs((s) => ({ ...s, [pg.id]: { original, erased } }));
  }, []);

  useEffect(() => {
    void reload().then((f) => {
      const p = f?.papers.find((x) => x.id === paperId);
      // 第一次进来、一张都没擦过：直接开始擦
      if (p && !isErased(p) && !started.current) {
        started.current = true;
        erasePaper(folderId, p).catch(toastError);
      }
    });
  }, [reload, folderId, paperId]);

  // 擦除进度变了（可能是从卡片上开始的）：重新读记录和当前这张
  useEffect(() => {
    void reload();
  }, [progress?.done, progress === undefined, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page) void loadSrcs(page);
  }, [page?.id, page?.erased, loadSrcs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!folder || !paper || !page) {
    return (
      <div className="screen">
        <InlineNav title="擦除手写" back />
      </div>
    );
  }

  const cur = srcs[page.id] ?? {};
  const total = paper.pages.length;
  const erasingThis = progress?.current === page.id;
  const pending = !!progress && !page.erased;

  const rerun = () => {
    erasePaper(folderId, paper, { pageIds: [page.id] }).catch(toastError);
  };

  const restoreAll = async () => {
    setConfirmRestore(false);
    try {
      await clearErased(folderId, paperId);
      await reload();
      setSrcs({});
      toast("已恢复原图");
    } catch (e) {
      toastError(e);
    }
  };

  const exportBlank = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const images: string[] = [];
      let missing = 0;
      for (const pg of paper.pages) {
        const e = await loadErased(pg);
        const src = e ?? (await loadPhoto(pg));
        if (!e) missing++;
        if (src) images.push(src);
      }
      if (!images.length) return toast("找不到照片");
      const job = await submitExport({ kind: "blank", title: `${paper.name} 空白卷`, images });
      if (!job) return toast("服务器还不支持导出空白卷，请稍后再试", "error");
      toast(missing ? `已开始生成；有 ${missing} 张还没擦，用的是原图` : "已开始生成，好了会提醒你，「我的导出」里也能找到");
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav title="擦除手写" back />
      <div className="screen__content screen__content--modal erase" style={{ gap: 12, paddingTop: 0 }}>
        <div className="erase__head">
          <span className="t-headline ellipsis" style={{ flex: 1, minWidth: 0 }}>{paper.name}</span>
          {total > 1 && <span className="t-foot c-sec">第 {index + 1} / {total} 张</span>}
        </div>

        {mode === "compare" && (
          <IconSegmented value={mode} onChange={setMode} options={[{ value: "compare", label: "前后对比", icon: "arrows" }, { value: "brush", label: "手动补擦", icon: "brush" }]} />
        )}

        {mode === "brush" && cur.original && cur.erased ? (
          <BrushEditor
            key={`${page.id}-${page.erased}`}
            original={cur.original}
            erased={cur.erased}
            onCancel={() => setMode("compare")}
            onSave={async (src) => {
              await saveErased(folderId, paperId, page.id, src);
              await reload();
              setMode("compare");
              toast("已保存");
            }}
          />
        ) : (
          <>
            <div className="erase__stage">
              {cur.original ? <Compare original={cur.original} erased={cur.erased ?? null} /> : <div className="erase__placeholder"><span className="spinner-ring" /></div>}
              {(erasingThis || (pending && !cur.erased)) && (
                <div className="erase__busy">
                  <span className="spinner-ring" />
                  <span className="t-headline">{erasingThis ? "正在擦除这一张…" : "排队等着擦…"}</span>
                  <span className="t-foot c-sec">每张大约 10–30 秒，离开这页也会继续</span>
                </div>
              )}
            </div>
            {total > 1 && (
              <div className="erase__pager">
                <button className="icon-btn" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="上一张"><Icon name="chevron-left" size={22} /></button>
                <div className="erase__dots">
                  {paper.pages.map((pg, i) => (
                    <button key={pg.id} className={`erase__dot${i === index ? " on" : ""}${pg.erased ? " done" : ""}`} onClick={() => setIndex(i)} aria-label={`第 ${i + 1} 张${pg.erased ? "（已擦）" : ""}`} />
                  ))}
                </div>
                <button className="icon-btn" disabled={index >= total - 1} onClick={() => setIndex(index + 1)} aria-label="下一张"><Icon name="chevron-right" size={22} /></button>
              </div>
            )}
            {warning && <p className="t-foot erase__warn"><Icon name="alert" size={14} stroke={2.4} /> {warning}</p>}
            {page.erased && !progress && (
              <p className="t-foot c-sec" style={{ padding: "0 4px" }}>左右拖动中间的竖线对比擦除前后。印刷字上的划线、圈默认保留（免得把字一起擦掉），可以用「手动补擦」抹掉。</p>
            )}
            <div className="erase__actions">
              <Button variant="tinted" icon="brush" disabled={!page.erased || !!progress} onClick={() => setMode("brush")}>手动补擦</Button>
              <Button variant="tinted" icon="refresh" disabled={!!progress} onClick={rerun}>{page.erased ? "重新擦这张" : "擦这张"}</Button>
            </div>
            <div className="bottom-bar">
              <Button variant="outline" disabled={!isErased(paper) || !!progress} onClick={() => setConfirmRestore(true)} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>恢复原图</Button>
              <Button icon="export" disabled={!isErased(paper) || !!progress || exporting} onClick={exportBlank} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{exporting ? "提交中…" : "导出空白卷 PDF"}</Button>
            </div>
          </>
        )}
      </div>
      <Sheet open={confirmRestore} onClose={() => setConfirmRestore(false)} title="恢复原图？">
        <p className="t-sub c-sec">会删掉这份试卷所有擦过的照片（包括手动补擦），回到拍摄时的样子。原图一直都在。</p>
        <Button variant="danger" onClick={restoreAll}>恢复原图</Button>
      </Sheet>
    </div>
  );
}

/** 擦后（左）/ 原图（右）叠在一起，拖动竖线对比 */
function Compare({ original, erased }: { original: string; erased: string | null }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = (e: ReactPointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !dragging.current) return;
    setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className="compare"
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); move(e); }}
      onPointerMove={move}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <img src={original} alt="原图" draggable={false} />
      {erased && (
        <>
          <img className="compare__top" src={erased} alt="擦除后" draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
          <span className="compare__line" style={{ left: `${pos}%` }}><span className="compare__knob"><Icon name="arrows" size={16} stroke={2.4} /></span></span>
          <span className="compare__tag compare__tag--l">擦除后</span>
          <span className="compare__tag compare__tag--r">原图</span>
        </>
      )}
    </div>
  );
}

const BRUSH = { s: 10, m: 22, l: 40 }; // 屏幕上的笔刷半径（像素）
const UNDO = 6;

/** 手动补擦：擦除笔把涂到的地方刷成附近的纸色，恢复笔把原图拷回来。整张图按原分辨率在画布上改。 */
function BrushEditor({ original, erased, onSave, onCancel }: { original: string; erased: string; onSave: (src: string) => Promise<void>; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orig = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<"erase" | "restore">("erase");
  const [size, setSize] = useState<keyof typeof BRUSH>("m");
  const [saving, setSaving] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const undo = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
    let alive = true;
    Promise.all([load(erased), load(original)]).then(([e, o]) => {
      const c = canvas.current;
      if (!alive || !c) return;
      c.width = e.naturalWidth;
      c.height = e.naturalHeight;
      c.getContext("2d", { willReadFrequently: true })!.drawImage(e, 0, 0);
      orig.current = o;
    }).catch(toastError);
    return () => {
      alive = false;
      undo.current = [];
      const c = canvas.current;
      if (c) c.width = c.height = 0; // 还掉画布内存（iOS 对画布总内存有上限）
    };
  }, [original, erased]);

  const toImage = (e: ReactPointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, r: BRUSH[size] * k };
  };

  /** 涂一个圆点 */
  const dab = (x: number, y: number, r: number) => {
    const c = canvas.current!;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    if (tool === "restore" && orig.current) {
      ctx.drawImage(orig.current, 0, 0, c.width, c.height);
    } else {
      ctx.fillStyle = paperColor(ctx, x, y, r, c.width, c.height);
      ctx.fill();
    }
    ctx.restore();
  };

  const stroke = (e: ReactPointerEvent) => {
    const p = toImage(e);
    const from = last.current ?? p;
    const dist = Math.hypot(p.x - from.x, p.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (p.r / 2)));
    for (let i = 1; i <= steps; i++) dab(from.x + ((p.x - from.x) * i) / steps, from.y + ((p.y - from.y) * i) / steps, p.r);
    last.current = p;
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    if (!c || !c.width) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    undo.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (undo.current.length > UNDO) undo.current.shift();
    setUndoCount(undo.current.length);
    last.current = null;
    stroke(e);
  };

  const back = () => {
    const snap = undo.current.pop();
    if (snap) canvas.current?.getContext("2d")?.putImageData(snap, 0, 0);
    setUndoCount(undo.current.length);
  };

  const save = async () => {
    if (!canvas.current || saving) return;
    setSaving(true);
    try {
      await onSave(canvas.current.toDataURL("image/jpeg", 0.88));
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="brush__bar">
        <IconSegmented value={tool} onChange={setTool} options={[{ value: "erase", label: "擦除笔", icon: "brush" }, { value: "restore", label: "恢复笔", icon: "refresh" }]} />
        <div className="brush__sizes" role="radiogroup" aria-label="笔刷大小">
          {(Object.keys(BRUSH) as (keyof typeof BRUSH)[]).map((k) => (
            <button key={k} role="radio" aria-checked={size === k} className={`brush__size${size === k ? " on" : ""}`} onClick={() => setSize(k)} aria-label={{ s: "细", m: "中", l: "粗" }[k]}>
              <span style={{ width: BRUSH[k] / 2 + 4, height: BRUSH[k] / 2 + 4 }} />
            </button>
          ))}
        </div>
      </div>
      <div className="erase__stage brush__stage">
        <canvas
          ref={canvas}
          className="brush__canvas"
          onPointerDown={down}
          onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") { if (last.current) stroke(e); } }}
          onPointerUp={() => { last.current = null; }}
          onPointerCancel={() => { last.current = null; }}
        />
      </div>
      <p className="t-foot c-sec" style={{ padding: "0 4px" }}>{tool === "erase" ? "在没擦干净的笔迹上涂抹，涂到的地方变成纸色。" : "在误擦的地方涂抹，把原图拷回来。"}</p>
      <div className="bottom-bar">
        <Button variant="outline" onClick={onCancel} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>取消</Button>
        <Button variant="tinted" icon="loop" disabled={!undoCount} onClick={back} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>撤销</Button>
        <Button icon="check" disabled={saving} onClick={save} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{saving ? "保存中…" : "保存"}</Button>
      </div>
    </>
  );
}

/** 笔刷附近的纸色：取周围一圈像素里较亮的四成取平均，避开墨迹 */
function paperColor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, h: number): string {
  const R = Math.ceil(r * 2.5);
  const x0 = Math.max(0, Math.floor(x - R)), y0 = Math.max(0, Math.floor(y - R));
  const x1 = Math.min(w, Math.ceil(x + R)), y1 = Math.min(h, Math.ceil(y + R));
  if (x1 <= x0 || y1 <= y0) return "#fff";
  const px = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const lum: number[] = [];
  for (let i = 0; i < px.length; i += 16) lum.push(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114); // 隔 4 个像素取一个，够用
  const cut = [...lum].sort((a, b) => a - b)[Math.floor(lum.length * 0.6)] ?? 0;
  let r0 = 0, g0 = 0, b0 = 0, n = 0;
  for (let i = 0, j = 0; i < px.length; i += 16, j++) {
    if (lum[j] < cut) continue;
    r0 += px[i]; g0 += px[i + 1]; b0 += px[i + 2]; n++;
  }
  return n ? `rgb(${Math.round(r0 / n)},${Math.round(g0 / n)},${Math.round(b0 / n)})` : "#fff";
}
