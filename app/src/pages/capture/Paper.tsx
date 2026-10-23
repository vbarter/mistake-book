import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { apiBlob } from "../../api/client";
import type { DigitizedBlank, DigitizedBlock, DigitizedPage, DigitizedQuestion, Mark, RecognizedItem } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, SubjectChip } from "../../components/ui";
import { cropToDataUrl } from "../../lib/boxes";
import { QTYPE_LABEL } from "../../lib/format";
import { exportPdf, haptic } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useCapture } from "../../store/capture";
import "../../styles/paper.css";

type Tab = "paper" | "answers" | "errors";
type Kind = "未作答" | "答错" | "半对";

const MARK_LABEL: Record<Mark, string> = { correct: "正确", wrong: "错误", partial: "半对", unmarked: "未批改" };
const BLANK_RE = /\[\[([^[\]]{1,24})\]\]/g;
const UNANSWERED = "未作答";

const isWrong = (m: Mark) => m === "wrong" || m === "partial";
const unanswered = (student: string) => !student.trim();
const kindOf = (q: DigitizedQuestion): Kind => (q.mark === "partial" ? "半对" : unanswered(q.studentAnswer) ? UNANSWERED : "答错");
const stripParen = (s: string) => s.replace(/^[（(]|[）)]$/g, "");

