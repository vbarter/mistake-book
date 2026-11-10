import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { PrintSheets } from "../../components/PrintPaper";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Tag } from "../../components/v2";
import type { FullPage, Paper } from "../../lib/folders";
import { haptic } from "../../lib/native";
import { STATUS_LABEL, dueLabel, fetchAssignment, isAssignmentScanning, isOverdue, isSubmissionPending, memberName, revokeAssignment, shareInvite, sizeLabel, submitHomework, usePlans, type AssignmentRes, type PlanFileView, type ResultRow } from "../../lib/plans";
import { assetUrl } from "../../api/client";
import { toast, toastError } from "../../store/banner";
import { useExports } from "../../store/exports";
import { Busy, ConfirmSheet, useScanPick } from "./shared";
import "../../styles/paper.css";

const fileUrl = (f: PlanFileView) => assetUrl(f.url) ?? "";
const openFile = (f: PlanFileView) => { if (f.url) window.open(fileUrl(f), "_blank"); else toast("文件还在上传，稍后再试"); };
const badge = (f: PlanFileView) => (f.mime === "application/pdf" ? "PDF" : f.mime.includes("word") ? "DOC" : "图片");

export function QuestionGrid({ results, onPick }: { results: ResultRow[]; onPick?: (i: number) => void }) {
  return (
    <div className="plan-grid">
      {results.map((r, i) => (
        <button key={i} className={`plan-q plan-q--${r.m}${r.o ? " plan-q--edited" : ""}`} disabled={!onPick} onClick={() => onPick?.(i)} aria-label={`第 ${r.n} 题`}>{r.n}</button>
      ))}
    </div>
  );
}

/**
 * 作业页。成员：作业内容 + 底部「导出」「扫描上传」，交了以后看自己的对 / 错 / 没做。
 * 创建人：谁交了、谁没交、谁没看，错得最多的题，提醒没交的同学。
 */
