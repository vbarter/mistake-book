import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, InlineNav, Sheet } from "../components/ui";
import { clearErased, getFolder, loadErased, loadPhoto, type Folder, type FolderPage } from "../lib/folders";
import { erasePaper, isErased, useErasing } from "../lib/erase";
import { useJobs } from "../lib/jobs";
import { toast, toastError } from "../store/banner";
import { useExports } from "../store/exports";
import "../styles/erase.css";

type Srcs = { original?: string | null; erased?: string | null };

/** 擦除手写的预览页：擦后 / 原图拖动对比，一键擦除整份试卷，恢复原图，导出空白卷 PDF。 */
export function ErasePaper() {
  const { folderId = "", paperId = "" } = useParams();
  const [folder, setFolder] = useState<Folder>();
  const [index, setIndex] = useState(0);
  const [srcs, setSrcs] = useState<Record<string, Srcs>>({});
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

  // 轮询取回了擦好的照片、进度变了（可能是从卡片上开始的）：重新读记录和当前这张
  const jobsVersion = useJobs((s) => s.version);
  useEffect(() => {
    void reload();
  }, [jobsVersion, progress?.done, progress === undefined, reload]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // 后台在擦（重开 App 后第一次轮询前 progress 还没有，看试卷上记的任务）
  const busy = !!progress || !!paper.eraseJob;
  const startedAt = progress?.startedAt ?? paper.eraseJob?.startedAt ?? "";
  const done = progress?.done ?? paper.eraseJob?.done ?? 0;
  const jobTotal = progress?.total ?? paper.eraseJob?.total ?? total;
  const pageFresh = !!page.erased && page.erased >= startedAt; // 这张在这次任务里已经擦好、取回来了

  const eraseAll = () => {
    erasePaper(folderId, paper).catch(toastError);
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

        <div className="erase__stage">
          {cur.original ? <Compare original={cur.original} erased={cur.erased ?? null} /> : <div className="erase__placeholder"><span className="spinner-ring" /></div>}
          {busy && !pageFresh && (
            <div className="erase__busy">
              <span className="spinner-ring" />
              <span className="t-headline">{progress?.uploading ? "正在上传照片…" : `正在擦除 · 已完成 ${done}/${jobTotal} 张`}</span>
              <span className="t-foot c-sec">在服务器后台擦，可以离开这页或切出 App，擦好了会提醒你</span>
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
        {page.erased && !busy && (
          <p className="t-foot c-sec" style={{ padding: "0 4px" }}>左右拖动中间的竖线对比擦除前后。</p>
        )}
        <Button variant="tinted" icon="brush" disabled={busy} onClick={eraseAll}>{busy ? (progress?.uploading ? "上传中…" : `擦除中 ${done}/${jobTotal}…`) : isErased(paper) ? "重新擦除" : "擦除"}</Button>
        <div className="bottom-bar">
          <Button variant="outline" disabled={!isErased(paper) || busy} onClick={() => setConfirmRestore(true)} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>恢复原图</Button>
          <Button icon="export" disabled={!isErased(paper) || busy || exporting} onClick={exportBlank} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{exporting ? "提交中…" : "导出空白卷 PDF"}</Button>
        </div>
      </div>
      <Sheet open={confirmRestore} onClose={() => setConfirmRestore(false)} title="恢复原图？">
        <p className="t-sub c-sec">会删掉这份试卷所有擦过的照片，回到拍摄时的样子。原图一直都在。</p>
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
