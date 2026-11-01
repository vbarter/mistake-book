import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PrintSheets } from "../components/PrintPaper";
import { Button, Empty, InlineNav } from "../components/ui";
import { Hint } from "../components/v2";
import { allErased, erasePaper, useErasing } from "../lib/erase";
import { figureAt, figurePayload, figurePhotoIds, releaseFigureSources } from "../lib/figures";
import { getFolder, validDigitized, type Folder } from "../lib/folders";
import { scanStageText, useJobs } from "../lib/jobs";
import { toast, toastError } from "../store/banner";
import { useExports } from "../store/exports";
import "../styles/paper.css";
import "../styles/erase.css";

/**
 * 擦除手写 = 原题空白卷：题目用扫描识别出的文字重排（题干、选项、空位留白），作答、批改、得分都不要；
 * 导出的 PDF 也是文字版，不放整张照片。只有插图（几何图、统计图等）还得从照片里裁，
 * 所以把有插图的照片放到服务器后台擦一遍手写，插图从擦过的照片里裁。
 */
export function ErasePaper() {
  const nav = useNavigate();
  const { folderId = "", paperId = "" } = useParams();
  const [folder, setFolder] = useState<Folder | null>();
  const [exporting, setExporting] = useState(false);
  const progress = useErasing((s) => s.running[paperId]);
  const warning = useErasing((s) => s.warnings[paperId]);
  const submitExport = useExports((s) => s.submit);
  const started = useRef(false);

  const reload = useCallback(() => getFolder(folderId).then((f) => setFolder(f ?? null)), [folderId]);
  useEffect(() => releaseFigureSources, []);
  // 轮询取回了擦好的照片、扫描好了：重新读记录，插图换成擦过的
  const jobsVersion = useJobs((s) => s.version);
  useEffect(() => {
    void reload();
  }, [jobsVersion, progress?.done, progress === undefined, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const paper = folder?.papers.find((p) => p.id === paperId);
  const digitized = paper ? validDigitized(paper.digitized) : null;
  const figIds = paper && digitized ? figurePhotoIds(paper) : [];

  // 有插图的照片还没擦过：进来就开始擦（只擦这几张）
  useEffect(() => {
    if (!paper || !digitized || started.current || paper.eraseJob || allErased(paper, figIds)) return;
    started.current = true;
    erasePaper(folderId, paper, figIds.filter((id) => !paper.pages.find((pg) => pg.id === id)?.erased)).catch(toastError);
  }, [paper, digitized, folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (folder === undefined) return null;
  if (!folder || !paper) return <Empty icon="document" title="试卷不存在" action={<Button size="sm" variant="tinted" onClick={() => nav("/papers")}>回到试卷</Button>} />;

  if (!digitized) {
    return (
      <div className="screen">
        <InlineNav title="原题空白卷" back />
        <div className="screen__content screen__content--modal" style={{ justifyContent: "center", alignItems: "center", gap: 14, textAlign: "center" }}>
          <Icon name={paper.scanJob ? "sparkles" : "brush"} size={44} style={{ color: "var(--brand)" }} />
          {paper.scanJob ? (
            <>
              <h2 className="t-title3">正在扫描「{paper.name}」</h2>
              <p className="t-sub c-sec">{scanStageText(paper.scanJob)}。扫好后这里会显示去掉作答的原题</p>
            </>
          ) : (
            <>
              <h2 className="t-title3">先扫描这张试卷</h2>
              <p className="t-sub c-sec">空白卷是用扫描识别出的原题重新排版的，扫描后就能导出</p>
              <Button onClick={() => nav(`/papers/${folderId}/${paperId}`)} style={{ height: 44 }}>去扫描</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const busy = !!progress || !!paper.eraseJob;
  const done = progress?.done ?? paper.eraseJob?.done ?? 0;
  const total = progress?.total ?? paper.eraseJob?.total ?? figIds.length;

  const exportClean = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const pages = await Promise.all(
        digitized.pages.map(async (s, si) => ({
          ...s,
          blocks: await Promise.all(s.blocks.map(async (b, bi) => { const f = b.type === "figure" ? figureAt(paper, si, bi, true) : null; return f ? { ...b, image: (await figurePayload(f)).image } : b; })),
        })),
      );
      const job = await submitExport({ kind: "clean", title: `${paper.name} 空白卷`, papers: [{ title: paper.name, pages }] });
      if (!job) return toast("服务器还不支持导出空白卷，请稍后再试", "error");
      toast("已开始生成，好了会提醒你，「我的导出」里也能找到");
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav title="原题空白卷" back />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 0 }}>
        <div className="erase__head">
          <span className="t-headline ellipsis" style={{ flex: 1, minWidth: 0 }}>{paper.name}</span>
          <span className="t-foot c-sec">{digitized.pages.length} 个卷面</span>
        </div>
        <Hint icon="brush">只保留印刷的原题，空格留白，作答、批改和得分都去掉了。导出的是文字版 PDF。</Hint>
        {figIds.length > 0 && busy && (
          <p className="t-foot erase__status"><span className="spinner-ring" /> 插图上的手写正在后台擦除（{done}/{total} 张照片），可以先离开，擦好会提醒你</p>
        )}
        {warning && !busy && <p className="t-foot erase__warn"><Icon name="alert" size={14} stroke={2.4} /> {warning}</p>}
        <PrintSheets paper={paper} sheets={digitized.pages} clean />
        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          {figIds.length > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => erasePaper(folderId, paper, figIds).catch(toastError)} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>重擦插图</Button>
          )}
          <Button icon="export" disabled={busy || exporting} onClick={exportClean} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{exporting ? "提交中…" : busy ? "插图擦除中…" : "导出空白卷 PDF"}</Button>
        </div>
      </div>
    </div>
  );
}
