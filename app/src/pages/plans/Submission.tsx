import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { assetUrl } from "../../api/client";
import type { Mark } from "../../api/types";
import { Icon } from "../../components/Icon";
import { MathText } from "../../components/MathText";
import { Button, Empty, InlineNav, Sheet, Spinner } from "../../components/ui";
import { Tag } from "../../components/v2";
import { formatDateTime } from "../../lib/format";
import { fetchSubmission, memberName, reviewSubmission, usePlans, type SubmissionRes } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { QuestionGrid } from "./Assignment";
import "../../styles/plans.css";

const MARK_OPTIONS: { value: Mark; label: string }[] = [{ value: "correct", label: "对" }, { value: "wrong", label: "错" }, { value: "partial", label: "半对" }, { value: "blank", label: "没做" }];

/** 创建人检查一个学生交的作业：原照片、逐题结果（点题号可以改判）、写一句话，已阅或退回重做。带上一个 / 下一个，连着批不用来回进出。 */
export default function Submission() {
  const nav = useNavigate();
  const { submissionId = "" } = useParams();
  const [data, setData] = useState<SubmissionRes | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData(null);
    return fetchSubmission(submissionId).then((r) => { setData(r); setComment(r.submission.comment); }).catch((e) => setError((e as Error).message || "打不开"));
  }, [submissionId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="screen"><InlineNav title="批阅" back /><Empty icon="warning" title={error} /></div>;
  if (!data) return <div className="screen"><InlineNav title="批阅" back /><Spinner /></div>;

  const { submission: sub, student, nav: pager, assignment, plan } = data;
  const owner = plan.role === "owner";
  const results = sub.results ?? null;
  const q = picked !== null && results ? results[picked] : null;
  const back = () => (assignment ? nav(`/plans/a/${assignment.id}`) : nav(-1));

  const remark = async (mark: Mark) => {
    if (picked === null) return;
    try {
      const res = await reviewSubmission(sub.id, { marks: { [picked]: mark } });
      setData({ ...data, submission: res.submission });
      setPicked(null);
    } catch (e) {
      toastError(e);
    }
  };
  const finish = async (status: "reviewed" | "returned") => {
    if (status === "returned" && !comment.trim()) return toast("写一句话告诉同学哪里要重做");
    setBusy(true);
    try {
      await reviewSubmission(sub.id, { status, comment: comment.trim() });
      usePlans.getState().bump();
      toast(status === "reviewed" ? "已阅" : "已退回，同学那边会显示「退回重做」", "success");
      if (status === "reviewed" && pager?.next) nav(`/plans/s/${pager.next}`, { replace: true });
      else back();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav
        title={student ? memberName(student) : "我交的作业"}
        subtitle={[assignment?.title, pager ? `${pager.index}/${pager.total}` : ""].filter(Boolean).join(" · ")}
        back
        onBack={back}
        right={pager ? (
          <>
            <button className="nav-btn" aria-label="上一个" disabled={!pager.prev} style={{ opacity: pager.prev ? 1 : 0.3 }} onClick={() => pager.prev && nav(`/plans/s/${pager.prev}`, { replace: true })}><Icon name="chevron-up" size={22} stroke={2.2} /></button>
            <button className="nav-btn" aria-label="下一个" disabled={!pager.next} style={{ opacity: pager.next ? 1 : 0.3 }} onClick={() => pager.next && nav(`/plans/s/${pager.next}`, { replace: true })}><Icon name="chevron-down" size={22} stroke={2.2} /></button>
          </>
        ) : undefined}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        <div className="card" style={{ gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="t-foot c-sec" style={{ flex: 1 }}>{formatDateTime(sub.submittedAt)} 交</span>
            {sub.late && <Tag kind="neutral">迟交</Tag>}
            <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"}>{sub.status === "reviewed" ? "已阅" : sub.status === "returned" ? "已退回" : "待阅"}</Tag>
          </div>
          {results && sub.score ? (
            <>
              <div className="plan-stats plan-stats--3">
                <div className="stat" style={{ background: "var(--mastered-bg)" }}><span className="stat__label">对</span><span className="stat__value num" style={{ color: "var(--mastered)" }}>{sub.score.correct}</span></div>
                <div className="stat" style={{ background: "var(--wrong-bg)" }}><span className="stat__label">错</span><span className="stat__value num" style={{ color: "var(--wrong)" }}>{sub.score.wrong}</span></div>
                <div className="stat" style={{ background: "var(--fill-light)" }}><span className="stat__label">没做</span><span className="stat__value num">{sub.score.blank}</span></div>
              </div>
              <QuestionGrid results={results} onPick={setPicked} />
              {owner && <span className="t-cap c-sec">点题号看作答，判得不对可以改。右上角有小点的是你改过的。</span>}
            </>
          ) : (
            <span className="t-sub c-sec">这份还在自动批改，先看下面的照片。批改好了再进来就有逐题结果。</span>
          )}
        </div>

        {sub.files.map((f) => (f.url ? <img key={f.id} className="plan-photo" src={assetUrl(f.url)} alt={f.name} loading="lazy" onClick={() => window.open(assetUrl(f.url), "_blank")} /> : null))}

        {owner && (
          <>
            <label className="plan-field">
              <span className="plan-field__label">给同学的一句话（退回重做时必填）</span>
              <input className="input input--card" value={comment} maxLength={200} placeholder="例如：第 3 题再想想" onChange={(e) => setComment(e.target.value)} />
            </label>
            <div className="bottom-bar" style={{ marginTop: "auto" }}>
              <Button variant="outline" onClick={() => finish("returned")} disabled={busy} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>退回重做</Button>
              <Button icon="check" onClick={() => finish("reviewed")} disabled={busy}>{pager?.next ? "已阅，下一个" : "已阅"}</Button>
            </div>
          </>
        )}
      </div>

      <Sheet open={Boolean(q)} onClose={() => setPicked(null)} title={q ? `第 ${q.n} 题` : ""}>
        {q && (
          <>
            {q.t && <div className="t-body"><MathText text={q.t} /></div>}
            <div className="group" style={{ background: "var(--fill-light)" }}>
              <div className="row"><span className="row__main"><span className="row__sub">同学的作答</span><span className="t-body">{q.s ? <MathText text={q.s} /> : "（没写）"}</span></span></div>
              <div className="row"><span className="row__main"><span className="row__sub">正确答案</span><span className="t-body">{q.a ? <MathText text={q.a} /> : "（没有识别出答案）"}</span></span></div>
            </div>
            {owner && (
              <div className="plan-marks">
                {MARK_OPTIONS.map((o) => (
                  <button key={o.value} className={`chip chip--select${q.m === o.value ? " on" : ""}`} onClick={() => remark(o.value)}>{o.label}</button>
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
