import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Mistake, Rating, TodayResponse } from "../api/types";
import { Icon } from "../components/Icon";
import { Button, Empty, InlineNav, Spinner, SubjectChip } from "../components/ui";
import { REASON_LABEL, daysLabel } from "../lib/format";
import { haptic } from "../lib/native";
import { toastError } from "../store/banner";

const INTERVALS = [1, 3, 7, 15, 30];

type Stage = "think" | "reveal";

/** 今日复习卡片流：看题 → 想一想 → 揭晓 → 自评。 */
export default function Review() {
  const nav = useNavigate();
  const [queue, setQueue] = useState<Mistake[] | null>(null);
  const [initialDone, setInitialDone] = useState(0);
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>("think");
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: string; rating: Rating; mastered: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [hintHidden, setHintHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<TodayResponse>("/api/review/today")
      .then((t) => {
        setQueue(t.items);
        setInitialDone(t.doneToday);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const m = queue?.[idx];
  const total = queue?.length ?? 0;
  const finished = queue !== null && idx >= total;

  const preview = (rating: Rating) => {
    if (!m) return "";
    const i = m.review.intervalIndex;
    if (rating === "forgot") return "明天再见";
    if (rating === "fuzzy") return daysLabel(Math.max(1, INTERVALS[i] * 0.5));
    const next = Math.min(i + 1, INTERVALS.length - 1);
    const willMaster = m.review.streak + 1 >= 2 && next >= 2;
    return willMaster ? "升级为已掌握" : daysLabel(INTERVALS[next]);
  };

  const choose = (letter: string) => {
    if (!m || stage !== "think") return;
    setPicked(letter);
    setStage("reveal");
    const correct = letter === (m.correctAnswer ?? "").trim().toUpperCase().charAt(0);
    void (correct ? haptic.light() : haptic.rigid());
  };

  const rate = async (rating: Rating) => {
    if (!m || busy) return;
    setBusy(true);
    try {
      const res = await api<{ mistake: Mistake; change: { from: string; to: string } }>(`/api/review/${m.id}/rate`, { method: "POST", body: { result: rating } });
      setResults((r) => [...r, { id: m.id, rating, mastered: res.change.to === "mastered" }]);
      void haptic.light();
      setIdx((i) => i + 1);
      setStage("think");
      setPicked(null);
      setHintHidden(false);
      if (idx + 1 >= total) void haptic.success();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const exit = () => nav("/today", { replace: true });

  if (error) {
    return (
      <div className="screen">
        <InlineNav title="今日复习" right={<button className="nav-btn" onClick={exit}>结束</button>} />
        <Empty icon="warning" title="加载失败" text={error} action={<Button size="sm" variant="tinted" onClick={() => window.location.reload()}>重试</Button>} />
      </div>
    );
  }
  if (!queue) return <Spinner text="准备今天的题目" />;

  if (total === 0 || finished) {
    const remembered = results.filter((r) => r.rating === "remembered").length;
    const mastered = results.filter((r) => r.mastered);
    return (
      <div className="screen">
        <InlineNav title="今日复习" right={<button className="nav-btn" onClick={exit}>完成</button>} />
        <div className="screen__content screen__content--modal" style={{ alignItems: "center", textAlign: "center", gap: 16, paddingTop: 48 }}>
          <span style={{ width: 96, height: 96, borderRadius: 48, background: "var(--mastered-bg)", color: "var(--mastered)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={52} stroke={2.6} />
          </span>
          <h1 className="t-title1">{total === 0 ? "今天没有要复习的题" : `今天 ${results.length} 题复习完成`}</h1>
          {total > 0 && (
            <p className="t-sub c-sec">记得 {remembered} 题 · 模糊 {results.filter((r) => r.rating === "fuzzy").length} 题 · 忘了 {results.filter((r) => r.rating === "forgot").length} 题{initialDone > 0 ? ` · 今天共复习 ${initialDone + results.length} 题` : ""}</p>
          )}
          {mastered.length > 0 && (
            <div className="card" style={{ width: "100%", textAlign: "left", gap: 8 }}>
              <span className="t-headline" style={{ color: "var(--mastered)" }}>升级为已掌握 · {mastered.length} 题</span>
              {mastered.map((r) => {
                const q = queue.find((x) => x.id === r.id);
                return q ? (
                  <button key={r.id} className="t-sub ellipsis" style={{ textAlign: "left", color: "var(--brand)" }} onClick={() => nav(`/mistake/${r.id}`)}>
                    {q.knowledgePoints[0]} · {q.stemText}
                  </button>
                ) : null;
              })}
            </div>
          )}
          <div style={{ marginTop: "auto", width: "100%" }}>
            <Button onClick={exit}>完成</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!m) return null;
  const reasonText = [m.reasons.map((r) => REASON_LABEL[r]).join("、"), m.note].filter(Boolean).join("：");
  const isChoice = m.questionType === "choice" && m.options.length > 0;
  const correctLetter = (m.correctAnswer ?? "").trim().toUpperCase().charAt(0);

  return (
    <div className="screen">
      <header className="nav nav--inline">
        <div className="nav__side"><button className="nav-btn" onClick={exit}>结束</button></div>
        <div className="nav__center" style={{ gap: 4, padding: "0 8px" }}>
          <span className="t-sub num" style={{ fontWeight: 600 }}>第 {idx + 1} 题，共 {total} 题</span>
          <div className="bar" style={{ width: "100%", height: 4 }}><span style={{ width: `${(idx / total) * 100}%`, background: "var(--brand)", transition: "width .3s" }} /></div>
        </div>
        <div className="nav__side" />
      </header>
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 8 }}>
        <div className="card" key={m.id} style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SubjectChip subject={m.subject} />
            <span className="t-sub" style={{ fontWeight: 600 }}>{m.knowledgePoints[0]}</span>
            <span className="t-foot c-sec" style={{ marginLeft: "auto" }}>第 {m.review.intervalIndex + 1} 次复习</span>
          </div>
          <p className="t-title3" style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{m.stemText}</p>
          {reasonText && !hintHidden && (
            <button style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--due-bg)", borderRadius: 10, padding: "8px 10px", textAlign: "left" }} onClick={() => setHintHidden(true)} aria-label="上次错因提示，点按隐藏">
              <Icon name="warning" size={18} stroke={2} style={{ color: "var(--due)", flexShrink: 0 }} />
              <span className="t-foot" style={{ color: "var(--due)", fontWeight: 500 }}>上次错在：{reasonText}</span>
            </button>
          )}
        </div>

        {isChoice && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {m.options.map((o, i) => {
              const L = String.fromCharCode(65 + i);
              const cls = stage === "reveal" ? (L === correctLetter ? " correct" : L === picked ? " wrong" : "") : "";
              return (
                <button key={i} className={`option${cls}`} onClick={() => choose(L)} disabled={stage === "reveal"} aria-pressed={picked === L}>
                  <span className="option__letter">{L}</span>
                  <span>{o}</span>
                </button>
              );
            })}
          </div>
        )}

        {stage === "reveal" && (
          <div className="card" style={{ border: "1.5px solid var(--brand)", gap: 8 }}>
            <span className="t-foot c-sec" style={{ fontWeight: 600 }}>正确答案</span>
            <p className="t-title2">{m.correctAnswer || "（暂无答案）"}</p>
            {m.studentAnswer && <p className="t-foot" style={{ color: "var(--wrong)" }}>当时写的：{m.studentAnswer}</p>}
            {m.analysis && <p className="t-sub" style={{ color: "var(--secondary)" }}>{m.analysis}</p>}
            <button className="t-sub" style={{ color: "var(--brand)", fontWeight: 500, textAlign: "left", minHeight: 32 }} onClick={() => nav(`/mistake/${m.id}`)}>查看完整解析</button>
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {stage === "think" && !isChoice && <Button onClick={() => setStage("reveal")}>我想好了，看答案</Button>}
          {stage === "think" && isChoice && <span className="t-foot c-sec" style={{ textAlign: "center" }}>先选一个答案</span>}
          {stage === "reveal" && (
            <>
              <span className="t-sub" style={{ fontWeight: 600, textAlign: "center" }}>{isChoice ? (picked === correctLetter ? "答对了，记得牢吗？" : "这次没对，诚实地评一下") : "刚才想起来了吗？"}</span>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="rate-btn" style={{ background: "var(--wrong-bg)", color: "var(--wrong)" }} onClick={() => rate("forgot")} disabled={busy}>忘了<span>{preview("forgot")}</span></button>
                <button className="rate-btn" style={{ background: "var(--due-bg)", color: "var(--due)" }} onClick={() => rate("fuzzy")} disabled={busy}>模糊<span>{preview("fuzzy")}</span></button>
                <button className="rate-btn" style={{ background: "var(--mastered-bg)", color: "var(--mastered)" }} onClick={() => rate("remembered")} disabled={busy}>记得<span>{preview("remembered")}</span></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
