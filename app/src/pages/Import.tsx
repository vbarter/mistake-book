import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, InlineNav, Segmented, Sheet } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { addPaper, folderStats, listFolders, toPage, type Folder } from "../lib/folders";
import { finishFlow } from "../lib/flow";
import { submitScan } from "../lib/jobs";
import { haptic } from "../lib/native";
import { toast, toastError } from "../store/banner";
import { useImport } from "../store/importer";

type Mode = "one" | "each";

/**
 * 批量导入：相册里一次选好的多张照片在这里整理一下就开始识别。
 * 默认合成一份试卷（跨页的题会自动接上）；一叠不同的练习可以切成「每张一份」。下方是自动生成的目录预览，识别完会换成卷头上的标题。
 */
export default function Import() {
  const nav = useNavigate();
  const { sources, folderId, from, remove, setFolder, clear } = useImport();
  const [mode, setMode] = useState<Mode>("one");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (sources.length === 0) nav("/home", { replace: true });
    listFolders().then(setFolders).catch(() => setFolders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folder = folders.find((f) => f.id === folderId) ?? null;
  const base = folder?.papers.length ?? 0;
  const toc = useMemo(
    () => (mode === "one" || sources.length === 1 ? [{ name: `第 ${base + 1} 份`, pages: sources.map((_, i) => i) }] : sources.map((_, i) => ({ name: `第 ${base + i + 1} 份`, pages: [i] }))),
    [mode, sources, base],
  );

  const leave = () => {
    clear();
    nav(-1);
  };

  const start = async () => {
    let target = folderId;
    let ok = 0;
    try {
      for (let t = 0; t < toc.length; t++) {
        setProgress(toc.length > 1 ? `正在上传第 ${t + 1} / ${toc.length} 份` : "正在上传试卷");
        const pages = [];
        for (const i of toc[t].pages) pages.push(await toPage(sources[i]));
        const { folder: f, paper } = await addPaper(target, pages, toc[t].name);
        target = f.id;
        try {
          await submitScan(f.id, paper.id, pages);
          ok += 1;
        } catch (e) {
          toastError(e);
        }
      }
    } catch (e) {
      toastError(e);
    } finally {
      setProgress(null);
    }
    if (!target) return;
    void haptic.success();
    if (ok) toast(`已开始识别 ${ok} 份，好了会自动归档到知识点`, "success");
    clear();
    finishFlow(nav, from, `/papers/${target}`);
  };

  return (
    <div className="screen">
      <InlineNav title="批量导入" subtitle={`${sources.length} 张照片`} right={<button className="nav-btn" onClick={leave}>取消</button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 16, paddingTop: 4 }}>
        <div className="thumb-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {sources.map((src, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={src} alt={`第 ${i + 1} 张`} style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 10, border: "1px solid var(--separator-light)" }} />
              <span className="chip chip--sm" style={{ position: "absolute", left: 4, top: 4, background: "rgba(0,0,0,.55)", color: "#fff" }}>{i + 1}</span>
              {sources.length > 1 && (
                <button className="icon-btn" style={{ position: "absolute", right: 2, top: 2, width: 26, height: 26, color: "#fff", background: "rgba(0,0,0,.45)" }} aria-label={`去掉第 ${i + 1} 张`} onClick={() => remove(i)}>
                  <Icon name="xmark" size={14} stroke={2.6} />
                </button>
              )}
            </div>
          ))}
        </div>

        {sources.length > 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Segmented value={mode} onChange={setMode} options={[{ value: "one", label: "合成一份试卷" }, { value: "each", label: "每张单独一份" }]} />
            <span className="t-foot c-sec" style={{ padding: "0 4px" }}>{mode === "one" ? "同一张卷子的几页选这个，跨页的题会自动接上。" : "一叠不同的练习选这个，每张各自识别、各自成卷。"}</span>
          </div>
        )}

        <div className="group">
          <button className="row" style={{ minHeight: 56 }} onClick={() => setPicking(true)}>
            <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="folder" size={18} /></span>
            <span className="row__main"><span className="row__title">放进</span></span>
            <span className="row__value ellipsis" style={{ maxWidth: "55%" }}>{folder?.name ?? "新文件夹（自动命名）"}</span>
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        </div>

        <div className="group">
          <div className="group__header"><span>目录预览</span><span>识别后自动换成卷头标题</span></div>
          {toc.map((t, i) => (
            <div key={i} className="row" style={{ minHeight: 48 }}>
              <span className="toc-num">{String(base + i + 1).padStart(2, "0")}</span>
              <span className="row__main"><span className="row__title">{t.name}</span></span>
              <span className="row__value t-sub">{t.pages.length > 1 ? `第 ${t.pages[0] + 1}–${t.pages[t.pages.length - 1] + 1} 张 · ${t.pages.length} 页` : `第 ${t.pages[0] + 1} 张`}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <Button icon="sparkles" onClick={start} disabled={Boolean(progress) || sources.length === 0}>开始识别{toc.length > 1 ? ` ${toc.length} 份` : ""}</Button>
          <span className="t-cap c-sec" style={{ textAlign: "center" }}>识别在服务器上进行，提交后可以离开</span>
        </div>
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="放进哪个文件夹？">
        <div className="group">
          <button className="row" style={{ minHeight: 56 }} onClick={() => { setFolder(null); setPicking(false); }}>
            <span className="row__icon" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name="plus" size={18} stroke={2.4} /></span>
            <span className="row__main"><span className="row__title">新文件夹</span><span className="row__sub">按日期和学科自动命名</span></span>
            {!folderId && <Icon name="check" size={18} stroke={2.6} style={{ color: "var(--brand)" }} />}
          </button>
          {folders.map((f) => (
            <button key={f.id} className="row" style={{ minHeight: 56 }} onClick={() => { setFolder(f.id); setPicking(false); }}>
              <SubjectTile subject={folderStats(f).subject} size="sm" />
              <span className="row__main"><span className="row__title">{f.name}</span><span className="row__sub">{f.papers.length} 份试卷</span></span>
              {folderId === f.id && <Icon name="check" size={18} stroke={2.6} style={{ color: "var(--brand)" }} />}
            </button>
          ))}
        </div>
      </Sheet>

      {progress && (
        <div className="hud" role="dialog" aria-live="polite">
          <div className="hud__card">
            <span className="spinner-ring" />
            <span className="t-headline">{progress}…</span>
            <span className="t-foot c-sec">上传完就可以离开</span>
          </div>
        </div>
      )}
    </div>
  );
}
