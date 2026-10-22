import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { RecognizedItem } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../../components/ui";
import { cropToDataUrl } from "../../lib/boxes";
import { createFolder, defaultFolderName, deleteFolder, getFolder, listFolders, saveFolder, toPage, type Folder } from "../../lib/folders";
import { formatDate } from "../../lib/format";
import { downscale, haptic, isNative, pickImage, pickImages } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { MAX_PAGES, useCapture, type CapturePage } from "../../store/capture";

type Progress = { stage: string; pct: number; elapsed: number };

/** 录入试卷：拍照 / 相册多选 → 自动归入试卷夹（本地保存）→ 整页扫描识别错题 → 核对。 */
export default function Capture() {
  const nav = useNavigate();
  const loc = useLocation();
  const { folderId, folderName, pages, setFolder, setFolderName, addPage, removePage, setItems, reset, returnTo } = useCapture();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [rename, setRename] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Folder | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const abortRef = useRef(false);
  const autoStarted = useRef(false);

  const refreshFolders = () => listFolders().then(setFolders).catch(() => setFolders([]));
  useEffect(() => {
    void refreshFolders();
  }, [folderId, pages.length]);

  /** 当前页面持久化到试卷夹（第一次加页时自动新建）。 */
  const persist = async (nextPages: CapturePage[], name = folderName) => {
    if (nextPages.length === 0) return;
    if (!folderId) {
      const f = await createFolder(name || defaultFolderName(), nextPages.map(({ id, src, width, height }) => ({ id, src, width, height })));
      setFolder(f.id, f.name, nextPages);
      return;
    }
    const existing = await getFolder(folderId);
    if (existing) await saveFolder({ ...existing, name: name || existing.name, pages: nextPages.map(({ id, src, width, height }) => ({ id, src, width, height })) });
  };

  const addSources = async (sources: string[]) => {
    const room = MAX_PAGES - pages.length;
    if (room <= 0) {
      toast(`一个试卷夹最多 ${MAX_PAGES} 页`);
      return;
    }
    const added: CapturePage[] = [];
    for (const src of sources.slice(0, room)) {
      const p = await toPage(src);
      added.push({ ...p, boxes: [] });
    }
    if (sources.length > room) toast(`只保留前 ${room} 张，一个试卷夹最多 ${MAX_PAGES} 页`);
    added.forEach(addPage);
    await persist([...pages, ...added]);
    void haptic.light();
  };

  const pick = async (source: "camera" | "photos" | "sample") => {
    setBusy(true);
    try {
      if (source === "sample") {
        await addSources([`${import.meta.env.BASE_URL}sample-paper.svg`]);
      } else if (source === "photos") {
        const list = await pickImages(MAX_PAGES);
        if (list.length) await addSources(list);
      } else {
        const src = await pickImage("camera");
        if (src) await addSources([src]);
      }
    } catch (e) {
      if ((e as Error).message === "permission_denied") setDenied(true);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // 从今天页「拍照 / 从相册选」直接进入：自动打开一次
  useEffect(() => {
    const state = loc.state as { source?: "camera" | "photos"; first?: boolean } | null;
    if (!autoStarted.current && pages.length === 0 && state && (state.source || (state.first && isNative))) {
      autoStarted.current = true;
      void pick(state.source ?? "camera");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFolder = async (f: Folder) => {
    setFolder(f.id, f.name, f.pages.map((p) => ({ ...p, boxes: p.boxes ?? [] })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeCurrentPage = async (id: string) => {
    const next = pages.filter((p) => p.id !== id);
    removePage(id);
    if (folderId) {
      const existing = await getFolder(folderId);
      if (existing) await saveFolder({ ...existing, pages: existing.pages.filter((p) => p.id !== id) });
    }
    if (next.length === 0 && folderId) {
      await deleteFolder(folderId);
      setFolder(null, "", []);
    }
  };

  const saveName = async () => {
    const name = nameDraft.trim() || defaultFolderName();
    setFolderName(name);
    if (folderId) {
      const existing = await getFolder(folderId);
      if (existing) await saveFolder({ ...existing, name });
    }
    setRename(false);
    void refreshFolders();
  };

  /** 整页扫描：把每页压到 1400px 上传，AI 返回错题与位置；按 bbox 裁出缩略图进入核对页。 */
  const scan = async () => {
    if (pages.length === 0) return;
    abortRef.current = false;
    setProgress({ stage: "正在压缩试卷", pct: 5, elapsed: 0 });
    try {
      const uploads: { image: string }[] = [];
      for (const p of pages) uploads.push({ image: await downscale(p.src, 1400, 0.8) });
      if (abortRef.current) return;
      const startedAt = Date.now();
      setProgress({ stage: "正在上传试卷", pct: 12, elapsed: 0 });
      const ticker = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const pct = Math.round(12 + 83 * (1 - Math.exp(-elapsed / 35)));
        const stage = elapsed < 6 ? "正在上传试卷" : elapsed < 25 ? "正在找出错题" : elapsed < 45 ? "正在识别题目与知识点" : "正在生成解析";
        setProgress({ stage, pct, elapsed });
      }, 1000);
      let items: RecognizedItem[];
      try {
        const res = await api<{ items: RecognizedItem[] }>("/api/scan", { method: "POST", body: { pages: uploads }, timeoutMs: 180000 });
        items = [];
        for (const it of res.items) {
          const page = pages[Math.min(Math.max(it.page ?? 0, 0), pages.length - 1)];
          const [x0, y0, x1, y1] = it.bbox && it.bbox.length === 4 ? it.bbox : [0, 0, 1, 1];
          const box = { id: "b", x: x0 * page.width, y: y0 * page.height, w: Math.max(40, (x1 - x0) * page.width), h: Math.max(30, (y1 - y0) * page.height) };
          const stemImage = await cropToDataUrl(page.src, box, 1000, 0.8);
          items.push({ ...it, stemImage, reasons: [], note: "" });
        }
      } finally {
        clearInterval(ticker);
      }
      if (abortRef.current) return;
      if (items.length === 0) {
        setProgress(null);
        toast("没有找到被判错的题目，可以改用手动框选", "info");
        return;
      }
      if (folderId) {
        const existing = await getFolder(folderId);
        if (existing) await saveFolder({ ...existing, scannedAt: new Date().toISOString() });
      }
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

  const leave = () => {
    nav(returnTo, { replace: true });
    reset();
  };

  const otherFolders = folders.filter((f) => f.id !== folderId);

  return (
    <div className="screen">
      <InlineNav
        title="录入试卷"
        subtitle={pages.length ? `${folderName || "未命名试卷夹"} · ${pages.length} 页` : "拍照或从相册多选"}
        right={<button className="nav-btn" onClick={leave}>{pages.length ? "完成" : "取消"}</button>}
      />
      <div className="screen__content screen__content--modal" style={{ gap: 16, paddingTop: 4 }}>
        {denied && (
          <Empty icon="camera" title="需要相机或相册权限" text="可以在系统设置里打开，或先用示例试卷试试。" action={<Button size="xs" variant="plain" onClick={() => pick("sample")}>用示例试卷试试</Button>} />
        )}

        {pages.length === 0 && !denied && (
          <Empty
            icon="camera"
            title="把试卷平放，对准整页拍"
            text="也可以从相册一次选多张；选中的试卷会放进一个试卷夹里，随时可以回来继续。"
            action={<Button size="xs" variant="plain" onClick={() => pick("sample")} disabled={busy}>没有试卷？用示例试卷试试</Button>}
          />
        )}

        {pages.length > 0 && (
          <div className="card" style={{ gap: 12 }}>
            <button style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", minHeight: 36 }} onClick={() => { setNameDraft(folderName); setRename(true); }} aria-label="重命名试卷夹">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="book" size={20} style={{ color: "var(--brand)" }} />
                <span className="t-headline">{folderName || "未命名试卷夹"}</span>
              </span>
              <span className="t-foot" style={{ color: "var(--brand)" }}>重命名</span>
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {pages.map((p, i) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <img src={p.src} alt={`第 ${i + 1} 页`} style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 10, border: "1px solid var(--separator-light)" }} />
                  <span className="chip chip--sm" style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}>第 {i + 1} 页</span>
                  <button className="icon-btn" style={{ position: "absolute", right: 0, bottom: 0, width: 36, height: 36, color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: "10px 0 10px 0" }} aria-label="删除这页" onClick={() => removeCurrentPage(p.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
              {pages.length < MAX_PAGES && (
                <button style={{ aspectRatio: "3 / 4", borderRadius: 10, border: "1.5px dashed var(--separator)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--brand)" }} onClick={() => pick("photos")} disabled={busy}>
                  <Icon name="plus" size={24} stroke={2.2} />
                  <span className="t-foot">加页</span>
                </button>
              )}
            </div>
            <span className="t-foot c-sec">已自动保存到试卷夹 · 最多 {MAX_PAGES} 页</span>
          </div>
        )}

        {otherFolders.length > 0 && (
          <div className="group">
            <div className="group__header"><span>试卷夹</span><span style={{ fontWeight: 500 }}>{otherFolders.length} 个</span></div>
            {otherFolders.map((f) => (
              <div key={f.id} className="row" style={{ minHeight: 64 }}>
                <img src={f.pages[0]?.src} alt="" style={{ width: 40, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid var(--separator-light)" }} />
                <button className="row__main" style={{ textAlign: "left" }} onClick={() => openFolder(f)}>
                  <span className="row__title ellipsis">{f.name}</span>
                  <span className="row__sub">{f.pages.length} 页 · {formatDate(f.updatedAt)}{f.scannedAt ? " · 已扫描" : ""}</span>
                </button>
                <button className="icon-btn" style={{ color: "var(--wrong)" }} aria-label="删除试卷夹" onClick={() => setConfirmDelete(f)}>
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="tinted" icon="camera" onClick={() => pick("camera")} disabled={busy || pages.length >= MAX_PAGES} style={{ flex: 1 }}>{pages.length ? "再拍一页" : "拍照"}</Button>
            <Button variant="tinted" icon="photo" onClick={() => pick("photos")} disabled={busy || pages.length >= MAX_PAGES} style={{ flex: 1 }}>从相册选</Button>
          </div>
          <Button icon="sparkles" onClick={scan} disabled={pages.length === 0 || busy}>
            {busy ? "处理中…" : `扫描识别错题${pages.length > 1 ? `（${pages.length} 页）` : ""}`}
          </Button>
          {pages.length > 0 && (
            <button className="t-sub" style={{ color: "var(--brand)", fontWeight: 500, minHeight: 36 }} onClick={() => nav("/capture/crop")}>
              改用手动框选
            </button>
          )}
        </div>
      </div>

      <Sheet open={rename} onClose={() => setRename(false)} title="试卷夹名称">
        <input className="input" autoFocus value={nameDraft} maxLength={30} placeholder={defaultFolderName()} onChange={(e) => setNameDraft(e.target.value)} />
        <Button onClick={saveName}>保存</Button>
      </Sheet>

      <Sheet open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title={`删除「${confirmDelete?.name}」？`}>
        <p className="t-sub c-sec">只删除本机保存的 {confirmDelete?.pages.length} 页试卷图片，已入库的错题不受影响。</p>
        <Button variant="danger" onClick={async () => { if (confirmDelete) { await deleteFolder(confirmDelete.id); setConfirmDelete(null); void refreshFolders(); } }}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(null)}>取消</Button>
      </Sheet>

      {progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }} role="dialog" aria-live="polite">
          <div className="card" style={{ width: "100%", maxWidth: 360, alignItems: "center", textAlign: "center", gap: 14 }}>
            <Icon name="sparkles" size={36} style={{ color: "var(--brand)" }} />
            <h2 className="t-title3">AI 正在扫描试卷</h2>
            <p className="t-sub c-sec">{progress.stage}…</p>
            <div className="bar" style={{ width: "100%" }}><span style={{ width: `${progress.pct}%`, background: "var(--brand)", transition: "width .9s linear" }} /></div>
            <span className="t-foot c-sec num">{progress.elapsed > 0 ? `已用 ${progress.elapsed} 秒 · ` : ""}通常 {20 + pages.length * 15} 秒左右</span>
            {progress.elapsed >= 40 && <span className="t-foot" style={{ color: "var(--due)", fontWeight: 500 }}>网络有点慢，正在等待服务器返回，请稍候</span>}
            <Button variant="plain" onClick={() => { abortRef.current = true; setProgress(null); }} style={{ height: 44 }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}
