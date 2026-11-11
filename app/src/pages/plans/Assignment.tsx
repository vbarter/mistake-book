import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { PrintSheets } from "../../components/PrintPaper";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Tag } from "../../components/v2";
import type { FullPage, Paper } from "../../lib/folders";
import { haptic, openRemoteFile } from "../../lib/native";
import { STATUS_LABEL, dueLabel, fetchAssignment, fileBadge, isAssignmentScanning, isOverdue, isSubmissionPending, planGone, sizeLabel, submitHomework, usePlans, type AssignmentRes, type PlanFileView, type ResultRow } from "../../lib/plans";
import { assetUrl } from "../../api/client";
import { toast, toastError } from "../../store/banner";
import { useExports } from "../../store/exports";
import { Busy, Count, PlanCreator, ScoreStats, useScanPick } from "./shared";
import "../../styles/paper.css";

const fileUrl = (f: PlanFileView) => assetUrl(f.url) ?? "";
/** 打开附件 / 扫描件：原生端用系统预览（能返回），见 openRemoteFile */
let opening = false;
export const openFile = async (f: { id: string; name: string; url: string | null }) => {
  if (!f.url) return toast("文件还在上传，稍后再试");
  if (opening) return;
  opening = true;
  const slow = setTimeout(() => toast("正在打开…"), 600); // 大文件要先下载，给个反应
  try {
    await openRemoteFile(assetUrl(f.url) ?? "", f.name, f.id);
  } catch (e) {
    toastError(e);
  } finally {
    clearTimeout(slow);
    opening = false;
  }
};

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
 * 作业页（成员用）：作业内容 + 底部「导出」「扫描上传」，交了以后看自己的对 / 错 / 没做。
 * 创建人不进这一页，直接回学习计划页（文件、谁交了谁没交都在那边）。
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
  const version = usePlans((s) => s.version);
  const submitExport = useExports((s) => s.submit);

  // 已经显示出来了就不换成报错页：刷新失败不该盖掉已有的内容
  const loaded = useRef(false);
  const load = useCallback(() => fetchAssignment(assignmentId).then((r) => { loaded.current = true; setData(r); setError(""); }).catch((e) => {
    // 但计划被解散 / 自己被移出了，就不能再留着旧内容
    if (loaded.current && !planGone(e)) return;
    setError((e as Error).message || "打不开");
    if (loaded.current) {
      loaded.current = false;
      setData(null);
      usePlans.getState().bump();
    }
  }), [assignmentId]);
  useEffect(() => { void load(); }, [load, version]);
  const scan = useScanPick((more) => setPages((cur) => [...cur, ...more]), "拍下做完的作业");

  const digitized = data?.assignment.digitized ?? null;
  // 电子版用现成的打印版排版；手边没有原照片，插图在「照片」里看
  const pseudo = useMemo<Paper | null>(() => (data && digitized ? { id: data.assignment.id, name: data.assignment.title, createdAt: "", updatedAt: "", pages: [], digitized } : null), [data, digitized]);

  if (error) return <div className="screen"><InlineNav title="作业" back /><Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>回到学习计划</Button>} /></div>;
  if (!data) return <div className="screen"><InlineNav title="作业" back /><Spinner /></div>;

  const { plan, assignment: a, submission: sub } = data;
  const owner = plan.role === "owner";
  // 创建人没有单独的作业页了：文件、谁交了谁没交都在学习计划页
  if (owner) return <Navigate to={`/plans/${plan.id}`} replace />;
  const scans = a.files.filter((f) => f.kind === "scan");
  const attachments = a.files.filter((f) => f.kind === "attachment");
  const canSubmit = !owner && !a.revoked && (!sub || sub.status !== "reviewed");

  const hand = async () => {
    try {
      await submitHomework(a, pages, setStage);
      setPages([]);
      void haptic.success();
      toast("交上去了", "success");
      await load();
    } catch (e) {
      toastError(e);
      if (planGone(e)) void load();
    } finally {
      setStage(null);
    }
  };
  const exportPdf = async () => {
    if (!digitized) return;
    try {
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      setExporting(false);
      toast(job ? (job.status === "done" ? "已生成" : "正在生成，好了会提醒你") : "服务器暂时不支持导出");
    } catch (e) {
      toastError(e);
    }
  };

  const content = (
    <>
      {/* 成员：先看到是谁的哪个学习计划，点一下去看这个计划的全部作业 */}
      {!owner && <PlanCreator plan={plan} more="全部作业" onClick={() => nav(`/plans/${plan.id}`)} />}
      <div className="card" style={{ gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* 成员这边作业名最多两行，长名字不截成一行 */}
          <span className={`t-title3 ${owner ? "ellipsis" : "clamp2"}`} style={{ fontWeight: 800, flex: 1 }}>{a.title}</span>
          {a.revoked && <Tag kind="neutral">已撤回</Tag>}
        </div>
        <div className="plan-counts" style={owner || a.dueAt || a.questionCount ? undefined : { display: "none" }}>
          {owner && <span className="t-foot c-sec ellipsis">{plan.name}</span>}
          {a.dueAt && <Count icon="clock" color={isOverdue(a.dueAt) ? "var(--wrong)" : undefined}>{dueLabel(a.dueAt)}</Count>}
          {a.questionCount ? <Count icon="list">{a.questionCount} 题</Count> : null}
        </div>
      </div>
      {attachments.length > 0 && (
        <div className="group">
          <div className="group__header"><span>附件</span></div>
          {attachments.map((f) => (
            <button key={f.id} className="row" onClick={() => openFile(f)}>
              <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
              <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
              <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
            </button>
          ))}
        </div>
      )}
      {scans.length > 0 && (
        <>
          {pseudo ? <Segmented value={view} options={[{ value: "photo", label: "照片" }, { value: "text", label: "电子版" }]} onChange={setView} />
            : owner && isAssignmentScanning(a.id) ? <p className="t-foot c-sec" style={{ padding: "0 4px" }}><span className="spinner-ring" style={{ display: "inline-block", width: 12, height: 12, borderWidth: 2, verticalAlign: -1, marginRight: 6 }} />正在识别电子版…</p> : null}
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
        title="作业"
        back
        onBack={() => nav(`/plans/${plan.id}`)}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
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
                <ScoreStats score={sub.score} />
                <QuestionGrid results={sub.results} />
                {sub.score.wrong > 0 && <span className="t-cap c-sec">错题已进错题榜</span>}
              </>
            ) : (
              <span className="t-sub c-sec">{isSubmissionPending(sub.id) ? "正在批改…" : "已交，批改结果在「试卷」里"}</span>
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
                {canSubmit && <Button icon="camera" onClick={scan.open}>{sub ? "重新扫描" : "扫描上传"}</Button>}
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
              <span className="row__main"><span className="row__title">电子版 PDF</span></span>
            </button>
          )}
          {a.files.map((f) => (
            <button key={f.id} className="row" onClick={() => openFile(f)}>
              <span className="row__icon" style={{ background: "var(--secondary)" }}><Icon name={f.mime.startsWith("image/") ? "photo" : "document"} size={18} stroke={2} /></span>
              <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
            </button>
          ))}
        </div>
      </Sheet>
      {scan.sheet}
      {stage && <Busy text={stage} />}
    </div>
  );
}
