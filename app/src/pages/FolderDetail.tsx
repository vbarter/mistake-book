import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Subject } from "../api/types";
import { ErrorCard } from "../components/ErrorCard";
import { ExportSheet } from "../components/ExportSheet";
import { Icon } from "../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../components/ui";
import { Hint, IconSegmented, KnowledgeIcon, Stat, SubjectStack, SubjectTile, Tag } from "../components/v2";
import { folderErrors, groupByKnowledge, type ErrorItem } from "../lib/errors";
import { deleteFolder, deletePaper, folderStats, getFolder, paperStats, paperSubject, saveFolder, setCorrected, type Folder } from "../lib/folders";
import { SUBJECTS, SUBJECT_LABEL, formatDate } from "../lib/format";
import { scanStageText, useJobs } from "../lib/jobs";
import { haptic } from "../lib/native";
import { toast } from "../store/banner";
import { useCapture } from "../store/capture";

type Tab = "papers" | "errors";

/** 文件夹：上半是这次考试的试卷，下半是跨试卷合并、按知识点归类的错题汇总；底栏导出与加卷。 */
export default function FolderDetail() {
  const nav = useNavigate();
  const { folderId = "" } = useParams();
  const { reset, setReturnTo } = useCapture();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("papers");
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState<Subject | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingPaper, setDeletingPaper] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<Subject | null>(null);

  const jobsVersion = useJobs((s) => s.version);
  const reload = useCallback(() => getFolder(folderId).then((f) => setFolder(f ?? null)), [folderId]);
  useEffect(() => {
    void reload();
  }, [reload, jobsVersion]);

  const stats = useMemo(() => (folder ? folderStats(folder) : null), [folder]);
  const allErrors = useMemo(() => (folder ? folderErrors(folder) : []), [folder]);
  const errorSubjects = useMemo(() => [...new Set(allErrors.map((e) => e.subject))], [allErrors]);
  const errors = useMemo(() => (subjectFilter && errorSubjects.includes(subjectFilter) ? allErrors.filter((e) => e.subject === subjectFilter) : allErrors), [allErrors, subjectFilter, errorSubjects]);
  const groups = useMemo(() => groupByKnowledge(errors), [errors]);

  if (folder === undefined) return null;
  if (folder === null || !stats) return <Empty icon="folder" title="文件夹不存在" action={<Button size="sm" variant="tinted" onClick={() => nav("/papers")}>回到试卷</Button>} />;

  const openCapture = (source: "camera" | "photos") => {
    reset();
    setReturnTo(`/papers/${folder.id}`);
    setAddSheet(false);
    nav("/capture", { state: { folderId: folder.id, source } });
  };

  const toggle = async (item: ErrorItem, next: boolean) => {
    await setCorrected(item.folderId, item.paperId, item.q.index, next);
    void haptic.selection();
    await reload();
  };

  const saveMeta = async () => {
    await saveFolder({ ...folder, name: name.trim() || folder.name, subject });
    setRename(false);
    await reload();
  };

  const papersTab = (
    <>
      {folder.papers.length === 0 && <Empty icon="document" title="还没有试卷" text="拍一张或从相册选，扫描后错题会自动汇总。" />}
      {folder.papers.map((p) => {
        const st = paperStats(p);
        return (
          <div key={p.id} className="card card--row">
            <button style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textAlign: "left" }} onClick={() => (p.scanJob ? toast(`${scanStageText(p.scanJob)}，好了会自动更新`) : nav(`/papers/${folder.id}/${p.id}`))}>
            <img className="thumb" src={p.pages[0]?.src} alt="" />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="t-headline ellipsis" style={{ display: "flex", alignItems: "center", gap: 6 }}>{paperSubject(p) && stats.subjects.length > 1 && <SubjectTile subject={paperSubject(p)} size="xs" />}{p.name}</span>
              <span className="t-foot c-sec">{p.pages.length} 张照片{st.scanned ? ` · ${st.total} 题` : ""} · {formatDate(p.updatedAt)}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {p.scanJob ? (
                  <>
                    <span className="progress" style={{ flex: 1, background: "var(--brand-tint)" }}><span style={{ width: `${Math.max(6, p.scanJob.progress)}%` }} /></span>
                    <span className="t-cap" style={{ color: "var(--brand)", fontWeight: 700, whiteSpace: "nowrap" }}>{scanStageText(p.scanJob)}</span>
                  </>
                ) : p.scanError ? (
                  <Tag kind="wrong" icon="warning">还原失败 · 点开重扫</Tag>
                ) : st.scanned ? (
                  <>
                    <Tag kind="wrong">{st.wrong} 错</Tag>
                    {st.blank > 0 && <Tag kind="pending" icon="alert">{st.blank} 空</Tag>}
                    <Tag kind="correct">{st.correct} 对</Tag>
                    {st.problems > 0 && st.corrected >= st.problems && <Tag kind="correct" icon="checkcircle">全部订正</Tag>}
                  </>
                ) : (
                  <Tag kind="pending">待扫描</Tag>
                )}
              </span>
            </span>
            {p.scanJob ? <Icon name="sparkles" size={20} style={{ color: "var(--brand)" }} /> : <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />}
            </button>
            <button className="icon-btn" aria-label={`删除「${p.name}」`} style={{ color: "var(--tertiary)" }} onClick={() => setDeletingPaper(p.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        );
      })}
      {folder.papers.length > 0 && <Hint>点一张试卷看电子版。新加的试卷扫完会自动并进「错题汇总」。</Hint>}
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Tag kind="wrong" icon="xmark">答错 {errors.filter((e) => e.kind !== "未作答").length}</Tag>
        <Tag kind="pending" icon="alert">未作答 {errors.filter((e) => e.kind === "未作答").length}</Tag>
        <Tag kind="correct">已订正 {stats.corrected}</Tag>
      </div>
      {errors.length === 0 && <Empty icon="seal" title={stats.unscanned > 0 ? "先扫描试卷" : "这个文件夹没有错题，也没有空题"} text={stats.unscanned > 0 ? "扫描后错题会自动出现在这里。" : "真棒。"} />}
      {groups.map(([k, items]) => {
        const done = items.filter((i) => i.corrected).length;
        const pct = Math.round((done / items.length) * 100);
        const papers = new Set(items.map((i) => i.paperId)).size;
        return (
          <div key={k} className="card" style={{ gap: 10, padding: "12px 14px" }}>
            <div className="kp">
              <KnowledgeIcon name={k} subject={items[0].subject} />
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="kp__name">{k}</span>
                <span className="kp__meta">{items.length} 题{papers > 1 ? ` · 来自 ${papers} 张试卷` : ""} · {done === items.length ? "全部订正" : done > 0 ? `已订正 ${done}` : "还没订正"}</span>
              </span>
              <span className="t-cap" style={{ fontWeight: 700, color: done === items.length ? "var(--mastered)" : "var(--secondary)" }}>{done === items.length ? <Icon name="checkcircle" size={18} stroke={2.4} /> : `${pct}%`}</span>
            </div>
            <span className="progress"><span style={{ width: `${pct}%`, background: done === items.length ? "var(--mastered)" : "var(--brand)" }} /></span>
            <div className="nums">
              {items.map((i) => (
                <button key={i.key} className={`num-chip${i.corrected ? " num-chip--done" : i.kind === "未作答" ? " num-chip--blank" : ""}`} onClick={() => toggle(i, !i.corrected)} aria-label={`第 ${i.q.number} 题（${i.kind}），${i.corrected ? "已订正，点击撤销" : "点击标记已订正"}`}>
                  {i.corrected && <Icon name="check" size={11} stroke={3.2} />}
                  {i.q.number}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {errors.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 0" }}>
            <span className="t-sub" style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="list" size={16} stroke={2.2} />逐题 · {errors.length}</span>
            <span className="t-foot c-sec">做完一题就勾掉</span>
          </div>
          {groups.map(([k, items]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="t-headline" style={{ marginTop: 4 }}>{k} · {items.length} 题</span>
              {items.map((i) => (
                <ErrorCard key={i.key} item={i} onToggle={(next) => toggle(i, next)} showSource={folder.papers.length > 1} />
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="screen">
      <InlineNav title="" back backLabel="试卷" right={<button className="icon-btn" aria-label="更多" style={{ color: "var(--brand)" }} onClick={() => setMenu(true)}><Icon name="ellipsis" size={24} /></button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {stats.subjects.length > 1 ? <SubjectStack subjects={stats.subjects} size="md" /> : <SubjectTile subject={stats.subject} size="lg" />}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <h1 className="t-title2 ellipsis" style={{ fontWeight: 800 }}>{folder.name}</h1>
            <span className="t-foot c-sec" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="pin" size={14} stroke={2} />{stats.exam || (stats.subject ? SUBJECT_LABEL[stats.subject] : "扫描后自动识别考试信息")}</span>
          </div>
        </div>
        <div className="stats">
          <Stat label="错题" value={stats.wrong} icon="xcircle" color="var(--wrong)" />
          <Stat label="未作答" value={stats.blank} icon="alert" color="var(--accent-on)" />
          <Stat label="已订正" value={stats.corrected} icon="checkcircle" color="var(--mastered)" />
        </div>
        <IconSegmented value={tab} onChange={setTab} options={[{ value: "papers", label: `试卷 ${stats.papers}`, icon: "document" }, { value: "errors", label: `错题汇总 ${stats.problems}`, icon: "list" }]} />

        {tab === "papers" ? papersTab : errorsTab}

        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          <Button variant="outline" icon="export" onClick={() => setExporting(true)} style={{ flex: 1 }} disabled={stats.papers === 0}>导出</Button>
          <Button icon="camera" onClick={() => setAddSheet(true)} style={{ flex: 1.3 }}>{stats.papers ? "再拍一张" : "拍试卷"}</Button>
        </div>
      </div>

      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title="加一张试卷">
        <Button icon="camera" onClick={() => openCapture("camera")}>拍照</Button>
        <Button variant="tinted" icon="photo" onClick={() => openCapture("photos")}>从相册选（可多选）</Button>
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} title={folder.name}>
        <Button variant="tinted" icon="pencil" onClick={() => { setMenu(false); setName(folder.name); setSubject(folder.subject ?? stats.subject ?? undefined); setRename(true); }}>重命名 / 改学科</Button>
        <Button variant="danger" icon="trash" onClick={() => { setMenu(false); setConfirmDelete(true); }}>删除文件夹</Button>
      </Sheet>

      <Sheet open={rename} onClose={() => setRename(false)} title="文件夹">
        <input className="input" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUBJECTS.map((s) => (
            <button key={s} className={`chip chip--select${subject === s ? " on" : ""}`} onClick={() => setSubject(subject === s ? undefined : s)} style={{ gap: 6 }}>
              <SubjectTile subject={s} size="xs" />{SUBJECT_LABEL[s]}
            </button>
          ))}
        </div>
        <Button onClick={saveMeta}>保存</Button>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`删除「${folder.name}」？`}>
        <p className="t-sub c-sec">会删掉里面 {folder.papers.length} 张试卷的照片、电子版和订正记录，不能恢复。</p>
        <Button variant="danger" onClick={async () => { await deleteFolder(folder.id); toast("已删除"); nav("/papers", { replace: true }); }}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(false)}>取消</Button>
      </Sheet>

      <Sheet open={Boolean(deletingPaper)} onClose={() => setDeletingPaper(null)} title="删除这张试卷？">
        <p className="t-sub c-sec">照片、电子版和订正记录会一起删掉。</p>
        <Button variant="danger" onClick={async () => { if (deletingPaper) await deletePaper(folder.id, deletingPaper); setDeletingPaper(null); await reload(); }}>删除</Button>
        <Button variant="plain" onClick={() => setDeletingPaper(null)}>取消</Button>
      </Sheet>

      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={subjectFilter ? `${folder.name} · ${SUBJECT_LABEL[subjectFilter]}` : folder.name} subtitle={stats.syllabus ? `按${stats.syllabus}归类` : stats.exam} errors={errors} papers={subjectFilter ? folder.papers.filter((p) => paperSubject(p) === subjectFilter) : folder.papers} />
    </div>
  );
}
