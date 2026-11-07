import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Subject } from "../api/types";
import { useAddPaper } from "../components/AddSheet";
import { SubjectPicker } from "../components/SubjectPicker";
import { ErrorCard, jumpToError } from "../components/ErrorCard";
import { ExportSheet } from "../components/ExportSheet";
import { SwipeSortList } from "../components/SwipeSortList";
import { Icon } from "../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../components/ui";
import { ErrorFilterTags, IconSegmented, KnowledgeIcon, Stat, SubjectStack, SubjectTile, Tag, applyErrorFilter, subjectColors, type ErrorFilter } from "../components/v2";
import { folderErrors, groupByKnowledge, groupBySection, knowledgeKey, paperErrors } from "../lib/errors";
import { deleteFolder, deletePaper, folderStats, getFolder, mergeOrder, paperQuality, paperStats, paperSubject, reorderPapers, scopeFolder, subjectFolders, thumbOf, updateFolder, updatePaper, type Folder, type Paper } from "../lib/folders";
import { SUBJECTS, SUBJECT_LABEL, formatDate, formatDateTime } from "../lib/format";
import { gradeIfNeeded, needsScan, scanPending, scanStageText, tagIfNeeded, useJobs } from "../lib/jobs";
import { toast, toastError } from "../store/banner";
import { useErasing } from "../lib/erase";
import "../styles/erase.css";

type Tab = "papers" | "errors";

/** 文件夹：「目录」是自动生成的试卷目录（序号 · 卷头标题 · 大题与错题数），「错题汇总」跨试卷合并、按知识点归类；底栏导出与加卷。
 * 外层文件夹按扫描日期，里面的试卷扫描后按学科自动归进子目录（?s=math 就是只看数学这个子目录）；还没认出学科的放在「待归类」。 */
