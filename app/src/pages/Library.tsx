import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { GroupsResponse, Mistake, Subject } from "../api/types";
import { Icon } from "../components/Icon";
import { MistakeRow } from "../components/MistakeRow";
import { Button, Empty, IconButton, LargeNav, Segmented, Spinner } from "../components/ui";
import { SUBJECTS, SUBJECT_LABEL, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../store/auth";
import { toast } from "../store/banner";
import { useCapture } from "../store/capture";

type View = "topic" | "time";

export default function Library() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const setReturnTo = useCapture((s) => s.setReturnTo);
  const [view, setView] = useState<View>(() => (localStorage.getItem("zcb.libraryView") as View) || "topic");
  const [subject, setSubject] = useState<Subject | "all">("all");
  const [onlyDue, setOnlyDue] = useState(false);
  const [q, setQ] = useState("");

  const params = new URLSearchParams();
  if (subject !== "all") params.set("subject", subject);
  if (onlyDue) params.set("state", "due");
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();

  const groups = useAsync(() => api<GroupsResponse>(`/api/mistakes/groups?${qs}`), [qs]);
  const list = useAsync(() => api<{ items: Mistake[]; total: number }>(`/api/mistakes?${qs}`), [qs]);

  const changeView = (v: View) => {
    setView(v);
    localStorage.setItem("zcb.libraryView", v);
  };

  const subjects = (user?.subjects?.length ? user.subjects : SUBJECTS) as Subject[];
  const searching = q.trim().length > 0;
  const effectiveView: View = searching ? "time" : view;

  const timeSections = useMemo(() => {
    const items = list.data?.items ?? [];
    const now = new Date();
    const today = now.toDateString();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const sec = { today: [] as Mistake[], week: [] as Mistake[], earlier: [] as Mistake[] };
    for (const m of items) {
      const d = new Date(m.createdAt);
      if (d.toDateString() === today) sec.today.push(m);
      else if (d >= weekAgo) sec.week.push(m);
      else sec.earlier.push(m);
    }
    return sec;
  }, [list.data]);

  const isEmptyAll = !groups.loading && groups.data && groups.data.summary.total === 0 && subject === "all" && !onlyDue && !searching;
  const loading = effectiveView === "topic" ? groups.loading && !groups.data : list.loading && !list.data;

  return (
    <div className="screen">
      <LargeNav
        title="错题库"
        actions={
          <>
            <IconButton name="export" label="导出" onClick={() => toast("导出 PDF 将在下个版本提供")} />
            <IconButton name="camera" label="拍照录题" onClick={() => { setReturnTo("/library"); nav("/capture"); }} />
          </>
        }
      />
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ position: "relative", display: "block" }}>
          <Icon name="search" size={18} stroke={2.2} style={{ position: "absolute", left: 10, top: 9, color: "var(--secondary)" }} />
          <input className="input" style={{ minHeight: 36, padding: "6px 34px", background: "var(--fill)" }} placeholder="搜索题目或知识点" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索" />
          {q && (
            <button style={{ position: "absolute", right: 6, top: 2, width: 32, height: 32, color: "var(--tertiary)" }} aria-label="清除" onClick={() => setQ("")}>
              <Icon name="xmark" size={16} stroke={2.4} />
            </button>
          )}
        </label>
        {!searching && <Segmented value={view} onChange={changeView} options={[{ value: "topic", label: "按知识点" }, { value: "time", label: "按时间" }]} />}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -16px", padding: "0 16px 2px", scrollbarWidth: "none" }}>
          <button className={`chip chip--filter${subject === "all" ? " on" : ""}`} onClick={() => setSubject("all")}>全部</button>
          {subjects.map((s) => (
            <button key={s} className={`chip chip--filter${subject === s ? " on" : ""}`} onClick={() => setSubject(s)}>{SUBJECT_LABEL[s]}</button>
          ))}
          <button className={`chip chip--filter${onlyDue ? " on" : ""}`} aria-pressed={onlyDue} onClick={() => setOnlyDue((v) => !v)}>只看待复习</button>
        </div>
      </div>

      <div className="screen__content" style={{ paddingTop: 12 }}>
        {loading && <Spinner />}
        {isEmptyAll && (
          <Empty icon="books" title="还没有错题" text="拍一张试卷，错题会自动整理到这里" action={<Button size="sm" onClick={() => { setReturnTo("/library"); nav("/capture"); }}>拍照录题</Button>} />
        )}

        {!isEmptyAll && effectiveView === "topic" && groups.data && (
          <>
            <span className="t-foot c-sec">
              {groups.data.summary.topics} 个知识点 · {groups.data.summary.total} 道错题 · {groups.data.summary.mastered} 道已掌握
            </span>
            {groups.data.sections.length === 0 && !groups.loading && (
              <Empty icon="search" title="这个条件下没有错题" action={<Button size="sm" variant="tinted" onClick={() => { setSubject("all"); setOnlyDue(false); }}>清除筛选</Button>} />
            )}
            {groups.data.sections.map((sec) => (
              <div key={sec.subject} className="group">
                <div className="group__header">
                  <span>{SUBJECT_LABEL[sec.subject]} · {sec.total} 题</span>
                  <span style={{ fontWeight: 500 }}>掌握 {sec.mastered}/{sec.total}</span>
                </div>
                {sec.topics.map((t) => (
                  <button key={t.topic} className="row" style={{ minHeight: 60 }} onClick={() => nav(`/library/topic/${sec.subject}/${encodeURIComponent(t.topic)}`)}>
                    <span className="row__main" style={{ gap: 5 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="row__title">{t.topic}</span>
                        {t.due > 0 ? (
                          <span className="chip chip--sm" style={{ background: "var(--due-bg)", color: "var(--due)" }}>{t.due} 待复习</span>
                        ) : t.learning > 0 ? (
                          <span className="chip chip--sm" style={{ background: "var(--learning-bg)", color: "var(--learning)" }}>巩固中</span>
                        ) : (
                          <span className="chip chip--sm" style={{ background: "var(--mastered-bg)", color: "var(--mastered)" }}>已掌握</span>
                        )}
                      </span>
                      <span className="bar" aria-hidden="true">
                        <span style={{ width: `${(t.mastered / t.total) * 100}%`, background: "var(--mastered)" }} />
                        <span style={{ width: `${(t.learning / t.total) * 100}%`, background: "var(--brand)" }} />
                        <span style={{ width: `${(t.due / t.total) * 100}%`, background: "var(--due)" }} />
                      </span>
                      <span className="row__sub">{t.total} 题 · 最近 {formatDate(t.latestAt)}</span>
                    </span>
                    <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                  </button>
                ))}
              </div>
            ))}
          </>
        )}

        {!isEmptyAll && effectiveView === "time" && list.data && (
          <>
            <span className="t-foot c-sec">{list.data.total} 道错题{searching ? `，匹配「${q.trim()}」` : ""}</span>
            {list.data.total === 0 && <Empty icon="search" title="这个条件下没有错题" action={<Button size="sm" variant="tinted" onClick={() => { setSubject("all"); setOnlyDue(false); setQ(""); }}>清除筛选</Button>} />}
            {(["today", "week", "earlier"] as const).map((k) =>
              timeSections[k].length ? (
                <div key={k} className="group">
                  <div className="group__header"><span>{k === "today" ? "今天" : k === "week" ? "本周" : "更早"}</span></div>
                  {timeSections[k].map((m) => <MistakeRow key={m.id} m={m} />)}
                </div>
              ) : null,
            )}
          </>
        )}
      </div>
    </div>
  );
}
