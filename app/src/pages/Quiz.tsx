import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { PracticeResult, PracticeSession } from "../api/types";
import { Icon } from "../components/Icon";
import { Button, Empty, Sheet, Spinner, SubjectChip } from "../components/ui";
import { haptic } from "../lib/native";
import { toastError } from "../store/banner";

interface AnswerResponse {
  correct: boolean;
  answer: string;
  analysis: string;
  answered: number;
  total: number;
}

export default function Quiz() {
  const { sid = "" } = useParams();
  const nav = useNavigate();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string>("");
  const [feedback, setFeedback] = useState<AnswerResponse | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api<{ session: PracticeSession }>(`/api/practice/${sid}`)
      .then((r) => {
        setSession(r.session);
        setIdx(Object.keys(r.session.answers).length);
        setCorrectCount(Object.values(r.session.answers).filter((a) => a.correct).length);
      })
      .catch((e) => setError((e as Error).message));
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [sid]);

  const finish = async () => {
    setBusy(true);
    try {
      const res = await api<{ session: PracticeSession; result: PracticeResult }>(`/api/practice/${sid}/finish`, { method: "POST" });
      nav(`/practice/result/${sid}`, { replace: true, state: res });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  const next = () => {
    setFeedback(null);
    setPicked("");
    setRevealed(false);
    if (session && idx + 1 >= session.items.length) void finish();
    else setIdx((i) => i + 1);
  };

  const submit = async (answer: string, selfRated?: boolean) => {
    if (!session || busy || feedback) return;
    setBusy(true);
    try {
      const res = await api<AnswerResponse>(`/api/practice/${sid}/answer`, { method: "POST", body: { index: idx, answer, selfRated } });
      setFeedback(res);
      if (res.correct) {
        setCorrectCount((c) => c + 1);
        void haptic.light();
        timer.current = window.setTimeout(next, 700);
      } else {
        void haptic.rigid();
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Empty icon="warning" title="加载失败" text={error} action={<Button size="sm" variant="tinted" onClick={() => nav("/practice")}>回到练习</Button>} />;
  if (!session) return <Spinner text="正在出题" />;
  const item = session.items[idx];
  if (!item) return <Spinner text="正在统计" />;
  const total = session.items.length;
  const isChoice = item.questionType === "choice" && item.options.length > 0;
  const correctLetter = feedback?.answer.trim().toUpperCase().charAt(0);

  return (
    <div className="screen">
      <header className="nav nav--inline">
        <div className="nav__side"><button className="nav-btn" onClick={() => (idx > 0 ? setConfirmExit(true) : nav(-1))}>退出</button></div>
        <div className="nav__center" style={{ gap: 4, padding: "0 8px" }}>
          <span className="t-sub num" style={{ fontWeight: 600 }}>第 {idx + 1} 题，共 {total} 题</span>
          <div className="bar" style={{ width: "100%", height: 4 }}><span style={{ width: `${(idx / total) * 100}%`, background: "var(--brand)", transition: "width .3s" }} /></div>
        </div>
        <div className="nav__side nav__side--end"><span className="t-foot c-sec num">答对 {correctCount}</span></div>
      </header>
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 8 }}>
        <div className="card" style={{ gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SubjectChip subject={item.subject} small />
            <span className="t-foot c-sec">{item.topic}{item.isVariant ? " · 同类变式" : ""}</span>
          </div>
          <p className="t-title3" style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{item.question}</p>
        </div>

        {isChoice && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {item.options.map((o, i) => {
              const L = String.fromCharCode(65 + i);
              const cls = feedback ? (L === correctLetter ? " correct" : L === picked ? " wrong" : "") : "";
              return (
                <button key={i} className={`option${cls}`} disabled={Boolean(feedback) || busy} onClick={() => { setPicked(L); void submit(L); }}>
                  <span className="option__letter">{L}</span>
                  <span>{o}</span>
                  {feedback && L === correctLetter && <Icon name="check" size={20} stroke={2.6} style={{ marginLeft: "auto", color: "var(--mastered)" }} />}
                </button>
              );
            })}
          </div>
        )}

        {item.questionType === "fill" && !feedback && (
          <form className="card" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void submit(picked); }}>
            <label htmlFor="fill" className="t-foot c-sec" style={{ fontWeight: 600 }}>你的答案</label>
            <input id="fill" className="input" autoFocus value={picked} onChange={(e) => setPicked(e.target.value)} placeholder="填写答案" />
            <Button type="submit" disabled={!picked.trim() || busy}>提交</Button>
          </form>
        )}

        {item.questionType === "solve" && !feedback && (
          <div className="card" style={{ gap: 10 }}>
            {!revealed ? (
              <>
                <p className="t-sub c-sec">在草稿纸上做一做，再看答案对照。</p>
                <Button onClick={() => setRevealed(true)}>我做好了，看答案</Button>
              </>
            ) : (
              <>
                <span className="t-foot c-sec" style={{ fontWeight: 600 }}>参考答案</span>
                <p className="t-body" style={{ fontWeight: 700 }}>{session.items[idx].answer ?? "（见解析）"}</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="rate-btn" style={{ background: "var(--wrong-bg)", color: "var(--wrong)" }} onClick={() => submit("", false)} disabled={busy}>我做错了</button>
                  <button className="rate-btn" style={{ background: "var(--mastered-bg)", color: "var(--mastered)" }} onClick={() => submit("", true)} disabled={busy}>我做对了</button>
                </div>
              </>
            )}
          </div>
        )}

        {feedback && (
          <div className="card" style={{ border: `1.5px solid ${feedback.correct ? "var(--mastered)" : "var(--wrong)"}`, gap: 8 }}>
            <span className="t-headline" style={{ color: feedback.correct ? "var(--mastered)" : "var(--wrong)" }}>{feedback.correct ? "答对了" : "这次没对"}</span>
            <p className="t-body"><b>正确答案：</b>{feedback.answer}</p>
            {feedback.analysis && <p className="t-sub" style={{ color: "var(--secondary)" }}>{feedback.analysis}</p>}
            {!feedback.correct && <span className="t-foot c-sec">这道题会回到待复习，明天再见。</span>}
          </div>
        )}

        {feedback && !feedback.correct && (
          <div style={{ marginTop: "auto" }}>
            <Button onClick={next} disabled={busy}>{idx + 1 >= total ? "看结果" : "下一题"}</Button>
          </div>
        )}
      </div>

      <Sheet open={confirmExit} onClose={() => setConfirmExit(false)} title="现在退出？">
        <p className="t-sub c-sec">已答的 {idx} 题会记录结果，未答的不计分。</p>
        <Button onClick={finish} disabled={busy}>结束并看结果</Button>
        <Button variant="plain" onClick={() => setConfirmExit(false)}>继续练习</Button>
      </Sheet>
    </div>
  );
}