export default function FolderDetail() {
  const nav = useNavigate();
  const { folderId = "" } = useParams();
  const [search] = useSearchParams();
  const scope = (SUBJECTS as string[]).includes(search.get("s") ?? "") ? (search.get("s") as Subject) : null;
  const add = useAddPaper(folderId);
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("papers");
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingPaper, setDeletingPaper] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<Subject | null>(null);
  const [filter, setFilter] = useState<ErrorFilter>("all");
  const [uploading, setUploading] = useState<string | null>(null);
  const [moving, setMoving] = useState<Paper | null>(null);

  const jobsVersion = useJobs((s) => s.version);
  const reload = useCallback(() => getFolder(folderId).then((f) => setFolder(f ?? null)), [folderId]);
  const erasing = useErasing((s) => s.running);
  const erasingKey = Object.entries(erasing).map(([id, p]) => `${id}:${p.done}`).join(",");
  useEffect(() => { void reload(); }, [erasingKey, reload]); // 擦完一张就刷新卡片上的「已擦」标记
  const openPaper = (p: Folder["papers"][number]) => (p.scanJob ? toast(`${scanStageText(p.scanJob)}，好了会自动更新`) : nav(`/papers/${folder?.id}/${p.id}`));
  // 原题空白卷页：没扫描的那边会引导去扫描；有插图的照片进去后在后台擦手写
  const openErase = (p: Folder["papers"][number]) => (p.scanJob ? toast(`${scanStageText(p.scanJob)}，扫好后就能导出空白卷`) : nav(`/papers/${folderId}/${p.id}/erase`));
  useEffect(() => {
    void reload();
  }, [reload, jobsVersion]);
  // 有老师没批改的题：自动交给大模型补判（一张一张来）
  useEffect(() => {
    if (!folder) return;
    void (async () => {
      for (const p of folder.papers) {
        await gradeIfNeeded(folder.id, p);
        await tagIfNeeded(folder.id, p);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id]);

  // 子目录里：统计、目录、错题汇总、导出都只算这个学科的试卷
  const view = useMemo(() => (folder ? scopeFolder(folder, scope) : null), [folder, scope]);
  const tree = useMemo(() => (folder ? subjectFolders(folder) : null), [folder]);
  const stats = useMemo(() => (view ? folderStats(view) : null), [view]);
  const allErrors = useMemo(() => (view ? folderErrors(view) : []), [view]);
  const errorSubjects = useMemo(() => [...new Set(allErrors.map((e) => e.subject))], [allErrors]);
  const errors = useMemo(() => (subjectFilter && errorSubjects.includes(subjectFilter) ? allErrors.filter((e) => e.subject === subjectFilter) : allErrors), [allErrors, subjectFilter, errorSubjects]);
  const shown = useMemo(() => applyErrorFilter(errors, filter), [errors, filter]);
  const groups = useMemo(() => groupByKnowledge(shown), [shown]);

  if (folder === undefined) return null;
  if (folder === null || !stats || !view || !tree) return <Empty icon="folder" title="文件夹不存在" action={<Button size="sm" variant="tinted" onClick={() => nav("/papers")}>回到试卷</Button>} />;

  const saveMeta = async () => {
    await updateFolder(folder.id, { name: name.trim() || folder.name });
    setRename(false);
    await reload();
  };

  const pendingScan = folder.papers.filter(needsScan).length;
  /** 一键扫描：拍好存在手机上、还没扫描的试卷一起发给服务器 */
  const scanAll = async () => {
    setUploading("正在上传");
    try {
      const ok = await scanPending(folder, (i, n) => setUploading(n > 1 ? `正在上传第 ${i + 1} / ${n} 份` : "正在上传"));
      if (ok) toast(`已开始扫描 ${ok} 份，好了会在试卷上显示`, "success");
      else toastError(new Error("没传上去，检查一下网络再试"));
    } finally {
      setUploading(null);
      await reload();
    }
  };

  /** 把一张试卷改到别的学科子目录（或识别不出学科时手动选）；之后重新扫描也不会被识别结果改回去 */
  const moveTo = async (p: Paper, sub: Subject) => {
    setMoving(null);
    if (paperSubject(p) === sub) return;
    await updatePaper(folder.id, p.id, { subject: sub, subjectManual: true });
    toast(`已归到「${SUBJECT_LABEL[sub]}」`, "success");
    await reload();
  };

  const paperCard = (p: Paper, idx: number) => {
    const st = paperStats(p);
    const unknown = !p.scanJob && !p.scanError && st.scanned && !paperSubject(p);
    return (
      // 整张卡可点（打开试卷），右侧还有擦除按钮：按钮里不能再套按钮，所以外层用 div
      <div role="button" tabIndex={0} className="card card--row" style={{ flexWrap: "wrap", cursor: "pointer" }} onClick={() => openPaper(p)} onKeyDown={(e) => { if (e.key === "Enter") openPaper(p); }}>
        <span className="toc-num">{String(idx + 1).padStart(2, "0")}</span>
        <img className="thumb" src={thumbOf(p.pages[0])} alt="" />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="t-headline ellipsis">{p.name}</span>
          <span className="t-foot c-sec">{p.pages.length} 张照片{st.scanned ? ` · ${st.total} 题` : ""} · {p.scannedAt ? `扫描于 ${formatDateTime(p.scannedAt)}` : `拍摄于 ${formatDate(p.createdAt)}`}</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {p.scanJob ? (
              <>
                <span className="progress" style={{ flex: 1, background: "var(--brand-tint)" }}><span style={{ width: `${Math.max(6, p.scanJob.progress)}%` }} /></span>
                <span className="t-cap" style={{ color: "var(--brand)", fontWeight: 700, whiteSpace: "nowrap" }}>{scanStageText(p.scanJob)}</span>
              </>
            ) : p.scanError ? (
              <Tag kind="wrong" icon="warning">扫描失败 · 点开重扫</Tag>
            ) : st.scanned ? (
              <>
                <Tag kind="wrong">{st.wrong} 错</Tag>
                {st.blank > 0 && <Tag kind="pending" icon="alert">{st.blank} 空</Tag>}
                <Tag kind="correct">{st.correct} 对</Tag>
                {p.duplicateOf && <Tag kind="neutral" icon="info">{p.duplicateOf.kind === "retake" ? "重做" : "扫过了"}</Tag>}
              </>
            ) : (
              <Tag kind="pending">待扫描</Tag>
            )}
            {unknown && (
              <button className="tag tag--accent" style={{ border: 0, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setMoving(p); }} onKeyDown={(e) => e.stopPropagation()}>
                <Icon name="folder" size={12} stroke={2.4} />选学科
              </button>
            )}
          </span>
        </span>
        {!p.scanJob && paperQuality(p).warn && <span className="quality-tag"><Icon name="alert" size={13} stroke={2.4} />{paperQuality(p).label}</span>}
        <EraseButton busy={!!erasing[p.id] || !!p.eraseJob} disabled={!!p.scanJob} onClick={() => openErase(p)} />
        {st.scanned && <Outline sections={outlineOf(folder, p)} />}
      </div>
    );
  };

  /** 一组试卷（子目录里的，或待归类的）：拖动排序只换这几张的位置 */
  const paperList = (papers: Paper[]) => (
    <SwipeSortList
      items={papers}
      keyOf={(p) => p.id}
      onDelete={(p) => setDeletingPaper(p.id)}
      onReorder={(ids) => {
        const order = mergeOrder(folder.papers.map((p) => p.id), ids);
        setFolder({ ...folder, papers: order.map((id) => folder.papers.find((p) => p.id === id)!) });
        void reorderPapers(folder.id, order);
      }}
      gap={12}
      render={(p) => paperCard(p, papers.indexOf(p))}
    />
  );

  const pendingHead = (
    <span className="t-foot c-sec" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 0" }}>
      <Icon name="sparkles" size={14} stroke={2.2} style={{ color: "var(--brand)" }} />
      待归类 {tree.pending.length} · 扫描认出学科后自动放进对应的学科目录
    </span>
  );

  const scopedPapers = scope ? view.papers : [];
  const papersTab = (
    <>
      {folder.papers.length === 0 && <Empty icon="document" title="还没有试卷" text="拍一张或从相册选，扫描后会按学科自动归档，错题自动汇总。" />}
      {pendingScan > 0 && (
        <div className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="sparkles" size={22} style={{ color: "var(--brand)", flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="t-headline">{pendingScan} 份试卷还没扫描</span>
            <span className="t-foot c-sec">照片都存在手机上，一起发给服务器识别</span>
          </span>
          <Button size="sm" onClick={scanAll} disabled={Boolean(uploading)}>全部扫描</Button>
        </div>
      )}
      {!scope && tree.subjects.map(({ subject: sub, papers }) => {
        const st = folderStats(scopeFolder(folder, sub));
        const c = subjectColors(sub);
        return (
          <button key={sub} className="card card--row press" onClick={() => nav(`/papers/${folder.id}?s=${sub}`)} aria-label={`${SUBJECT_LABEL[sub]}，${papers.length} 张试卷`}>
            <span style={{ position: "relative", flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: c.bg, color: c.color, display: "grid", placeItems: "center" }}>
              <Icon name="folder" size={24} stroke={2} />
              <SubjectTile subject={sub} size="xs" style={{ position: "absolute", right: -5, bottom: -5, boxShadow: "0 0 0 2px var(--card)" }} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="t-headline">{SUBJECT_LABEL[sub]}</span>
              <span className="t-foot c-sec ellipsis">{papers.length} 张试卷{papers.length ? ` · ${papers.map((p) => p.name).slice(0, 2).join("、")}${papers.length > 2 ? " 等" : ""}` : ""}</span>
            </span>
            {st.problems > 0 ? <Tag kind="wrong">{st.wrong} 错{st.blank ? ` · ${st.blank} 空` : ""}</Tag> : <Tag kind="correct" icon="check">无错题</Tag>}
            <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        );
      })}
      {scope && scopedPapers.length === 0 && tree.pending.length === 0 && <Empty icon="document" title={`这里没有${SUBJECT_LABEL[scope]}试卷了`} action={<Button size="sm" variant="tinted" onClick={() => nav(`/papers/${folder.id}`, { replace: true })}>回到 {folder.name}</Button>} />}
      {scope && paperList(scopedPapers)}
      {tree.pending.length > 0 && (tree.subjects.length > 0 || scope) && pendingHead}
      {tree.pending.length > 0 && paperList(tree.pending)}
    </>
  );

  const errorsTab = (
    <>
      {errorSubjects.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={`chip chip--select${!subjectFilter ? " on" : ""}`} onClick={() => setSubjectFilter(null)}>全部 {allErrors.length}</button>
          {errorSubjects.map((s) => (
            <button key={s} className={`chip chip--select${subjectFilter === s ? " on" : ""}`} onClick={() => setSubjectFilter(s)} style={{ gap: 6 }}>
              <SubjectTile subject={s} size="xs" />{SUBJECT_LABEL[s]} {allErrors.filter((e) => e.subject === s).length}
            </button>
          ))}
        </div>
      )}
      <ErrorFilterTags value={filter} onChange={setFilter} counts={{ wrong: errors.filter((e) => e.kind !== "未作答").length, blank: errors.filter((e) => e.kind === "未作答").length }} />
      {errors.length === 0 && <Empty icon="seal" title={stats.unscanned > 0 ? "先扫描试卷" : "这个文件夹没有错题，也没有空题"} text={stats.unscanned > 0 ? "扫描后错题会自动出现在这里。" : "真棒。"} />}
      {errors.length > 0 && shown.length === 0 && <Empty icon="seal" title="这一类没有题" action={<Button size="xs" variant="plain" onClick={() => setFilter("all")}>看全部</Button>} />}
      {groups.map(([k, items]) => {
        const blank = items.filter((i) => i.kind === "未作答").length;
        const papers = new Set(items.map((i) => i.paperId)).size;
        return (
          <div key={knowledgeKey(items[0])} className="card" style={{ gap: 10, padding: "12px 14px" }}>
            <div className="kp">
              <KnowledgeIcon name={k} subject={items[0].subject} />
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="kp__name">{k}</span>
                <span className="kp__meta">{items.length} 题{blank > 0 ? `（未作答 ${blank}）` : ""}{papers > 1 ? ` · 来自 ${papers} 张试卷` : ""}</span>
              </span>
              <span className="tag tag--wrong" style={{ fontWeight: 800 }}>{items.length}</span>
            </div>
            <div className="nums">
              {items.map((i) => (
                <button key={i.key} className={`num-chip${i.kind === "未作答" ? " num-chip--blank" : ""}`} onClick={() => jumpToError(i.key)} aria-label={`第 ${i.q.number} 题（${i.kind}），点击查看`}>
                  {i.q.number}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {shown.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 0" }}>
            <span className="t-sub" style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="list" size={16} stroke={2.2} />逐题 · {shown.length}</span>
          </div>
          {groups.map(([k, items]) => (
            <div key={knowledgeKey(items[0])} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="t-headline" style={{ marginTop: 4 }}>{k} · {items.length} 题</span>
              {items.map((i) => (
                <ErrorCard key={i.key} item={i} showSource={view.papers.length > 1} />
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="screen">
      <InlineNav title="" back backLabel={scope ? folder.name : "试卷"} right={scope ? undefined : <button className="icon-btn" aria-label="更多" style={{ color: "var(--brand)" }} onClick={() => setMenu(true)}><Icon name="ellipsis" size={24} /></button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {stats.subjects.length > 1 ? <SubjectStack subjects={stats.subjects} size="md" /> : <SubjectTile subject={stats.subject} size="lg" />}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <h1 className="t-title2 ellipsis" style={{ fontWeight: 800 }}>{scope ? SUBJECT_LABEL[scope] : folder.name}</h1>
            <span className="t-foot c-sec ellipsis" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {scope ? <><Icon name="folder" size={14} stroke={2} />{folder.name}{stats.exam ? ` · ${stats.exam}` : ""}</> : <><Icon name="pin" size={14} stroke={2} />{stats.exam || (stats.subjects.length > 1 ? `${stats.subjects.length} 个学科 · 已按学科归档` : stats.subject ? SUBJECT_LABEL[stats.subject] : "扫描后自动识别考试信息，按学科归档")}</>}
            </span>
          </div>
        </div>
        <div className="stats" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <Stat label="错题" value={stats.wrong} icon="xcircle" color="var(--wrong)" />
          <Stat label="未作答" value={stats.blank} icon="alert" color="var(--accent-on)" />
        </div>
        <IconSegmented value={tab} onChange={setTab} options={[{ value: "papers", label: `目录 ${stats.papers}`, icon: "list" }, { value: "errors", label: `错题汇总 ${stats.problems}`, icon: "target" }]} />

        {tab === "papers" ? papersTab : errorsTab}

        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          <Button variant="outline" icon="export" onClick={() => setExporting(true)} style={{ flex: 1 }} disabled={stats.papers === 0}>导出</Button>
          <Button icon="plus" onClick={add.open} style={{ flex: 1.3 }}>添加试卷</Button>
        </div>
      </div>

      {add.sheet}

      <Sheet open={menu} onClose={() => setMenu(false)} title={folder.name}>
        <Button variant="tinted" icon="pencil" onClick={() => { setMenu(false); setName(folder.name); setRename(true); }}>重命名</Button>
        <Button variant="danger" icon="trash" onClick={() => { setMenu(false); setConfirmDelete(true); }}>删除文件夹</Button>
      </Sheet>

      <Sheet open={rename} onClose={() => setRename(false)} title="文件夹名称">
        <input className="input" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <span className="t-foot c-sec">默认是扫描日期；里面的试卷会按学科自动分到子目录。</span>
        <Button onClick={saveMeta}>保存</Button>
      </Sheet>

      <SubjectPicker paper={moving} onClose={() => setMoving(null)} onPick={(sub) => moving && moveTo(moving, sub)} />

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`删除「${folder.name}」？`}>
        <p className="t-sub c-sec">会删掉里面 {folder.papers.length} 张试卷的照片和电子版，不能恢复。</p>
        <Button variant="danger" onClick={async () => { await deleteFolder(folder.id); toast("已删除"); nav("/papers", { replace: true }); }}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(false)}>取消</Button>
      </Sheet>

      <Sheet open={Boolean(deletingPaper)} onClose={() => setDeletingPaper(null)} title="删除这张试卷？">
        <p className="t-sub c-sec">照片和电子版会一起删掉。</p>
        <Button variant="danger" onClick={async () => { if (deletingPaper) await deletePaper(folder.id, deletingPaper); setDeletingPaper(null); await reload(); }}>删除</Button>
        <Button variant="plain" onClick={() => setDeletingPaper(null)}>取消</Button>
      </Sheet>

      {uploading && (
        <div className="hud" role="dialog" aria-live="polite">
          <div className="hud__card">
            <span className="spinner-ring" />
            <span className="t-headline">{uploading}…</span>
            <span className="t-foot c-sec">上传完就可以离开，扫描在服务器上继续</span>
          </div>
        </div>
      )}

      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={scope || subjectFilter ? `${folder.name} · ${SUBJECT_LABEL[(scope ?? subjectFilter)!]}` : folder.name} subtitle={stats.syllabus ? `按${stats.syllabus}归类` : stats.exam} errors={errors} papers={subjectFilter ? view.papers.filter((p) => paperSubject(p) === subjectFilter) : view.papers} />
    </div>
  );
}

/** 一张试卷的目录：大题（卷面顺序）和每个大题里的错题数 */
function outlineOf(folder: Folder, paper: Folder["papers"][number]): { label: string; total: number; wrong: number }[] {
  const d = paper.digitized;
  if (!d) return [];
  const wrong = new Map(groupBySection(paperErrors(folder, paper)).map(([k, list]) => [k, list.length]));
  const out: { label: string; total: number; wrong: number }[] = [];
  for (const sheet of d.pages) {
    let current: { label: string; total: number; wrong: number } | null = null;
    for (const b of sheet.blocks) {
      if (b.type === "section") {
        const label = [b.label, b.title].filter(Boolean).join(" ");
        current = out.find((o) => o.label === label) ?? { label, total: 0, wrong: wrong.get(label) ?? 0 };
        if (!out.includes(current)) out.push(current);
      } else if (current) current.total += b.blanks.length;
    }
  }
  return out.filter((o) => o.label);
}

/** 试卷卡片右侧的「擦除手写」按钮：打开原题空白卷；插图在后台擦手写时转圈 */
function EraseButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="erase-btn"
      aria-label="擦除手写，导出原题空白卷"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {busy ? <span className="spinner-ring" /> : <Icon name="brush" size={19} stroke={2.2} />}
    </button>
  );
}

function Outline({ sections }: { sections: { label: string; total: number; wrong: number }[] }) {
  if (sections.length === 0) return null;
  return (
    <span className="outline">
      {sections.slice(0, 8).map((s) => (
        <span key={s.label} className="outline__row">
          <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
          {s.wrong > 0 ? <span className="outline__wrong">{s.wrong} 错</span> : <span className="outline__ok"><Icon name="check" size={12} stroke={2.8} /></span>}
        </span>
      ))}
      {sections.length > 8 && <span className="outline__row c-sec">还有 {sections.length - 8} 个大题</span>}
    </span>
  );
}

