import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DigitizedBlank, DigitizedBlock, DigitizedPage, Mark } from "../../api/types";
import { ErrorCard } from "../../components/ErrorCard";
import { MathText, mathNodes } from "../../components/MathText";
import { ExportSheet } from "../../components/ExportSheet";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../../components/ui";
import { ErrorFilterTags, Hint, IconSegmented, Tag, applyErrorFilter, subjectColors, type ErrorFilter } from "../../components/v2";
import { formatDateTime, unwrapLines } from "../../lib/format";
import { groupBySection, paperErrors } from "../../lib/errors";
import { autoMark, deletePaper, getFolder, isUnreadable, paperQuality, paperStats, updatePaper, validDigitized, type Folder, type Paper as PaperRecord } from "../../lib/folders";
import { gradeIfNeeded, isGrading, scanStageText, useJobs } from "../../lib/jobs";
import { useCapture } from "../../store/capture";
import "../../styles/paper.css";

type Tab = "paper" | "answers" | "errors";

const MARK_LABEL: Record<Mark, string> = { correct: "正确", wrong: "错误", partial: "半对", blank: "未作答", unmarked: "未批改" };
const BLANK_RE = /\[\[([^[\]]{1,24})\]\]/g;
const UNANSWERED = "未作答";
const isProblemMark = (m: Mark, student: string) => m === "blank" || (m === "wrong" && unanswered(student));
const unanswered = (s: string) => !s.trim();
const stripParen = (s: string) => s.replace(/^[（(]|[）)]$/g, "");

