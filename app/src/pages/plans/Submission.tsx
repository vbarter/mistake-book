import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { assetUrl } from "../../api/client";
import type { Mark } from "../../api/types";
import { Icon } from "../../components/Icon";
import { MathText } from "../../components/MathText";
import { Button, Empty, InlineNav, Sheet, Spinner } from "../../components/ui";
import { Tag } from "../../components/v2";
import { formatDateTime } from "../../lib/format";
import { AI_GRADING, MARK_REVIEWED, RETURN_REDO, fetchSubmission, fileBadge, memberName, reviewSubmission, sizeLabel, usePlans, type PlanFileView, type SubmissionRes } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { QuestionGrid, openFile } from "./Assignment";
import { ScoreStats } from "./shared";
import "../../styles/plans.css";

const MARK_OPTIONS: { value: Mark; label: string }[] = [{ value: "correct", label: "对" }, { value: "wrong", label: "错" }, { value: "partial", label: "半对" }, { value: "blank", label: "没做" }];

/** 文件名一排里显示的名字：去掉扩展名；没有名字的按「第 n 张」 */
const fileLabel = (f: PlanFileView, i: number) => f.name.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || `第 ${i + 1} 张`;

/**
 * 创建人看一个学生交的作业：先是作业名，下面是交上来的文件，文件名排成一排，左右滑着换，点一下打开。
 * 「已阅」和「退回重做」两个开关都关着时这一页只是看，没有留言框和底部按钮；开了批改还有逐题结果（点题号可以改判）。
 * 交的人不止一个时右上有上一位 / 下一位。
 */
