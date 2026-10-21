import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { PracticeResult, PracticeSession } from "../api/types";
import { Button, Ring, Spinner } from "../components/ui";
import { toastError } from "../store/banner";

type Payload = { session: PracticeSession; result: PracticeResult };

export default function QuizResult() {
  const { sid = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [data, setData] = useState<Payload | null>((loc.state as Payload | null) ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) {
      api<Payload>(`/api/practice/${sid}/finish`, { method: "POST" }).then(setData).catch(toastError);
    }
  }, [sid, data]);

  const again = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const s = data.session;
      const body = s.mode === "weak" ? { mode: "weak", topic: s.topic ?? undefined, subject: s.subject ?? undefined, count: 3 } : { mode: "custom", count: s.items.length <= 3 ? 3 : s.items.length <= 5 ? 5 : 10 };
      const res = await api<{ session: PracticeSession }>("/api/practice/start", { method: "POST", body });
      nav(`/practice/quiz/${res.session.id}`, { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner text="正在统计" />;
  const r = data.result;
  const pct = Math.round(r.rate * 100);
  const title = r.answered === 0 ? "这组没有作答" : r.correct === r.total ? `${r.total} 题全对` : `答对 ${r.correct} / ${r.total} 题`;
  const mainTopic = r.topics[0];

  return (
    <div className="screen">
      <header className="nav nav--inline">
        <div className="nav__side" />
        <div className="nav__center"><span className="t-headline">练习完成</span></div>
        <div className="nav__side nav__side--end"><button className="nav-btn" onClick={() => nav("/practice", { replace: true })}>完成</button></div>
      </header>
      <div className="screen__content screen__content--modal" style={{ alignItems: "center", textAlign: "center", gap: 16, paddingTop: 24 }}>
        <Ring value={r.rate} size={120} stroke={9} color={pct >= 80 ? "var(--mastered)" : "var(--brand)"}>
          <span className="num" style={{ fontSize: 30, fontWeight: 700 }}>{pct}%</span>
          <span className="t-cap c-sec">正确率</span>
        </Ring>
        <h1 className="t-title2">{title}</h1>
        {mainTopic && (
          <p className="t-sub c-sec">
            {mainTopic.topic} 掌握度 {Math.round(mainTopic.before * 100)}% → <b style={{ color: mainTopic.after >= mainTopic.before ? "var(--mastered)" : "var(--wrong)" }}>{Math.round(mainTopic.after * 100)}%</b>
            {r.correct === r.total && r.total > 0 ? "，更稳了" : ""}
          </p>
        )}
        {r.topics.length > 1 && (
          <div className="card" style={{ width: "100%", textAlign: "left", gap: 6 }}>
            {r.topics.map((t) => (
              <div key={t.topic} style={{ display: "flex", justifyContent: "space-between" }} className="t-sub">
                <span>{t.topic}</span>
                <span className="num c-sec">{Math.round(t.before * 100)}% → {Math.round(t.after * 100)}%</span>
              </div>
            ))}
          </div>
        )}
        {r.newlyMastered.length > 0 && (
          <div className="card" style={{ width: "100%", textAlign: "left", gap: 8 }}>
            <span className="t-headline" style={{ color: "var(--mastered)" }}>升级为已掌握 · {r.newlyMastered.length} 题</span>
            {r.newlyMastered.map((m) => (
              <button key={m.id} className="t-sub ellipsis" style={{ textAlign: "left", color: "var(--brand)" }} onClick={() => nav(`/mistake/${m.id}`)}>
                {m.knowledgePoints[0]} · {m.stemText}
              </button>
            ))}
          </div>
        )}
        {r.correct < r.answered && <span className="t-foot c-sec">答错的题已回到待复习队列</span>}
        <div style={{ marginTop: "auto", width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <Button onClick={again} disabled={busy}>再练一组</Button>
          <Button variant="tinted" onClick={() => nav("/practice", { replace: true })} style={{ height: 44 }}>回到练习</Button>
        </div>
      </div>
    </div>
  );
}
