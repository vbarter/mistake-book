import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { PracticeSession, Subject, WeakTopic } from "../api/types";
import { Button, Empty, LargeNav, Segmented, Spinner, SubjectChip } from "../components/ui";
import { SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../store/auth";
import { toastError } from "../store/banner";

export default function Practice() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<"weak" | "custom">("weak");
  const { data, loading } = useAsync(() => api<{ topics: WeakTopic[]; suggestedMinutes: number }>("/api/practice/weak"));
  const [subjects, setSubjects] = useState<Subject[]>(() => (user?.subjects?.length ? user.subjects : SUBJECTS));
  const [count, setCount] = useState<3 | 5 | 10>(3);
  const [onlyDue, setOnlyDue] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api<{ session: PracticeSession }>("/api/practice/start", { method: "POST", body });
      nav(`/practice/quiz/${res.session.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const topics = data?.topics ?? [];
  const barColor = (rate: number) => (rate < 0.4 ? "var(--due)" : rate < 0.8 ? "var(--brand)" : "var(--mastered)");

  return (
    <div className="screen">
      <LargeNav title="练习" />
      <div style={{ padding: "0 16px 12px" }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: "weak", label: "薄弱专项" }, { value: "custom", label: "自主组卷" }]} />
      </div>
      <div className="screen__content">
        {tab === "weak" && (
          <>
            {loading && !data && <Spinner />}
            {data && topics.length === 0 && (
              <div className="card" style={{ background: "var(--mastered)", color: "#fff", gap: 12 }}>
                <h2 className="t-title3">没有薄弱点了</h2>
                <p className="t-sub" style={{ opacity: 0.9 }}>所有知识点掌握度都在 80% 以上，去自主组卷保持手感。</p>
                <Button onClick={() => setTab("custom")} style={{ background: "#fff", color: "var(--mastered)", height: 44 }}>去自主组卷</Button>
              </div>
            )}
            {topics.length > 0 && (
              <div className="card" style={{ background: "var(--brand)", color: "#fff", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span className="num" style={{ fontSize: 34, fontWeight: 700, lineHeight: "38px" }}>{topics.length}</span>
                    <span className="t-foot" style={{ opacity: 0.9 }}>薄弱知识点</span>
                  </div>
                  <span style={{ width: 1, height: 40, background: "rgba(255,255,255,.35)" }} />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span className="t-headline">今天建议练 1 组</span>
                    <span className="t-foot" style={{ opacity: 0.9 }}>约 {data?.suggestedMinutes ?? 3} 分钟 · 从最弱的开始</span>
                  </div>
                </div>
                <Button onClick={() => start({ mode: "weak", count: 3 })} disabled={busy} style={{ background: "#fff", color: "var(--brand)", height: 44 }}>开始推荐练习</Button>
              </div>
            )}
            {topics.length > 0 && (
              <div className="group">
                <div className="group__header"><span>按掌握度从低到高</span><span style={{ fontWeight: 500 }}>每组 3 题</span></div>
                {topics.map((t) => (
                  <div key={`${t.subject}-${t.topic}`} className="row" style={{ minHeight: 64 }}>
                    <button className="row__main" style={{ gap: 5, textAlign: "left" }} onClick={() => nav(`/library/topic/${t.subject}/${encodeURIComponent(t.topic)}`)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="row__title">{t.topic}</span>
                        <SubjectChip subject={t.subject} small />
                      </span>
                      <span className="bar" aria-hidden="true"><span style={{ width: `${t.masteryRate * 100}%`, background: barColor(t.masteryRate) }} /></span>
                      <span className="row__sub">掌握 {Math.round(t.masteryRate * 100)}% · {t.total} 题{t.wrongCount > t.total ? `错 ${t.wrongCount} 次` : ""}</span>
                    </button>
                    <Button variant="tinted" size="sm" onClick={() => start({ mode: "weak", topic: t.topic, subject: t.subject, count: 3 })} disabled={busy}>练 3 题</Button>
                  </div>
                ))}
              </div>
            )}
            <p className="t-foot c-sec" style={{ padding: "0 4px" }}>专项练习优先抽同类变式题。答错马上看解析，再练一题，记得更牢。</p>
          </>
        )}

        {tab === "custom" && (
          <>
            <div className="card" style={{ gap: 10 }}>
              <span className="t-headline">选择学科</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(user?.subjects?.length ? user.subjects : SUBJECTS).map((s) => (
                  <button key={s} className={`chip chip--select${subjects.includes(s) ? " on" : ""}`} aria-pressed={subjects.includes(s)} onClick={() => setSubjects((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]))}>
                    {SUBJECT_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="card" style={{ gap: 10 }}>
              <span className="t-headline">题量</span>
              <div className="seg" role="radiogroup">
                {([3, 5, 10] as const).map((n) => (
                  <button key={n} role="radio" aria-checked={count === n} className={`seg__item${count === n ? " on" : ""}`} onClick={() => setCount(n)}>{n} 题</button>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
                <span className="t-body">只练待复习的题</span>
                <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} style={{ width: 24, height: 24 }} />
              </label>
            </div>
            <div className="card" style={{ gap: 10 }}>
              <span className="t-sub c-sec">{subjects.length} 科 · {count} 题 · 约 {count * 2} 分钟</span>
              <Button onClick={() => start({ mode: "custom", subjects, count, onlyDue })} disabled={busy}>开始练习</Button>
            </div>
          </>
        )}
        {!loading && data && topics.length === 0 && tab === "weak" && (user?.subjects?.length ?? 0) === 0 && <Empty icon="pencil" title="先去录几道错题" />}
      </div>
    </div>
  );
}