export default function Submission() {
  const nav = useNavigate();
  const { submissionId = "" } = useParams();
  const [data, setData] = useState<SubmissionRes | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setData(null);
    setCur(0);
    return fetchSubmission(submissionId).then((r) => { setData(r); setComment(r.submission.comment); }).catch((e) => setError((e as Error).message || "打不开"));
  }, [submissionId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="screen"><InlineNav title="批阅" back /><Empty icon="warning" title={error} /></div>;
  if (!data) return <div className="screen"><InlineNav title="批阅" back /><Spinner /></div>;

  const { submission: sub, student, nav: pager, assignment, plan } = data;
  const owner = plan.role === "owner";
  const results = AI_GRADING ? sub.results ?? null : null; // 批改关着：只看文件
  const bar = owner && (MARK_REVIEWED || RETURN_REDO); // 两个开关都关着：没有可做的动作，留言框和底部按钮都不出
  const files = sub.files.filter((f) => f.url);
  const at = Math.min(cur, Math.max(0, files.length - 1));
  const goTo = (i: number) => { const el = track.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };
  const onScroll = () => { const el = track.current; if (el && el.clientWidth) setCur(Math.round(el.scrollLeft / el.clientWidth)); };
  const q = picked !== null && results ? results[picked] : null;
  const back = () => (owner ? nav(`/plans/${plan.id}`) : assignment ? nav(`/plans/a/${assignment.id}`) : nav(-1));

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
    if (status === "returned" && !comment.trim()) return toast("先写一句哪里要重做");
    setBusy(true);
    try {
      await reviewSubmission(sub.id, { status, comment: comment.trim() });
      usePlans.getState().bump();
      toast(status === "reviewed" ? "已阅" : "已退回", "success");
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
        subtitle={pager && pager.total > 1 ? `第 ${pager.index}/${pager.total} 位` : undefined}
        back
        onBack={back}
        right={pager && pager.total > 1 ? (
          <>
            <button className="nav-btn" aria-label="上一位" disabled={!pager.prev} style={{ opacity: pager.prev ? 1 : 0.3 }} onClick={() => pager.prev && nav(`/plans/s/${pager.prev}`, { replace: true })}><Icon name="chevron-up" size={22} stroke={2.2} /></button>
            <button className="nav-btn" aria-label="下一位" disabled={!pager.next} style={{ opacity: pager.next ? 1 : 0.3 }} onClick={() => pager.next && nav(`/plans/s/${pager.next}`, { replace: true })}><Icon name="chevron-down" size={22} stroke={2.2} /></button>
          </>
        ) : undefined}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        {/* 先看到作业名，下面是交上来的文件：文件名一排，左右滑着换 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 4px" }}>
          <span className="t-headline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignment?.title ?? "作业"}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="t-foot c-sec">{formatDateTime(sub.submittedAt)} 交</span>
            {sub.late && <Tag kind="neutral">迟交</Tag>}
            {(MARK_REVIEWED || (RETURN_REDO && sub.status === "returned")) && <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"}>{sub.status === "reviewed" ? "已阅" : sub.status === "returned" ? "已退回" : "待阅"}</Tag>}
          </div>
        </div>

        {AI_GRADING && (
          <div className="card" style={{ gap: 12 }}>
            {results && sub.score ? (
              <>
                <ScoreStats score={sub.score} />
                <QuestionGrid results={results} onPick={setPicked} />
                {owner && <span className="t-cap c-sec" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="pencil" size={13} stroke={2.4} />点题号可改判</span>}
              </>
            ) : (
              <span className="t-sub c-sec">正在批改…</span>
            )}
          </div>
        )}

        {files.length === 0 ? (
          <Empty icon="clock" title="文件还在上传，稍后再来看" />
        ) : (
          <>
            <div className="plan-swipe__names">
              {files.map((f, i) => (
                <button key={f.id} ref={(el) => { if (el && i === at) el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }} className={`chip chip--filter${i === at ? " on" : ""}`} onClick={() => goTo(i)}>{fileLabel(f, i)}</button>
              ))}
            </div>
            <div className="plan-swipe">
              <div className="plan-swipe__track" ref={track} onScroll={onScroll}>
                {files.map((f) => (
                  <div key={f.id} className="plan-swipe__page" onClick={() => void openFile(f)}>
                    {f.mime.startsWith("image/") ? (
                      <img className="plan-swipe__img" src={assetUrl(f.url)} alt={f.name} loading="lazy" />
                    ) : (
                      <div className="plan-swipe__doc">
                        <span className="plan-file__icon">{fileBadge(f.mime)}</span>
                        <span className="t-body">{f.name}</span>
                        <span className="t-foot c-sec">{sizeLabel(f.size)} · 点一下打开</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {files.length > 1 && <span className="plan-swipe__count">{at + 1}/{files.length}</span>}
            </div>
          </>
        )}

        {bar && (
          <>
            <input className="input input--card" aria-label="给同学留句话" value={comment} maxLength={200} placeholder={RETURN_REDO ? "给同学留句话（退回时必填）" : "给同学留句话"} onChange={(e) => setComment(e.target.value)} />
            <div className="bottom-bar" style={{ marginTop: "auto" }}>
              {RETURN_REDO && <Button variant="outline" icon="refresh" onClick={() => finish("returned")} disabled={busy} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>退回</Button>}
              {MARK_REVIEWED && <Button icon="check" onClick={() => finish("reviewed")} disabled={busy}>{pager?.next ? "已阅，下一份" : "已阅"}</Button>}
            </div>
          </>
        )}
      </div>

      <Sheet open={Boolean(q)} onClose={() => setPicked(null)} title={q ? `第 ${q.n} 题` : ""}>
        {q && (
          <>
            {q.t && <div className="t-body"><MathText text={q.t} /></div>}
            <div className="group" style={{ background: "var(--fill-light)" }}>
              <div className="row"><span className="row__main"><span className="row__sub">作答</span><span className="t-body">{q.s ? <MathText text={q.s} /> : "（没写）"}</span></span></div>
              <div className="row"><span className="row__main"><span className="row__sub">答案</span><span className="t-body">{q.a ? <MathText text={q.a} /> : "（没识别出）"}</span></span></div>
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
