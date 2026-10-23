import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { DigitizedResult } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../../components/ui";
import { addPaper, deletePaper, getFolder, saveFolder, toPage, updatePaper, validDigitized } from "../../lib/folders";
import { haptic, pickImage, pickImages, prepareUpload, type UploadPart } from "../../lib/native";
import { getCity } from "../../lib/prefs";
import { toast, toastError } from "../../store/banner";
import { MAX_PAGES, useCapture, type CapturePage } from "../../store/capture";

type Progress = { stage: string; pct: number; elapsed: number };
type EntryState = { folderId?: string | null; paperId?: string | null; source?: "camera" | "photos" | "sample" } | null;

/** 服务端按上传片段编号；把 page 换回试卷里的照片下标，并把片段内的 bbox 横向映射回整页坐标 */
function remapParts(res: DigitizedResult, parts: UploadPart[]): Pick<DigitizedResult, "pages" | "questions"> {
  const part = (i: number) => parts[i] ?? { page: i, x0: 0, w: 1, image: "" };
  const mapBox = (b: number[], p: UploadPart) => (b.length === 4 ? [p.x0 + b[0] * p.w, b[1], p.x0 + b[2] * p.w, b[3]] : b);
  const pages = res.pages.map((sheet) => {
    const p = part(sheet.page);
    return { ...sheet, page: p.page, blocks: sheet.blocks.map((blk) => ({ ...blk, bbox: mapBox(blk.bbox, p) })) };
  });
  const questions = res.questions.map((q) => {
    const p = part(q.page);
    return { ...q, page: p.page, bbox: mapBox(q.bbox, p) };
  });
  return { pages, questions };
}

