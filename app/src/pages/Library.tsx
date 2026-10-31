import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { ErrorCard } from "../components/ErrorCard";
import { ExportSheet } from "../components/ExportSheet";
import { Icon } from "../components/Icon";
import { KnowledgeBars, SubjectSplit, TrendBars } from "../components/Insights";
import { Buddy } from "../components/Illustration";
import { CountUp } from "../components/Motion";
import { Segmented } from "../components/ui";
import { IconSegmented, KnowledgeIcon, Stat, SubjectTile, subjectColors } from "../components/v2";
import { RANGE_LABEL, analyze, inRange, type Range } from "../lib/insights";
import { allErrors, groupByKnowledge, groupByMonth, groupBySubject, type ErrorItem } from "../lib/errors";
import { listFolders, type Folder } from "../lib/folders";
import { SUBJECT_LABEL } from "../lib/format";

type View = "subject" | "time";

/**
 * 分析：上半是最近错题的特点（自动总结一句话、每周趋势、学科分布、薄弱知识点排行），右上角一键导出这段时间的错题本；
 * 下半是全部错题，按学科（学科 → 知识点 → 题）或按时间（月份 → 文件夹 → 题）翻看。
 */
export default function Library() {
  const nav = useNavigate();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [view, setView] = useState<View>("subject");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<Range>("30d");
  const [pickedKp, setPickedKp] = useState<string | null>(null);

  const reload = useCallback(() => listFolders().then(setFolders).catch(() => setFolders([])), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const bySubject = useMemo(() => groupBySubject(errors), [errors]);
  const byMonth = useMemo(() => groupByMonth(errors), [errors]);
  const activeSubject = subject ?? bySubject[0]?.[0] ?? null;
  const activeMonth = month ?? byMonth[0]?.[0] ?? null;
  const ranged = useMemo(() => inRange(errors, range), [errors, range]);
  const insight = useMemo(() => analyze(ranged), [ranged]);
  const pickedList = insight.knowledge.find(([k]) => k === pickedKp)?.[1] ?? [];
  const scoped: ErrorItem[] = view === "subject" ? errors.filter((e) => e.subject === activeSubject) : (byMonth.find(([m]) => m === activeMonth)?.[1] ?? []);
  const syllabus = scoped.find((e) => e.q)?.q ? (folders ?? []).flatMap((f) => f.papers).find((p) => p.digitized?.pages.some((s) => s.syllabus))?.digitized?.pages.find((s) => s.syllabus)?.syllabus : "";

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
        </div>
        {groups.map(([k, list], idx) => {
          const open = openKey === `${subj}:${k}`;
          const sources = new Set(list.map((i) => i.folderId)).size;
          return (
            <div key={k} style={{ borderTop: idx === 0 ? "none" : "1px solid var(--separator-light)" }}>
              <button className="row" style={{ minHeight: 60, padding: "10px 14px", width: "100%", background: open ? "var(--fill-light)" : "transparent" }} onClick={() => setOpenKey(open ? null : `${subj}:${k}`)} aria-expanded={open}>
                <KnowledgeIcon name={k} subject={subj} />
                <span className="row__main" style={{ gap: 2 }}>
                  <span className="row__title">{k}</span>
                  <span className="row__sub">来自 {sources} 个文件夹{list.some((i) => i.kind === "未作答") ? ` · 未作答 ${list.filter((i) => i.kind === "未作答").length}` : ""}</span>
                </span>
                <span className="tag tag--wrong" style={{ fontWeight: 800 }}>{list.length}</span>
                <Icon name={open ? "chevron-down" : "chevron-right"} size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
              {open && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 10px 12px", background: "var(--fill-light)" }}>
                  {list.map((i) => <ErrorCard key={i.key} item={i} showSource />)}
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
      <header className="topbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Segmented value={range} onChange={(r) => { setRange(r); setPickedKp(null); }} options={(["7d", "30d", "all"] as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
        </div>
        <button aria-label="导出这段时间的错题本" className="tile" style={{ background: "var(--brand-tint)", color: "var(--brand-on-tint)", border: 0, width: 36, height: 36, borderRadius: 18 }} onClick={() => setExporting(true)} disabled={ranged.length === 0}>
          <Icon name="export" size={18} stroke={2.2} />
        </button>
      </header>
      <div className="screen__content" style={{ gap: 12 }}>
        {folders && errors.length === 0 && <div className="empty rise"><Buddy scene="chart" size={150} /><span className="empty__title">还没有错题</span><span className="t-sub">扫描试卷后，这里会自动画出你最近错在哪。</span></div>}

        {errors.length > 0 && (
          <>
            <div className="card insight rise" style={{ ["--i" as string]: 0, flexDirection: "row", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="t-foot" style={{ fontWeight: 700, color: "var(--brand)", display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="sparkles" size={14} stroke={2.2} />自动总结 · {RANGE_LABEL[range]}</span>
              <span className="t-body" style={{ fontWeight: 600 }}>{insight.summary}</span>
              </div>
              <Buddy scene="chart" size={96} style={{ flexShrink: 0, margin: "-8px -10px -12px 0" }} />
            </div>
            <div className="stats rise" style={{ ["--i" as string]: 1 }}>
              <Stat label="错题" value={<CountUp value={insight.wrong} />} icon="xcircle" color="var(--wrong)" />
              <Stat label="未作答" value={<CountUp value={insight.blank} />} icon="alert" color="var(--accent-on)" />
              <Stat label="知识点" value={<CountUp value={insight.knowledge.length} />} icon="target" color="var(--brand)" />
            </div>
            <div className="card rise" style={{ ["--i" as string]: 2 }}><TrendBars key={range} items={errors} /></div>
            {insight.total > 0 && (
              <>
                {insight.subjects.length > 1 && <div className="card rise" style={{ ["--i" as string]: 3 }}><SubjectSplit key={range} groups={insight.subjects} /></div>}
                <div className="card rise" style={{ ["--i" as string]: 4 }}>
                  <KnowledgeBars key={range} groups={insight.knowledge} picked={pickedKp} onPick={(k) => setPickedKp(pickedKp === k ? null : k)} />
                  {pickedList.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                      {pickedList.map((i) => <ErrorCard key={i.key} item={i} showSource />)}
                    </div>
                  )}
                </div>
              </>
            )}

            <span className="t-title3" style={{ marginTop: 12, padding: "0 4px" }}>全部错题</span>
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
                  const open = openKey === `f:${fid}`;
                  return (
                    <div key={fid} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <button className="card card--row" style={{ minHeight: 60, padding: "10px 14px" }} onClick={() => setOpenKey(open ? null : `f:${fid}`)} aria-expanded={open}>
                        <SubjectTile subject={list[0].subject} size="sm" />
                        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span className="t-headline ellipsis">{f?.name ?? list[0].folderName}</span>
                          <span className="t-cap c-sec">{new Set(list.map((i) => i.paperId)).size} 张试卷 · {list.length} 道错题</span>
                        </span>
                        <span className="tag tag--wrong" style={{ fontWeight: 800 }}>{list.length}</span>
                        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </button>
                      {open && (
                        <>
                          <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 600, textAlign: "left", padding: "0 4px" }} onClick={() => nav(`/papers/${fid}`)}>打开这个文件夹 ›</button>
                          {list.map((i) => <ErrorCard key={i.key} item={i} showSource />)}
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}

          </>
        )}
      </div>
      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`${RANGE_LABEL[range]}错题`} subtitle={syllabus ? `按${syllabus}归类` : undefined} errors={ranged} />
    </div>
  );
}
