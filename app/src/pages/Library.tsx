import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { ErrorCard } from "../components/ErrorCard";
import { ExportSheet } from "../components/ExportSheet";
import { Icon } from "../components/Icon";
import { Empty, LargeNav } from "../components/ui";
import { Hint, IconSegmented, KnowledgeIcon, SubjectTile, subjectColors } from "../components/v2";
import { allErrors, groupByKnowledge, groupByMonth, groupBySubject, type ErrorItem } from "../lib/errors";
import { listFolders, setCorrected, type Folder } from "../lib/folders";
import { SUBJECT_LABEL } from "../lib/format";
import { haptic } from "../lib/native";

type View = "subject" | "time";

/** 错题库：所有文件夹的错题汇总。按学科：学科 → 知识点 → 题；按时间：月份 → 文件夹 → 题。右上角导出当前范围的错题本。 */
export default function Library() {
  const nav = useNavigate();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [view, setView] = useState<View>("subject");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(() => listFolders().then(setFolders).catch(() => setFolders([])), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const bySubject = useMemo(() => groupBySubject(errors), [errors]);
  const byMonth = useMemo(() => groupByMonth(errors), [errors]);
  const activeSubject = subject ?? bySubject[0]?.[0] ?? null;
  const activeMonth = month ?? byMonth[0]?.[0] ?? null;
  const scoped: ErrorItem[] = view === "subject" ? errors.filter((e) => e.subject === activeSubject) : (byMonth.find(([m]) => m === activeMonth)?.[1] ?? []);
  const scopeLabel = view === "subject" ? (activeSubject ? SUBJECT_LABEL[activeSubject] : "全部") : (activeMonth ?? "全部");
  const syllabus = scoped.find((e) => e.q)?.q ? (folders ?? []).flatMap((f) => f.papers).find((p) => p.digitized?.pages.some((s) => s.syllabus))?.digitized?.pages.find((s) => s.syllabus)?.syllabus : "";

  const toggle = async (item: ErrorItem, next: boolean) => {
    await setCorrected(item.folderId, item.paperId, item.q.index, next);
    void haptic.selection();
    await reload();
  };

  const kpList = (items: ErrorItem[], subj?: Subject) =>
    groupByKnowledge(items).map(([k, list]) => {
      const done = list.filter((i) => i.corrected).length;
      const open = openKey === `${scopeLabel}:${k}`;
      const sources = new Set(list.map((i) => i.folderId)).size;
      return (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="card card--row" style={{ minHeight: 60, padding: "10px 14px" }} onClick={() => setOpenKey(open ? null : `${scopeLabel}:${k}`)} aria-expanded={open}>
            <KnowledgeIcon name={k} subject={subj ?? list[0].subject} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="t-headline">{k}</span>
              <span className="t-cap c-sec">来自 {sources} 个文件夹 · {done === list.length ? "全部订正" : done > 0 ? `已订正 ${done}` : "还没订正"}</span>
            </span>
            <span className={`tag ${done === list.length ? "tag--correct" : "tag--wrong"}`} style={{ fontWeight: 800 }}>{list.length}</span>
            <Icon name={open ? "chevron-down" : "chevron-right"} size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
          {open && list.map((i) => <ErrorCard key={i.key} item={i} onToggle={(next) => toggle(i, next)} showSource />)}
        </div>
      );
    });

  return (
    <div className="screen">
      <LargeNav title="错题库" eyebrow={folders ? `${folders.length} 个文件夹 · ${errors.length} 道错题` : undefined} actions={
        <button aria-label="导出当前范围的错题本" className="tile" style={{ background: "var(--brand-tint)", color: "var(--brand-on-tint)", border: 0, width: 44, height: 44, borderRadius: 22 }} onClick={() => setExporting(true)} disabled={scoped.length === 0}>
          <Icon name="export" size={22} stroke={2.2} />
        </button>
      } />
      <div className="screen__content" style={{ gap: 12 }}>
        {folders && errors.length === 0 && <Empty icon="seal" title="还没有错题" text="扫描试卷后，判错的题会自动汇总到这里。" />}

        {errors.length > 0 && (
          <>
            <IconSegmented value={view} onChange={setView} options={[{ value: "subject", label: "按学科", icon: "grid" }, { value: "time", label: "按时间", icon: "clock" }]} />

            {view === "subject" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, bySubject.length))}, minmax(0, 1fr))`, gap: 8 }}>
                  {bySubject.map(([s, list]) => {
                    const c = subjectColors(s);
                    const on = s === activeSubject;
                    return (
                      <button key={s} className="card" style={{ gap: 8, padding: 12, border: `2px solid ${on ? c.color : "transparent"}`, textAlign: "left" }} onClick={() => setSubject(s)} aria-pressed={on}>
                        <SubjectTile subject={s} size="sm" />
                        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span className="t-sub" style={{ fontWeight: 700 }}>{SUBJECT_LABEL[s]}</span>
                          <span className="t-cap c-sec">{list.length} 题 · {groupByKnowledge(list).length} 个知识点</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeSubject && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
                    <span className="t-sub" style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: subjectColors(activeSubject).color }} />{SUBJECT_LABEL[activeSubject]}{syllabus ? ` · 按${syllabus}` : ""}
                    </span>
                    <span className="t-foot c-sec">错得最多的在前</span>
                  </div>
                )}
                {kpList(scoped, activeSubject ?? undefined)}
              </>
            )}

            {view === "time" && (
              <>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                  {byMonth.map(([m, list]) => (
                    <button key={m} className={`chip chip--select${m === activeMonth ? " on" : ""}`} onClick={() => setMonth(m)} style={{ flexShrink: 0 }}>{m} · {list.length}</button>
                  ))}
                </div>
                {Object.entries(scoped.reduce<Record<string, ErrorItem[]>>((acc, e) => { (acc[e.folderId] ??= []).push(e); return acc; }, {})).map(([fid, list]) => {
                  const f = folders?.find((x) => x.id === fid);
                  const done = list.filter((i) => i.corrected).length;
                  const open = openKey === `f:${fid}`;
                  return (
                    <div key={fid} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <button className="card card--row" style={{ minHeight: 60, padding: "10px 14px" }} onClick={() => setOpenKey(open ? null : `f:${fid}`)} aria-expanded={open}>
                        <SubjectTile subject={list[0].subject} size="sm" />
                        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span className="t-headline ellipsis">{f?.name ?? list[0].folderName}</span>
                          <span className="t-cap c-sec">{new Set(list.map((i) => i.paperId)).size} 张试卷 · {done === list.length ? "全部订正" : done > 0 ? `已订正 ${done}` : "还没订正"}</span>
                        </span>
                        <span className={`tag ${done === list.length ? "tag--correct" : "tag--wrong"}`} style={{ fontWeight: 800 }}>{list.length}</span>
                        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </button>
                      {open && (
                        <>
                          <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 600, textAlign: "left", padding: "0 4px" }} onClick={() => nav(`/papers/${fid}`)}>打开这个文件夹 ›</button>
                          {list.map((i) => <ErrorCard key={i.key} item={i} onToggle={(next) => toggle(i, next)} showSource />)}
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            <Hint>{view === "subject" ? "「按时间」是月份 → 文件夹 → 题。" : "「按学科」是学科 → 知识点 → 题。"}右上角导出的是当前范围：{scopeLabel}。</Hint>
          </>
        )}
      </div>
      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`错题库 · ${scopeLabel}`} subtitle={syllabus ? `按${syllabus}归类` : undefined} errors={scoped} />
    </div>
  );
}