/** 录入一张试卷：进入即起相机 / 相册 → 照片存进文件夹里的这张试卷 → 扫描还原电子版 → 进电子版页。 */
export default function Capture() {
  const nav = useNavigate();
  const loc = useLocation();
  const { folderId, paperId, paperName, pages, digitized, setPaper, setPaperName, setDigitized, addPage, removePage, reset, returnTo } = useCapture();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [rename, setRename] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const abortRef = useRef(false);
  const autoStarted = useRef(false);
  const autoScanRef = useRef(false);
  const entry = (loc.state as EntryState) ?? null;
  const targetFolder = folderId ?? entry?.folderId ?? null;

  /** 照片落盘：第一次加页时在文件夹里建这张试卷；之后更新照片并作废旧电子版 */
  const persist = async (nextPages: CapturePage[]) => {
    if (nextPages.length === 0) return;
    const photos = nextPages.map(({ id, src, width, height }) => ({ id, src, width, height }));
    const state = useCapture.getState();
    if (!state.paperId) {
      const { folder, paper } = await addPaper(targetFolder, photos);
      setPaper(folder.id, paper.id, paper.name, nextPages);
      return;
    }
    if (state.folderId) await updatePaper(state.folderId, state.paperId, { pages: photos, digitized: undefined, scannedAt: undefined, corrected: {} });
  };

  const addSources = async (sources: string[]) => {
    const current = useCapture.getState().pages;
    const room = MAX_PAGES - current.length;
    if (room <= 0) {
      toast(`一张试卷最多 ${MAX_PAGES} 张照片`);
      return;
    }
    const added: CapturePage[] = [];
    for (const src of sources.slice(0, room)) added.push(await toPage(src));
    if (sources.length > room) toast(`只保留前 ${room} 张，一张试卷最多 ${MAX_PAGES} 张照片`);
    added.forEach(addPage);
    await persist([...current, ...added]);
    void haptic.light();
  };

  /** 选图。返回是否选到了图；相册多选是一次把整张卷子选完，所以紧接着自动扫描。 */
  const pick = async (source: "camera" | "photos" | "sample"): Promise<boolean> => {
    setBusy(true);
    try {
      if (source === "sample") {
        await addSources([`${import.meta.env.BASE_URL}sample-paper.svg`]);
        autoScanRef.current = true;
        return true;
      }
      if (source === "photos") {
        const list = await pickImages(MAX_PAGES);
        if (!list.length) return false;
        await addSources(list);
        autoScanRef.current = true;
        return true;
      }
      const src = await pickImage("camera");
      if (!src) return false;
      await addSources([src]);
      return true;
    } catch (e) {
      if ((e as Error).message === "permission_denied") setDenied(true);
      else toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    nav(returnTo, { replace: true });
    reset();
  };

  // 进入：带 paperId 是回来继续一张已有的试卷；带 source 是立刻起相机 / 相册，什么都没选就原路返回
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    (async () => {
      if (entry?.paperId && entry.folderId && pages.length === 0) {
        const folder = await getFolder(entry.folderId);
        const paper = folder?.papers.find((p) => p.id === entry.paperId);
        if (folder && paper) setPaper(folder.id, paper.id, paper.name, paper.pages, validDigitized(paper.digitized));
      }
      if (entry?.source && useCapture.getState().pages.length === 0) {
        const got = await pick(entry.source);
        if (!got && useCapture.getState().pages.length === 0) leave();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 相册多选完成、试卷已建：自动开始扫描
  useEffect(() => {
    if (autoScanRef.current && pages.length > 0 && paperId && !progress) {
      autoScanRef.current = false;
      void scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, paperId]);

  const removeCurrentPage = async (id: string) => {
    const next = pages.filter((p) => p.id !== id);
    removePage(id);
    if (!folderId || !paperId) return;
    if (next.length === 0) {
      await deletePaper(folderId, paperId);
      setPaper(folderId, null, "", []);
      return;
    }
    await updatePaper(folderId, paperId, { pages: next.map(({ id: pid, src, width, height }) => ({ id: pid, src, width, height })), digitized: undefined, scannedAt: undefined, corrected: {} });
  };

  const saveName = async () => {
    const name = nameDraft.trim() || paperName;
    setPaperName(name);
    if (folderId && paperId) await updatePaper(folderId, paperId, { name });
    setRename(false);
  };

  /** 扫描还原电子版：每张照片按 1568px（宽幅拆两张）上传，AI 按版面还原；结果存进试卷并进入电子版页。 */
  const scan = async () => {
    const current = useCapture.getState().pages;
    if (current.length === 0) return;
    abortRef.current = false;
    setProgress({ stage: "正在压缩试卷", pct: 5, elapsed: 0 });
    try {
      const parts: UploadPart[] = [];
      for (let i = 0; i < current.length; i++) parts.push(...(await prepareUpload(current[i].src, i)));
      const uploads = parts.map((p) => ({ image: p.image }));
      if (abortRef.current) return;
      const startedAt = Date.now();
      setProgress({ stage: "正在上传试卷", pct: 12, elapsed: 0 });
      const ticker = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const pct = Math.round(12 + 83 * (1 - Math.exp(-elapsed / 40)));
        const stage = elapsed < 6 ? "正在上传试卷" : elapsed < 30 ? "正在逐字还原题目与版面" : elapsed < 50 ? "正在转写手写作答与批改" : "正在为错题生成解析";
        setProgress({ stage, pct, elapsed });
      }, 1000);
      let result: DigitizedResult;
      try {
        const region = await getCity();
        const res = await api<DigitizedResult>("/api/digitize", { method: "POST", body: { pages: uploads, region }, timeoutMs: 240000 });
        result = { ...remapParts(res, parts), provider: res.provider, at: new Date().toISOString() };
      } finally {
        clearInterval(ticker);
      }
      if (abortRef.current) return;
      if (result.questions.length === 0) {
        setProgress(null);
        toast("没有识别到题目，请换一张更清晰的照片", "info");
        return;
      }
      const fid = useCapture.getState().folderId;
      const pid = useCapture.getState().paperId;
      const subject = result.pages.find((s) => s.subject)?.subject;
      if (fid && pid) {
        await updatePaper(fid, pid, { digitized: result, scannedAt: result.at, corrected: {}, subject });
        const folder = await getFolder(fid);
        if (folder && !folder.subject && subject) await saveFolder({ ...folder, subject });
      }
      setDigitized(result);
      setProgress({ stage: "完成", pct: 100, elapsed: Math.round((Date.now() - startedAt) / 1000) });
      void haptic.success();
      if (fid && pid) nav(`/papers/${fid}/${pid}`, { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="screen">
      <InlineNav
        title="录入试卷"
        subtitle={pages.length ? `${paperName || "新试卷"} · ${pages.length} 张照片` : "拍照或从相册多选"}
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
            text="从相册一次选完整张试卷，选好后会自动开始还原。"
            action={<Button size="xs" variant="plain" onClick={() => pick("sample")} disabled={busy}>没有试卷？用示例试卷试试</Button>}
          />
        )}

        {pages.length > 0 && (
          <div className="card" style={{ gap: 12 }}>
            <button style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", minHeight: 36 }} onClick={() => { setNameDraft(paperName); setRename(true); }} aria-label="重命名试卷">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="document" size={20} style={{ color: "var(--brand)" }} />
                <span className="t-headline">{paperName || "新试卷"}</span>
              </span>
              <span className="t-foot" style={{ color: "var(--brand)" }}>重命名</span>
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {pages.map((p, i) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <img src={p.src} alt={`第 ${i + 1} 张`} style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 10, border: "1px solid var(--separator-light)" }} />
                  <span className="chip chip--sm" style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}>第 {i + 1} 张</span>
                  <button className="icon-btn" style={{ position: "absolute", right: 0, bottom: 0, width: 36, height: 36, color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: "10px 0 10px 0" }} aria-label="删除这张照片" onClick={() => removeCurrentPage(p.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
              {pages.length < MAX_PAGES && (
                <button style={{ aspectRatio: "3 / 4", borderRadius: 10, border: "1.5px dashed var(--separator)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--brand)" }} onClick={() => pick("photos")} disabled={busy}>
                  <Icon name="plus" size={24} stroke={2.2} />
                  <span className="t-foot">加照片</span>
                </button>
              )}
            </div>
            <span className="t-foot c-sec">已自动保存 · 一张试卷最多 {MAX_PAGES} 张照片 · 拍完所有页再扫描</span>
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="tinted" icon="camera" onClick={() => pick("camera")} disabled={busy || pages.length >= MAX_PAGES} style={{ flex: 1 }}>{pages.length ? "再拍一页" : "拍照"}</Button>
            <Button variant="tinted" icon="photo" onClick={() => pick("photos")} disabled={busy || pages.length >= MAX_PAGES} style={{ flex: 1 }}>从相册选</Button>
          </div>
          {digitized && pages.length > 0 && folderId && paperId ? (
            <Button icon="document" onClick={() => nav(`/papers/${folderId}/${paperId}`)} disabled={busy}>查看电子版 · {digitized.questions.length} 题</Button>
          ) : (
            <Button icon="sparkles" onClick={scan} disabled={pages.length === 0 || busy}>
              {busy ? "处理中…" : `扫描还原电子版${pages.length > 1 ? `（${pages.length} 张照片）` : ""}`}
            </Button>
          )}
          {digitized && pages.length > 0 && (
            <button className="t-sub" style={{ color: "var(--brand)", fontWeight: 500, minHeight: 36 }} onClick={scan}>重新扫描</button>
          )}
        </div>
      </div>

      <Sheet open={rename} onClose={() => setRename(false)} title="试卷名称">
        <input className="input" autoFocus value={nameDraft} maxLength={30} placeholder="例如：第 5–6 页 · 词汇与句型" onChange={(e) => setNameDraft(e.target.value)} />
        <Button onClick={saveName}>保存</Button>
      </Sheet>

      {progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }} role="dialog" aria-live="polite">
          <div className="card" style={{ width: "100%", maxWidth: 360, alignItems: "center", textAlign: "center", gap: 14 }}>
            <Icon name="sparkles" size={36} style={{ color: "var(--brand)" }} />
            <h2 className="t-title3">AI 正在还原电子版</h2>
            <p className="t-sub c-sec">{progress.stage}…</p>
            <div className="bar" style={{ width: "100%" }}><span style={{ width: `${progress.pct}%`, background: "var(--brand)", transition: "width .9s linear" }} /></div>
            <span className="t-foot c-sec num">{progress.elapsed > 0 ? `已用 ${progress.elapsed} 秒 · ` : ""}通常 {30 + pages.length * 20} 秒左右</span>
            {progress.elapsed >= 40 && <span className="t-foot" style={{ color: "var(--due)", fontWeight: 500 }}>网络有点慢，正在等待服务器返回，请稍候</span>}
            <Button variant="plain" onClick={() => { abortRef.current = true; setProgress(null); }} style={{ height: 44 }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}
