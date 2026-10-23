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

  /** 某个学科下的知识点：一张分组卡，卡头是学科，行是知识点，点开行展开逐题 */
  const kpGroup = (items: ErrorItem[], subj: Subject) => {
    const groups = groupByKnowledge(items);
    const c = subjectColors(subj);
    return (
      <div className="card" style={{ padding: 0, gap: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: c.bg }}>
          <SubjectTile subject={subj} size="sm" style={{ background: "var(--card)" }} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span className="t-headline" style={{ color: c.color }}>{SUBJECT_LABEL[subj]}</span>
            <span className="t-cap" style={{ color: c.color, opacity: 0.8 }}>{items.length} 题 · {groups.length} 个知识点 · 错得多的在前</span>
          </span>
          <span className="t-cap" style={{ color: c.color, fontWeight: 700 }}>已订正 {items.filter((i) => i.corrected).length}</span>
        </div>
        {groups.map(([k, list], idx) => {
          const done = list.filter((i) => i.corrected).length;
          const open = openKey === `${subj}:${k}`;
          const sources = new Set(list.map((i) => i.folderId)).size;
          return (
            <div key={k} style={{ borderTop: idx === 0 ? "none" : "1px solid var(--separator-light)" }}>
              <button className="row" style={{ minHeight: 60, padding: "10px 14px", width: "100%", background: open ? "var(--fill-light)" : "transparent" }} onClick={() => setOpenKey(open ? null : `${subj}:${k}`)} aria-expanded={open}>
                <KnowledgeIcon name={k} subject={subj} />
                <span className="row__main" style={{ gap: 2 }}>
                  <span className="row__title">{k}</span>
                  <span className="row__sub">来自 {sources} 个文件夹 · {done === list.length ? "全部订正" : done > 0 ? `已订正 ${done}` : "还没订正"}</span>
                </span>
                <span className={`tag ${done === list.length ? "tag--correct" : "tag--wrong"}`} style={{ fontWeight: 800 }}>{list.length}</span>
                <Icon name={open ? "chevron-down" : "chevron-right"} size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
              {open && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 10px 12px", background: "var(--fill-light)" }}>
                  {list.map((i) => <ErrorCard key={i.key} item={i} onToggle={(next) => toggle(i, next)} showSource />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="screen">
      <LargeNav title="错题库" actions={
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
                <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0" }}>
                  {bySubject.map(([s, list]) => {
                    const c = subjectColors(s);
                    const on = s === activeSubject;
                    return (
                      <button key={s} className="chip" style={{ height: 40, padding: "0 14px 0 8px", gap: 8, borderRadius: 20, flexShrink: 0, background: on ? c.color : "var(--card)", color: on ? "#fff" : "var(--label)", border: `1.5px solid ${on ? c.color : "var(--separator-light)"}` }} onClick={() => setSubject(s)} aria-pressed={on}>
                        <SubjectTile subject={s} size="xs" style={on ? { background: "rgba(255,255,255,.22)", color: "#fff" } : undefined} />
                        {SUBJECT_LABEL[s]}
                        <span style={{ fontSize: 12, fontWeight: 700, opacity: on ? 0.9 : 0.6 }}>{list.length}</span>
                      </button>
                    );
                  })}
                </div>
                {activeSubject && kpGroup(scoped, activeSubject)}
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