/** 打印版：把 [[id]] 占位换成只带空号的空格，不带任何手写内容 */
function renderPrint(text: string, blanks: DigitizedBlank[]): ReactNode[] {
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={`t${i}`}>{mathNodes(text.slice(last, start), `t${i++}`)}</Fragment>);
    const id = m[1];
    const num = byId.get(id)?.number || id.split("-")[0];
    out.push(
      <span className="blank blank--print" key={`b${i++}`}>
        <span className="blank__num">{num}</span>
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${i}`}>{mathNodes(text.slice(last), `t${i++}`)}</Fragment>);
  return out;
}

/** 作答表格的判定列：对 ✅、错 ❌（老师批的和 AI 判的一样显示） */
function MarkChip({ mark, student, grading }: { mark: Mark; student: string; grading?: boolean }) {
  if (mark === "unmarked" && grading && student.trim() && !isUnreadable(student)) return <Tag kind="info" icon="sparkles">批改中</Tag>;
  if (mark === "blank" || (mark === "wrong" && unanswered(student))) return <Tag kind="pending" icon="alert">{UNANSWERED}</Tag>;
  // 学生作答整个看不清、老师也没批：判不了，提示重拍而不是「未批改」
  if (mark === "unmarked" && isUnreadable(student)) return <Tag kind="pending" icon="alert">看不清</Tag>;
  if (mark === "correct") return <span className="verdict" role="img" aria-label="对">✅</span>;
  if (mark === "wrong") return <span className="verdict" role="img" aria-label="错">❌</span>;
  return <Tag kind={mark === "partial" ? "partial" : "neutral"} icon={mark === "unmarked" ? "info" : undefined}>{MARK_LABEL[mark]}</Tag>;
}

/** 一张试卷的电子版：「试卷」是可打印的干净原题，「作答」逐空列出手写转写与批改，「错题」按试卷顺序列出（按大题分组、卡片上标知识点）。 */
export default function Paper() {
  const nav = useNavigate();
  const { folderId = "", paperId = "" } = useParams();
  const { reset, setReturnTo } = useCapture();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("paper");
  const [menu, setMenu] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState<ErrorFilter>("all");

  const jobsVersion = useJobs((s) => s.version);
  const reload = useCallback(() => getFolder(folderId).then((f) => setFolder(f ?? null)), [folderId]);
  useEffect(() => {
    void reload();
  }, [reload, jobsVersion]);

  const paper: PaperRecord | undefined = folder?.papers.find((p) => p.id === paperId);
  const digitized = paper ? validDigitized(paper.digitized) : null;
  const grading = paper ? isGrading(paper.id) : false;
  useEffect(() => {
    if (folder && paper) void gradeIfNeeded(folder.id, paper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper?.id, Boolean(folder)]);
  const errors = useMemo(() => (folder && paper ? paperErrors(folder, paper) : []), [folder, paper]);
  const shown = useMemo(() => applyErrorFilter(errors, filter), [errors, filter]);
  const groups = useMemo(() => groupBySection(shown), [shown]);
  const stats = paper ? paperStats(paper) : null;
  const quality = paper ? paperQuality(paper) : null;

  // 没扫描过（也不在还原中）的试卷直接进录入页继续
  useEffect(() => {
    if (folder && paper && !digitized && !paper.scanJob) {
      reset();
      setReturnTo(`/papers/${folderId}`);
      nav("/capture", { replace: true, state: { folderId, paperId } });
    }
  }, [folder, paper, digitized, folderId, paperId, nav, reset, setReturnTo]);

  if (folder === undefined) return null;
  if (!folder || !paper || !stats) return <Empty icon="document" title="试卷不存在" action={<Button size="sm" variant="tinted" onClick={() => nav("/papers")}>回到试卷</Button>} />;
  if (!digitized && paper.scanJob) {
    return (
      <div className="screen">
        <InlineNav title="" back backLabel={folder.name} />
        <div className="screen__content screen__content--modal" style={{ justifyContent: "center", alignItems: "center", gap: 14, textAlign: "center" }}>
          <Icon name="sparkles" size={44} style={{ color: "var(--brand)" }} />
          <h2 className="t-title3">正在扫描「{paper.name}」</h2>
          <span className="progress" style={{ maxWidth: 260, background: "var(--brand-tint)" }}><span style={{ width: `${Math.max(6, paper.scanJob.progress)}%` }} /></span>
          <p className="t-sub c-sec">{scanStageText(paper.scanJob)} · 在服务器上进行，切走 App 也不影响，好了会自动显示</p>
          <Button variant="tinted" onClick={() => nav(`/papers/${folderId}`)} style={{ height: 44 }}>先回文件夹</Button>
        </div>
      </div>
    );
  }
  if (!digitized) return null;

  const sheets: DigitizedPage[] = digitized.pages;
  const subject = digitized.questions[0]?.subject;
  const colors = subjectColors(subject);

  const rescan = () => {
    setMenu(false);
    reset();
    setReturnTo(`/papers/${folderId}/${paperId}`);
    nav("/capture", { state: { folderId, paperId } });
  };

  // ---------------------------------------------------------------- 试卷（打印版）
  const renderPrintBlock = (block: DigitizedBlock, bi: number) => {
    switch (block.type) {
      case "section":
        return (
          <div className="blk-section" key={bi}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="sec-bar" style={{ background: colors.color }} />
              <span className="blk-section__title" style={{ flex: 1 }}>
                {block.label && `${block.label}. `}
                {block.title}
              </span>
              {block.points && <span className="t-cap c-sec">{stripParen(block.points)}</span>}
            </div>
            {block.instruction && <div className="blk-section__instruction" style={{ marginLeft: 12 }}>{block.instruction}</div>}
          </div>
        );
      case "wordbank":
        return (
          <div className="blk-wordbank" key={bi}>
            {block.options.map((o, i) => (
              <span key={i}><MathText text={o} /></span>
            ))}
          </div>
        );
      case "text":
        return (
          <p className="blk-plain" key={bi}>
            <MathText text={block.text} />
          </p>
        );
      case "passage":
        return (
          <div className="blk-passage" key={bi}>
            {block.label && <span className="blk-passage__label">{block.label}</span>}
            <p className="blk-text">{renderPrint(unwrapLines(block.text), block.blanks)}</p>
          </div>
        );
      case "item":
        return (
          <div className="blk-item" key={bi}>
            <span className="blk-item__num">{block.number}.</span>
            <div className="blk-item__body">
              <p className="blk-text">
                {renderPrint(unwrapLines(block.text), block.blanks)}
                {block.hint && <span className="blk-hint"><MathText text={block.hint} /></span>}
                {block.instruction && <span className="blk-instruction">（{stripParen(block.instruction)}）</span>}
              </p>
              {block.options.length > 0 && (
                <div className="blk-options">
                  {block.options.map((o, i) => (
                    <span key={i}><MathText text={/^[A-H][.、．]/.test(o) ? o : `${String.fromCharCode(65 + i)}. ${o}`} /></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const paperTab = (
    <>
      <Hint icon="printer">打印版只有原题，空格留白。手写和批改在「作答」里。</Hint>
      {sheets.map((sheet, si) => (
        <div className="paper" key={si}>
          <div className="paper__head">
            {sheet.title && <div className="paper__title">{sheet.title}</div>}
            <div className="paper__meta">
              {sheet.label && <span>{sheet.label}</span>}
              {[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).length > 0 && <span>{[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ")}</span>}
              {sheet.score && <span className="paper__score">{sheet.score}</span>}
            </div>
          </div>
          {sheet.blocks.map(renderPrintBlock)}
          {sheet.note && <p className="paper__note">{sheet.note}</p>}
        </div>
      ))}
      {showOriginal && paper.pages.map((p, i) => <img key={p.id} src={p.src} alt={`原图 ${i + 1}`} style={{ width: "100%", borderRadius: 12, border: "1px solid var(--separator-light)" }} />)}
    </>
  );

  // ---------------------------------------------------------------- 作答
  const answersTab = (
    <>
      <Hint icon="pencil">学生手写内容的转写，与老师批改、正确答案逐空对照。空题按未作答计入错题。</Hint>
      {sheets.map((sheet, si) => {
        const rows = sheet.blocks.flatMap((b, bi) => (b.type === "passage" || b.type === "item" ? b.blanks.map((x) => {
          const mark = autoMark(x.mark, x.student, x.answer, b.questionType);
          return { ...x, rowKey: `${bi}:${x.id}`, mark, ai: Boolean(x.aiGraded) || (x.mark === "unmarked" && mark !== "unmarked") };
        }) : []));
        if (rows.length === 0) return null;
        return (
          <div className="card ans" key={si} style={{ gap: 0, padding: "10px 14px" }}>
            <div className="ans__head">
              <span className="t-headline">{sheet.label || `第 ${sheet.page + 1} 页`}</span>
              <span className="t-cap c-sec">{rows.length} 个空</span>
            </div>
            <div className="ans__row ans__row--head">
              <span>题号</span>
              <span>学生作答</span>
              <span>判定</span>
              <span>正确答案</span>
            </div>
            {rows.map((b) => (
              <div className={`ans__row${b.mark === "wrong" || b.mark === "partial" ? " ans__row--wrong" : isProblemMark(b.mark, b.student) ? " ans__row--blank" : ""}`} key={b.rowKey}>
                <span className="ans__num">{b.number}</span>
                <span className={`ans__hand${b.mark === "wrong" || b.mark === "partial" ? " ans__hand--wrong" : ""}`}>{unanswered(b.student) ? "—" : <MathText text={b.student} />}</span>
                <span>
                  <MarkChip mark={b.mark} student={b.student} grading={grading} />
                  {b.note && b.note !== UNANSWERED && <span className="t-cap" style={{ color: "var(--wrong)", display: "block" }}>{b.note}</span>}
                </span>
                <span className="ans__answer">{b.mark === "correct" ? "" : <MathText text={b.answer} />}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );

  // ---------------------------------------------------------------- 错题
  const errorsTab = (
    <>
      <ErrorFilterTags value={filter} onChange={setFilter} counts={{ wrong: errors.filter((e) => e.kind !== "未作答").length, blank: errors.filter((e) => e.kind === "未作答").length }} />
      {errors.length === 0 ? (
        <Empty icon="seal" title="这张试卷没有错题，也没有空题" text="真棒。" />
      ) : shown.length === 0 ? (
        <Empty icon="seal" title="这一类没有题" action={<Button size="xs" variant="plain" onClick={() => setFilter("all")}>看全部</Button>} />
      ) : (
        <>
          <Hint icon="list">按试卷顺序列出，同样的错题也会汇总到文件夹和错题库。</Hint>
          {groups.map(([k, items]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {k && <span className="t-headline" style={{ marginTop: 4 }}>{k} · {items.length} 题</span>}
              {items.map((i) => (
                <ErrorCard key={i.key} item={i} showKnowledge />
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="screen">
      <InlineNav title="" back backLabel={folder.name} right={<button className="icon-btn" aria-label="更多" style={{ color: "var(--brand)" }} onClick={() => setMenu(true)}><Icon name="ellipsis" size={24} /></button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img className="thumb" src={paper.pages[0]?.src} alt="" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <h1 className="t-title3 ellipsis" style={{ fontWeight: 800 }}>{paper.name}</h1>
            {paper.scannedAt && (
              <span className="t-foot c-sec" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="clock" size={13} stroke={2} />扫描于 {formatDateTime(paper.scannedAt)}
              </span>
            )}
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Tag kind="wrong">{stats.wrong} 错</Tag>
              {stats.blank > 0 && <Tag kind="pending" icon="alert">{stats.blank} 空</Tag>}
              <Tag kind="correct">{stats.correct} 对</Tag>
              <Tag kind="neutral" icon="document">{sheets.length} 个卷面</Tag>
            </span>
          </div>
        </div>
        {quality?.warn && (
          <div className="quality-card">
            <Icon name="alert" size={18} stroke={2.2} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>这张{quality.label}</b>
              <span className="t-foot" style={{ display: "block" }}>{quality.detail}。重拍一张清楚、完整的，识别和批改会更准。</span>
            </span>
            <Button size="xs" variant="tinted" icon="camera" onClick={rescan}>重拍</Button>
          </div>
        )}
        <IconSegmented value={tab} onChange={setTab} options={[{ value: "paper", label: "试卷", icon: "document" }, { value: "answers", label: "作答", icon: "pencil" }, { value: "errors", label: `错题 ${stats.problems}`, icon: "xcircle" }]} />

        {tab === "paper" && paperTab}
        {tab === "answers" && answersTab}
        {tab === "errors" && errorsTab}

        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          <Button variant="outline" icon="export" onClick={() => setExporting(true)} style={{ flex: 1 }}>导出这张</Button>
          <Button icon="xcircle" onClick={() => setTab("errors")} style={{ flex: 1.3 }} disabled={stats.problems === 0}>看错题 · {stats.problems}</Button>
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={paper.name}>
        <Button variant="tinted" icon="refresh" onClick={rescan}>重新扫描 / 改照片</Button>
        <Button variant="tinted" icon="photo" onClick={() => { setMenu(false); setShowOriginal((v) => !v); setTab("paper"); }}>{showOriginal ? "收起原图" : "查看原图"}</Button>
        <Button variant="tinted" icon="pencil" onClick={() => { setMenu(false); setName(paper.name); setRename(true); }}>重命名</Button>
        <Button variant="danger" icon="trash" onClick={() => { setMenu(false); setConfirmDelete(true); }}>删除这张试卷</Button>
      </Sheet>

      <Sheet open={rename} onClose={() => setRename(false)} title="试卷名称">
        <input className="input" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <Button onClick={async () => { await updatePaper(folderId, paperId, { name: name.trim() || paper.name }); setRename(false); await reload(); }}>保存</Button>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="删除这张试卷？">
        <p className="t-sub c-sec">照片和电子版会一起删掉。</p>
        <Button variant="danger" onClick={async () => { await deletePaper(folderId, paperId); nav(`/papers/${folderId}`, { replace: true }); }}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(false)}>取消</Button>
      </Sheet>

      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`${folder.name} · ${paper.name}`} subtitle={sheets.find((s) => s.syllabus)?.syllabus ? `按${sheets.find((s) => s.syllabus)!.syllabus}归类` : undefined} errors={errors} papers={[paper]} />
    </div>
  );
}