export default function Assignment() {
  const nav = useNavigate();
  const { assignmentId = "" } = useParams();
  const [data, setData] = useState<AssignmentRes | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"photo" | "text">("photo");
  const [pages, setPages] = useState<FullPage[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const version = usePlans((s) => s.version);
  const submitExport = useExports((s) => s.submit);

  const load = useCallback(() => fetchAssignment(assignmentId).then(setData).catch((e) => setError((e as Error).message || "打不开")), [assignmentId]);
  useEffect(() => { void load(); }, [load, version]);
  const scan = useScanPick((more) => setPages((cur) => [...cur, ...more]), "拍下做完的作业");

  const digitized = data?.assignment.digitized ?? null;
  // 电子版用现成的打印版排版；手边没有原照片，插图在「照片」里看
  const pseudo = useMemo<Paper | null>(() => (data && digitized ? { id: data.assignment.id, name: data.assignment.title, createdAt: "", updatedAt: "", pages: [], digitized } : null), [data, digitized]);

  if (error) return <div className="screen"><InlineNav title="作业" back /><Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>回到学习计划</Button>} /></div>;
  if (!data) return <div className="screen"><InlineNav title="作业" back /><Spinner /></div>;

  const { plan, assignment: a, board, submission: sub } = data;
  const owner = plan.role === "owner";
  const scans = a.files.filter((f) => f.kind === "scan");
  const attachments = a.files.filter((f) => f.kind === "attachment");
  const canSubmit = !owner && !a.revoked && (!sub || sub.status !== "reviewed");

  const hand = async () => {
    try {
      await submitHomework(a, pages, setStage);
      setPages([]);
      void haptic.success();
      toast("交上去了，批改好会显示在这里", "success");
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setStage(null);
    }
  };
  const exportPdf = async () => {
    if (!digitized) return;
    try {
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      setExporting(false);
      toast(job ? (job.status === "done" ? "已生成" : "正在后台生成，好了会提醒你；也可以在「我的 › 我的导出」里查看") : "服务器暂时不支持导出");
    } catch (e) {
      toastError(e);
    }
  };
  const forward = (remind = false) => shareInvite({ plan, title: a.title, invite: data.invite!, assignmentId: a.id, remind }).catch(toastError);

  const content = (
    <>
      <div className="card" style={{ gap: 6 }}>
        <span className="t-title3" style={{ fontWeight: 800 }}>{a.title}</span>
        <span className="t-foot c-sec">
          {plan.name}{owner ? "" : ` · ${plan.teacher}`}
          {a.dueAt ? ` · ${isOverdue(a.dueAt) ? "已截止 " : "截止 "}${dueLabel(a.dueAt)}` : ""}
          {a.questionCount ? ` · ${a.questionCount} 题` : ""}
        </span>
        {a.revoked && <Tag kind="neutral" style={{ alignSelf: "flex-start" }}>老师已撤回</Tag>}
      </div>
      {attachments.length > 0 && (
        <div className="group">
          <div className="group__header"><span>附件</span></div>
          {attachments.map((f) => (
            <button key={f.id} className="row" onClick={() => openFile(f)}>
              <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{badge(f)}</span>
              <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
              <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
            </button>
          ))}
        </div>
      )}
      {scans.length > 0 && (
        <>
          {pseudo ? <Segmented value={view} options={[{ value: "photo", label: "照片" }, { value: "text", label: "电子版" }]} onChange={setView} />
            : owner && isAssignmentScanning(a.id) ? <p className="t-foot c-sec" style={{ padding: "0 4px" }}><span className="spinner-ring" style={{ display: "inline-block", width: 12, height: 12, borderWidth: 2, verticalAlign: -1, marginRight: 6 }} />正在识别成电子版，同学现在已经可以看照片</p> : null}
          {view === "text" && pseudo
            ? <PrintSheets paper={pseudo} sheets={digitized!.pages} clean />
            : scans.map((f) => (f.url ? <img key={f.id} className="plan-photo" src={fileUrl(f)} alt={f.name} loading="lazy" onClick={() => openFile(f)} /> : <div key={f.id} className="plan-files__empty card">「{f.name}」还在上传</div>))}
        </>
      )}
    </>
  );

  return (
    <div className="screen">
      <InlineNav
        title={owner ? "作业情况" : "作业"}
        back
        onBack={() => nav(`/plans/${plan.id}`)}
        right={owner ? (
          <>
            {!a.revoked && <button className="plan-pill" onClick={() => forward()}><Icon name="export" size={15} stroke={2.2} />转发</button>}
            <button className="nav-btn" aria-label="更多" onClick={() => setMenu(true)}><Icon name="ellipsis" size={22} stroke={2.2} /></button>
          </>
        ) : undefined}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        {owner && board && (
          <>
            <div className="plan-stats plan-stats--3">
              <div className="stat"><span className="stat__label">已交</span><span className="stat__value num" style={{ color: "var(--mastered)" }}>{board.submitted.length}<span className="t-foot c-sec" style={{ fontWeight: 500 }}> /{board.members}</span></span></div>
              <div className="stat"><span className="stat__label">没交</span><span className="stat__value num" style={{ color: board.missing.length ? "var(--due)" : undefined }}>{board.missing.length}</span></div>
              <div className="stat"><span className="stat__label">还没看</span><span className="stat__value num">{board.unseen}</span></div>
            </div>
            {board.hardest.length > 0 && (
              <div className="group">
                <div className="group__header"><span>错得最多的题</span><span>已批改 {board.hardest[0].graded} 份</span></div>
                {board.hardest.map((h) => (
                  <div key={h.number} className="row" style={{ alignItems: "flex-start" }}>
                    <span className="plan-q plan-q--wrong" style={{ width: 40, flexShrink: 0 }}>{h.number}</span>
                    <span className="row__main"><span className="t-body clamp" style={{ WebkitLineClamp: 2 }}>{h.stem || "（没有识别出题干）"}</span>{h.knowledge && <span className="row__sub">{h.knowledge}</span>}</span>
                    <span className="t-headline" style={{ color: "var(--wrong)", whiteSpace: "nowrap" }}>{h.wrong} 人错</span>
                  </div>
                ))}
              </div>
            )}
            {board.missing.length > 0 && (
              <div className="group">
                <div className="group__header"><span>没交 {board.missing.length}</span></div>
                {board.missing.map((m) => (
                  <div key={m.userId} className="row">
                    <span className="plan-avatar" aria-hidden="true">{m.name.slice(-1)}</span>
                    <span className="row__main"><span className="row__title ellipsis">{memberName(m)}</span></span>
                    {m.returned ? <Tag kind="wrong">已退回重做</Tag> : m.viewed ? <Tag kind="neutral" icon="eye">看过</Tag> : <Tag kind="pending" icon="eye-off">没看</Tag>}
                  </div>
                ))}
              </div>
            )}
            <div className="group">
              <div className="group__header"><span>已交 {board.submitted.length}</span></div>
              {board.submitted.length === 0 && <div className="plan-files__empty">{board.members === 0 ? "还没有人加入。点右上角「转发」发到微信群。" : "还没有人交。"}</div>}
              {board.submitted.map((s) => (
                <button key={s.submissionId} className="row" onClick={() => nav(`/plans/s/${s.submissionId}`)}>
                  <span className="plan-avatar" aria-hidden="true">{s.name.slice(-1)}</span>
                  <span className="row__main">
                    <span className="row__title ellipsis">{memberName(s)}{s.left ? "（已退出）" : ""}</span>
                    <span className="row__sub">{s.score ? `对 ${s.score.correct} · 错 ${s.score.wrong} · 没做 ${s.score.blank}` : "批改中"}{s.late ? " · 迟交" : ""}</span>
                  </span>
                  {s.status === "reviewed" ? <Tag kind="correct">已阅</Tag> : <Tag kind="info" icon="pencil">待阅</Tag>}
                  <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                </button>
              ))}
            </div>
            <div className="plan-field__label" style={{ paddingTop: 4 }}><span>作业内容</span></div>
          </>
        )}

        {!owner && sub && (
          <div className="card" style={{ gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="t-headline" style={{ flex: 1 }}>我交的作业</span>
              {sub.late && <Tag kind="neutral">迟交</Tag>}
              <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"}>{STATUS_LABEL[sub.status]}</Tag>
            </div>
            {sub.comment && <p className="t-sub" style={{ color: sub.status === "returned" ? "var(--wrong)" : undefined }}>老师：{sub.comment}</p>}
            {sub.results && sub.score ? (
              <>
                <div className="plan-stats plan-stats--3">
                  <div className="stat" style={{ background: "var(--mastered-bg)" }}><span className="stat__label">对</span><span className="stat__value num" style={{ color: "var(--mastered)" }}>{sub.score.correct}</span></div>
                  <div className="stat" style={{ background: "var(--wrong-bg)" }}><span className="stat__label">错</span><span className="stat__value num" style={{ color: "var(--wrong)" }}>{sub.score.wrong}</span></div>
                  <div className="stat" style={{ background: "var(--fill-light)" }}><span className="stat__label">没做</span><span className="stat__value num">{sub.score.blank}</span></div>
                </div>
                <QuestionGrid results={sub.results} />
                <span className="t-cap c-sec">错题已经自动进了你的错题榜，交的这份也存在「试卷」里。</span>
              </>
            ) : (
              <span className="t-sub c-sec">{isSubmissionPending(sub.id) ? "正在批改，好了会显示在这里。可以先离开。" : "已经交给老师了。批改结果在「试卷」里这份作业上，打开它会自动补交给老师。"}</span>
            )}
          </div>
        )}

        {content}

        {canSubmit && pages.length > 0 && (
          <div className="card" style={{ gap: 10 }}>
            <span className="t-headline">准备交 {pages.length} 页</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pages.map((p) => (
                <span key={p.id} style={{ position: "relative" }}>
                  <img className="thumb" src={p.thumb ?? p.src} alt="" />
                  <button aria-label="去掉这一页" onClick={() => setPages((cur) => cur.filter((x) => x.id !== p.id))} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, background: "var(--label)", color: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="xmark" size={11} stroke={3} /></button>
                </span>
              ))}
            </div>
          </div>
        )}

        {owner && !a.revoked && board && board.missing.length > 0 && (
          <div className="bottom-bar" style={{ marginTop: "auto" }}>
            <Button icon="bell" onClick={() => forward(true)}>提醒没交的同学</Button>
          </div>
        )}
        {!owner && (
          <div className="bottom-bar" style={{ marginTop: "auto" }}>
            {pages.length > 0 ? (
              <>
                <Button variant="outline" icon="camera" onClick={scan.open} style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}>再拍一页</Button>
                <Button icon="check" onClick={hand} disabled={Boolean(stage)}>交给老师</Button>
              </>
            ) : (
              <>
                <Button variant="outline" icon="printer" onClick={() => setExporting(true)}>导出</Button>
                {canSubmit && <Button icon="camera" onClick={scan.open}>{sub ? "重新扫描上传" : "扫描上传"}</Button>}
              </>
            )}
          </div>
        )}
      </div>

      <Sheet open={exporting} onClose={() => setExporting(false)} title="导出作业">
        <div className="group" style={{ background: "var(--fill-light)" }}>
          {digitized && (
            <button className="row" onClick={exportPdf}>
              <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="printer" size={18} stroke={2} /></span>
              <span className="row__main"><span className="row__title">电子版 PDF</span><span className="row__sub">排好版的原题，方便打印</span></span>
            </button>
          )}
          {a.files.map((f) => (
            <button key={f.id} className="row" onClick={() => openFile(f)}>
              <span className="row__icon" style={{ background: "var(--secondary)" }}><Icon name={f.mime.startsWith("image/") ? "photo" : "document"} size={18} stroke={2} /></span>
              <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">原件 · {sizeLabel(f.size)}</span></span>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)} title={a.title}>
        <div className="group" style={{ background: "var(--fill-light)" }}>
          <button className="row" style={{ color: "var(--wrong)" }} onClick={() => { setMenu(false); setRevoking(true); }}><span className="row__main"><span className="row__title">撤回这份作业</span><span className="row__sub">没交的同学不会再看到；交过的同学还能看到自己那份</span></span></button>
        </div>
      </Sheet>
      <ConfirmSheet open={revoking} danger title="撤回这份作业？" action="撤回" onClose={() => setRevoking(false)}
        onConfirm={async () => { try { await revokeAssignment(a.id); usePlans.getState().bump(); toast("已撤回", "success"); nav(`/plans/${plan.id}`, { replace: true }); } catch (e) { toastError(e); } }} />
      {scan.sheet}
      {stage && <Busy text={stage} />}
    </div>
  );
}