/** 打印版：把 [[id]] 占位换成只带空号的空格，不带任何手写内容 */
function renderPrint(text: string, blanks: DigitizedBlank[]): ReactNode[] {
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={`t${i++}`}>{text.slice(last, start)}</Fragment>);
    const id = m[1];
    const num = byId.get(id)?.number || id.split("-")[0];
    out.push(
      <span className="blank blank--print" key={`b${i++}`}>
        <span className="blank__num">{num}</span>
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

function MarkChip({ mark, student }: { mark: Mark; student: string }) {
  const label = mark === "wrong" && unanswered(student) ? UNANSWERED : MARK_LABEL[mark];
  return <span className={`mark-chip mark-chip--${mark}`}>{label}</span>;
}

/** 电子版试卷：「试卷」原题干净可打印，「作答」逐空列出手写转写与批改，「错题汇总」按类型 / 大题 / 知识点归类并可收进错题本。 */
export default function Paper() {
  const nav = useNavigate();
  const { pages, digitized, folderName, setItems } = useCapture();
  const [tab, setTab] = useState<Tab>("paper");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!digitized || pages.length === 0) nav("/capture", { replace: true });
  }, [digitized, pages.length, nav]);

  useEffect(() => {
    if (digitized) setSelected(new Set(digitized.questions.filter((q) => isWrong(q.mark)).map((q) => q.index)));
  }, [digitized]);

  const wrong = useMemo(() => (digitized?.questions ?? []).filter((q) => isWrong(q.mark)), [digitized]);
  // 错题按知识点一级分类归组（knowledgePoints[0] 是考纲 / 课标里的规范名称），组内按题号顺序
  const groups = useMemo(() => {
    const byKp = new Map<string, DigitizedQuestion[]>();
    for (const q of wrong) {
      const kp = q.knowledgePoints[0] || "（未标注知识点）";
      byKp.set(kp, [...(byKp.get(kp) ?? []), q]);
    }
    return [...byKp.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [wrong]);
  const exam = useMemo(() => {
    const pick = (k: "region" | "examGrade" | "examLevel" | "syllabus") => digitized?.pages.find((s) => s[k])?.[k] ?? "";
    return { line: [pick("region"), pick("examGrade"), pick("examLevel")].filter(Boolean).join(" · "), syllabus: pick("syllabus") };
  }, [digitized]);

  if (!digitized) return null;
  const sheets: DigitizedPage[] = digitized.pages;
  const total = digitized.questions.length;

  const toggle = (idx: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
    void haptic.selection();
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await apiBlob("/api/digitize/pdf", { method: "POST", body: { title: folderName, pages: sheets, questions: digitized.questions }, timeoutMs: 60000 });
      await exportPdf(blob, `${folderName || "试卷"}.pdf`);
      void haptic.success();
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) toastError(e);
    } finally {
      setExporting(false);
    }
  };

  const importSelected = async () => {
    const chosen = digitized.questions.filter((q) => selected.has(q.index));
    if (chosen.length === 0) return toast("先勾选要收进错题本的题");
    setBusy(true);
    try {
      const items: RecognizedItem[] = [];
      for (const q of chosen) {
        const p = pages[q.page];
        const [x0, y0, x1, y1] = q.bbox;
        const stemImage = p
          ? await cropToDataUrl(p.src, { id: "c", x: x0 * p.width, y: y0 * p.height, w: Math.max(40, (x1 - x0) * p.width), h: Math.max(30, (y1 - y0) * p.height) }, 1000, 0.8)
          : "";
        items.push({
          subject: q.subject,
          knowledgePoints: q.knowledgePoints,
          stemText: q.stemText,
          questionType: q.questionType,
          options: q.options,
          uncertainSpans: q.uncertainSpans,
          studentAnswer: q.studentAnswer,
          correctAnswer: q.correctAnswer,
          analysis: q.analysis,
          tip: q.tip,
          aiGenerated: true,
          stemImage,
          reasons: [],
          note: "",
          page: q.page,
          bbox: q.bbox,
          reason: q.mark === "correct" ? "答对的题，主动收录" : kindOf(q) === UNANSWERED ? "未作答" : q.teacherNote ? `老师批改：${q.teacherNote}` : MARK_LABEL[q.mark],
        });
      }
      setItems(items);
      void haptic.success();
      nav("/capture/review");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- 试卷（打印版）
  const renderPrintBlock = (block: DigitizedBlock, bi: number) => {
    switch (block.type) {
      case "section":
        return (
          <div className="blk-section" key={bi}>
            <div className="blk-section__title">
              {block.label && `${block.label}. `}
              {block.title}
              {block.points && <span className="blk-section__points">（{stripParen(block.points)}）</span>}
            </div>
            {block.instruction && <div className="blk-section__instruction">{block.instruction}</div>}
          </div>
        );
      case "wordbank":
        return (
          <div className="blk-wordbank" key={bi}>
            {block.options.map((o, i) => (
              <span key={i}>{o}</span>
            ))}
          </div>
        );
      case "text":
        return (
          <p className="blk-plain" key={bi}>
            {block.text}
          </p>
        );
      case "passage":
        return (
          <div className="blk-passage" key={bi}>
            {block.label && <span className="blk-passage__label">{block.label}</span>}
            <p className="blk-text">{renderPrint(block.text, block.blanks)}</p>
          </div>
        );
      case "item":
        return (
          <div className="blk-item" key={bi}>
            <span className="blk-item__num">{block.number}.</span>
            <div className="blk-item__body">
              <p className="blk-text">
                {renderPrint(block.text, block.blanks)}
                {block.hint && <span className="blk-hint">{block.hint}</span>}
                {block.instruction && <span className="blk-instruction">（{stripParen(block.instruction)}）</span>}
              </p>
              {block.options.length > 0 && (
                <div className="blk-options">
                  {block.options.map((o, i) => (
                    <span key={i}>{/^[A-H][.、．]/.test(o) ? o : `${String.fromCharCode(65 + i)}. ${o}`}</span>
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
      <p className="t-foot c-sec">打印版只有原题，空格留白；学生作答与批改在「作答」页单独列出。</p>
      {sheets.map((sheet, si) => (
        <div className="paper" key={si}>
          <div className="paper__head">
            {sheet.title && <div className="paper__title">{sheet.title}</div>}
            <div className="paper__meta">
              {sheet.label && <span>{sheet.label}</span>}
              {sheet.score && <span className="paper__score">{sheet.score}</span>}
            </div>
          </div>
          {sheet.blocks.map(renderPrintBlock)}
          {sheet.note && <p className="paper__note">{sheet.note}</p>}
        </div>
      ))}
    </>
  );

  // ---------------------------------------------------------------- 作答
  const answersTab = (
    <>
      <p className="t-foot c-sec">学生手写内容的转写，与老师批改、正确答案逐空对照。空题按未作答计入错题。</p>
      {sheets.map((sheet, si) => {
        const rows = sheet.blocks.flatMap((b) => (b.type === "passage" || b.type === "item" ? b.blanks : []));
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
              <div className={`ans__row${isWrong(b.mark) ? " ans__row--wrong" : ""}`} key={b.id}>
                <span className="ans__num">{b.number}</span>
                <span className={`ans__hand${isWrong(b.mark) ? " ans__hand--wrong" : ""}`}>{unanswered(b.student) ? "—" : b.student}</span>
                <span>
                  <MarkChip mark={b.mark} student={b.student} />
                  {b.note && b.note !== UNANSWERED && <span className="t-cap" style={{ color: "var(--wrong)", display: "block" }}>{b.note}</span>}
                </span>
                <span className="ans__answer">{b.mark === "correct" ? "" : b.answer}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );

  // ---------------------------------------------------------------- 错题汇总
  const errorsTab = (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip" style={{ background: "var(--wrong-bg)", color: "var(--wrong)" }}>错 {wrong.length} / {total} 题</span>
        {exam.line && <span className="chip chip--sm" style={{ background: "var(--fill-light)", color: "var(--secondary)" }}>{exam.line}</span>}
      </div>
      {exam.syllabus && <p className="t-foot c-sec">按{exam.syllabus}的知识点归类，同类错题放在一起便于记忆</p>}
      {wrong.length === 0 ? (
        <div className="card"><p className="t-body">本卷没有错题。</p></div>
      ) : (
        <>
          <div className="card" style={{ gap: 8 }}>
            <h3 className="t-headline">按知识点</h3>
            {groups.map(([k, qs]) => (
              <div className="grp" key={k}><span className="grp__name">{k}（{qs.length}）</span><span className="grp__nums">{qs.map((q) => q.number).join("、")}</span></div>
            ))}
          </div>
          <p className="t-foot c-sec">逐题核对，勾选的题会收进错题本（默认全选）</p>
          {groups.map(([k, qs]) => (
            <Fragment key={k}>
              <h3 className="t-headline" style={{ marginTop: 4 }}>{k} · {qs.length} 题</h3>
              {qs.map((q) => {
                const on = selected.has(q.index);
                const subKps = q.knowledgePoints.slice(1);
                return (
                  <div key={q.index} className="card" style={{ gap: 8, border: on ? "1.5px solid var(--brand)" : "1.5px solid transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button role="checkbox" aria-checked={on} aria-label={`收录第 ${q.number} 题`} className={`pick${on ? " on" : ""}`} onClick={() => toggle(q.index)}>
                        {on && <Icon name="check" size={14} stroke={2.8} />}
                      </button>
                      <span className="t-headline">第 {q.number} 题</span>
                      <SubjectChip subject={q.subject} small />
                      <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</span>
                      <span className={`mark-chip mark-chip--${q.mark}`} style={{ marginLeft: "auto" }}>{kindOf(q)}</span>
                    </div>
                    <p className="t-sub" style={{ whiteSpace: "pre-wrap" }}>{q.stemText}</p>
                    {q.options.length > 0 && <p className="t-foot c-sec">{q.options.join("　")}</p>}
                    <div className="blk-feedback">
                      <span>作答：<b style={{ color: "var(--wrong)" }}>{unanswered(q.studentAnswer) ? UNANSWERED : q.studentAnswer}</b>　正确：<b style={{ color: "var(--mastered)" }}>{q.correctAnswer || "—"}</b></span>
                      {q.analysis && <span>{q.analysis}</span>}
                      {q.tip && <span>下次注意：{q.tip}</span>}
                      {subKps.length > 0 && <span className="t-cap">细分：{subKps.join("、")}</span>}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="screen">
      <InlineNav title="电子版试卷" subtitle={`${folderName || "试卷"} · ${total} 题 · 错 ${wrong.length} 题`} back backLabel="试卷" right={<button className="nav-btn" onClick={() => nav("/capture")}>重新扫描</button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 4, paddingBottom: 0 }}>
        <div className="seg" role="tablist">
          {(["paper", "answers", "errors"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`seg__item${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t === "paper" ? "试卷" : t === "answers" ? "作答" : `错题汇总 ${wrong.length}`}
            </button>
          ))}
        </div>

        {tab === "paper" && paperTab}
        {tab === "answers" && answersTab}
        {tab === "errors" && errorsTab}

        <div className="bottom-bar">
          <Button variant="tinted" onClick={doExport} disabled={exporting} style={{ flex: 1 }}>
            <Icon name="export" size={18} stroke={2} />
            {exporting ? "生成中…" : "导出 PDF"}
          </Button>
          <Button onClick={importSelected} disabled={busy || selected.size === 0} style={{ flex: 1.4 }}>
            {busy ? "准备中…" : `收进错题本 · ${selected.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
