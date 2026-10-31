import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Segmented, Sheet } from "../../components/ui";
import { addPaper, deletePaper, getFolder, loadPages, thumbOf, toPage, updatePaper, validDigitized } from "../../lib/folders";
import { finishFlow } from "../../lib/flow";
import { submitScan } from "../../lib/jobs";
import { warnPhotoDuplicates } from "../../lib/dedup";
import { haptic, pickImages, takePhoto } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useCapture, type CapturePage } from "../../store/capture";

type Progress = { stage: string; pct: number; elapsed: number };
type Mode = "one" | "each";
type EntryState = { folderId?: string | null; paperId?: string | null; source?: "camera" | "photos" | "sample" } | null;

/**
 * 录入试卷：进入即起相机 / 相册 → 照片存进文件夹里的这张试卷 → 一键扫描还原电子版。
 * 拍照是连拍：每张拍完先全屏确认（× 重拍 / ✓ 入队），确认后接着起相机，在相机里点取消才停；每张拍完就存进手机，App 退出也不会丢，回来在文件夹里接着扫。
 */
export default function Capture() {
  const nav = useNavigate();
  const loc = useLocation();
  const { folderId, paperId, paperName, pages, digitized, setPaper, setPaperName, setDigitized, addPage, removePage, reset, returnTo } = useCapture();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [rename, setRename] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [mode, setMode] = useState<Mode>("one");
  const autoStarted = useRef(false);
  const autoScanRef = useRef(false);
  const entry = (loc.state as EntryState) ?? null;
  const targetFolder = folderId ?? entry?.folderId ?? null;

  /** 照片落盘：第一次加页时在文件夹里建这张试卷；之后更新照片并作废旧电子版 */
  const persist = async (nextPages: CapturePage[]) => {
    if (nextPages.length === 0) return;
    const state = useCapture.getState();
    if (!state.paperId) {
      const { folder, paper } = await addPaper(targetFolder, nextPages);
      setPaper(folder.id, paper.id, paper.name, nextPages);
      return;
    }
    if (state.folderId) await updatePaper(state.folderId, state.paperId, { pages: nextPages, digitized: undefined, scannedAt: undefined, corrected: {} });
  };

  const addSources = async (sources: string[]) => {
    const current = useCapture.getState().pages;
    const added: CapturePage[] = [];
    for (const src of sources) added.push(await toPage(src));
    void warnPhotoDuplicates(added, useCapture.getState().paperId, (f, p) => nav(`/papers/${f}/${p}`));
    added.forEach(addPage);
    await persist([...current, ...added]);
    void haptic.light();
  };

  /** 选图。返回是否选到了图；相册多选是一次把整张卷子选完，所以紧接着自动扫描。 */
  const pick = async (source: "camera" | "photos" | "sample"): Promise<boolean> => {
    setBusy(true);
    try {
      if (source === "sample") {
        autoScanRef.current = true; // 先立旗再加页：加页会触发自动扫描的 effect
        await addSources([`${import.meta.env.BASE_URL}sample-paper.svg`]);
        return true;
      }
      if (source === "photos") {
        const list = await pickImages(0); // 0 = 不限张数
        if (!list.length) return false;
        // 新建时一次选了多张：每张照片各建一张试卷、各自扫描，在列表里分别显示进度（服务器全局队列最多 5 张同时识别，其余排队）
        if (list.length > 1 && !useCapture.getState().paperId && useCapture.getState().pages.length === 0) {
          await scanEach(list);
          return true;
        }
        // 一次选齐一整张卷子就直接扫；往已经拍了几张的草稿里补照片时不自动扫，等一键扫描
        autoScanRef.current = useCapture.getState().pages.length === 0;
        await addSources(list);
        return true;
      }
      // 拍照期间 App 被系统回收时，重启后按这个把照片放回同一张试卷（见 lib/cameraRestore）
      const cameraTarget = () => ({ folderId: useCapture.getState().folderId ?? targetFolder, paperId: useCapture.getState().paperId });
      const src = await takePhoto(cameraTarget());
      if (!src) return false;
      await addSources([src]);
      // 连拍：接着起相机，直到在相机里点取消。稍等一下让上一个相机界面收起来，iOS 上连着弹太快会弹不出来
      for (;;) {
        await new Promise((r) => setTimeout(r, 400));
        const next = await takePhoto(cameraTarget());
        if (!next) break;
        await addSources([next]);
      }
      const n = useCapture.getState().pages.length;
      if (n > 1) toast(`已拍 ${n} 张，都存在手机上了，拍完点「扫描」`, "success");
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
    finishFlow(nav, returnTo, returnTo);
    reset();
  };

  // 进入：带 paperId 是回来继续一张已有的试卷；带 source 是立刻起相机 / 相册，什么都没选就原路返回。
  // 已有照片时只有拍照会接着起相机（找回的照片点了 × 重拍时就是这样进来的）
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    (async () => {
      if (entry?.paperId && entry.folderId && pages.length === 0) {
        const folder = await getFolder(entry.folderId);
        const paper = folder?.papers.find((p) => p.id === entry.paperId);
        if (folder && paper) setPaper(folder.id, paper.id, paper.name, await loadPages(paper), validDigitized(paper.digitized));
      }
      if (entry?.source && (entry.source === "camera" || useCapture.getState().pages.length === 0)) {
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
    await updatePaper(folderId, paperId, { pages: next, digitized: undefined, scannedAt: undefined, corrected: {} });
  };

  const saveName = async () => {
    const name = nameDraft.trim() || paperName;
    setPaperName(name);
    if (folderId && paperId) await updatePaper(folderId, paperId, { name });
    setRename(false);
  };

  /** 相册多选：一张照片一张试卷，逐张建好并提交扫描，全部提交后回到文件夹看各自的进度 */
  const scanEach = async (sources: string[]) => {
    let folder = targetFolder;
    let ok = 0;
    for (let i = 0; i < sources.length; i++) {
      setProgress({ stage: `正在上传第 ${i + 1} / ${sources.length} 张`, pct: Math.round(((i + 0.5) / sources.length) * 100), elapsed: 0 });
      try {
        const page = await toPage(sources[i]);
        const { folder: f, paper } = await addPaper(folder, [page]);
        folder = f.id;
        await submitScan(f.id, paper.id, [page]);
        ok += 1;
      } catch (e) {
        toastError(e);
      }
    }
    setProgress(null);
    if (!folder) return;
    void haptic.success();
    if (ok) toast(`已开始扫描 ${ok} 张试卷，可以先去做别的，好了会在列表里显示`, "success");
    reset();
    finishFlow(nav, returnTo, `/papers/${folder}`);
  };

  /** 「每张单独一份」：第一张留在这份试卷，其余每张在同一个文件夹里各建一份（照片已经存过，不再重复写） */
  const splitEach = async (fid: string, pid: string, all: CapturePage[]): Promise<{ paperId: string; pages: CapturePage[] }[]> => {
    const out = [{ paperId: pid, pages: [all[0]] }];
    for (const page of all.slice(1)) {
      const { paper } = await addPaper(fid, [page]);
      out.push({ paperId: paper.id, pages: [page] });
    }
    await updatePaper(fid, pid, { pages: [all[0]], digitized: undefined, scannedAt: undefined, corrected: {} });
    return out;
  };

  /** 一键扫描：压缩上传后交给服务器后台还原，立刻回到文件夹；进度在试卷行上显示，切走 App 也不影响。 */
  const scan = async () => {
    const state = useCapture.getState();
    if (state.pages.length === 0 || !state.folderId || !state.paperId) return;
    setProgress({ stage: "正在压缩试卷", pct: 10, elapsed: 0 });
    try {
      const batch = mode === "each" && state.pages.length > 1 ? await splitEach(state.folderId, state.paperId, state.pages) : [{ paperId: state.paperId, pages: state.pages }];
      let ok = 0;
      for (let i = 0; i < batch.length; i++) {
        const label = batch.length > 1 ? `第 ${i + 1} / ${batch.length} 份：` : "";
        const base = (i / batch.length) * 100;
        try {
          await submitScan(state.folderId, batch[i].paperId, batch[i].pages, (stage) => setProgress({ stage: label + stage, pct: Math.round(base + (stage.includes("上传") ? 0.6 : 0.2) * (100 / batch.length)), elapsed: 0 }));
          ok += 1;
        } catch (e) {
          if (batch.length === 1) throw e;
          toastError(e);
        }
      }
      if (!ok) return;
      void haptic.success();
      toast(batch.length > 1 ? `已开始扫描 ${ok} 份，可以先去做别的，好了会在试卷上显示` : "已开始扫描，可以先去做别的，好了会在试卷上显示", "success");
      reset();
      finishFlow(nav, state.returnTo, `/papers/${state.folderId}`);
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
            text="一次拍一页、让试卷铺满画面，图表和小字才认得清。可以连着拍好几页，都存在手机上，拍完再扫描。"
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
            <div className="thumb-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {pages.map((p, i) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <img src={thumbOf(p)} alt={`第 ${i + 1} 张`} style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 10, border: "1px solid var(--separator-light)" }} />
                  <span className="chip chip--sm" style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}>第 {i + 1} 张</span>
                  <button className="icon-btn" style={{ position: "absolute", right: 0, bottom: 0, width: 36, height: 36, color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: "10px 0 10px 0" }} aria-label="删除这张照片" onClick={() => removeCurrentPage(p.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
              <button style={{ aspectRatio: "3 / 4", borderRadius: 10, border: "1.5px dashed var(--separator)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--brand)" }} onClick={() => pick("photos")} disabled={busy}>
                <Icon name="plus" size={24} stroke={2.2} />
                <span className="t-foot">加照片</span>
              </button>
            </div>
            <span className="t-foot c-sec">每张都已存在手机上 · 拍完所有页再扫描</span>
          </div>
        )}

        {pages.length > 1 && !digitized && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Segmented value={mode} onChange={setMode} options={[{ value: "one", label: "合成一份试卷" }, { value: "each", label: "每张单独一份" }]} />
            <span className="t-foot c-sec" style={{ padding: "0 4px" }}>{mode === "one" ? "同一张卷子的几页选这个，跨页的题会自动接上。" : "拍的是几张不同的卷子选这个，每张各自识别、各自成卷。"}</span>
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="tinted" icon="camera" onClick={() => pick("camera")} disabled={busy} style={{ flex: 1 }}>{pages.length ? "接着拍" : "连续拍照"}</Button>
            <Button variant="tinted" icon="photo" onClick={() => pick("photos")} disabled={busy} style={{ flex: 1 }}>从相册选</Button>
          </div>
          {digitized && pages.length > 0 && folderId && paperId ? (
            <Button icon="document" onClick={() => nav(`/papers/${folderId}/${paperId}`)} disabled={busy}>查看电子版 · {digitized.questions.length} 题</Button>
          ) : (
            <Button icon="viewfinder" onClick={scan} disabled={pages.length === 0 || busy}>
              {busy ? "处理中…" : pages.length > 1 ? (mode === "each" ? `扫描 ${pages.length} 份` : `扫描（${pages.length} 张照片）`) : "扫描"}
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
            <h2 className="t-title3">正在上传试卷</h2>
            <p className="t-sub c-sec">{progress.stage}…</p>
            <div className="bar" style={{ width: "100%" }}><span style={{ width: `${progress.pct}%`, background: "var(--brand)", transition: "width .9s linear" }} /></div>
            <span className="t-foot c-sec">上传完成后就可以离开，扫描在服务器上继续</span>
          </div>
        </div>
      )}
    </div>
  );
}
