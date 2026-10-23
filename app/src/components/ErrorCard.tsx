import type { Mark } from "../api/types";
import type { ErrorItem, ErrorPart } from "../lib/errors";
import { QTYPE_LABEL } from "../lib/format";
import { Icon } from "./Icon";
import { MathText, hasUnrecognized } from "./MathText";
import { SubjectChip } from "./ui";
import { Tag, subjectColors } from "./v2";

/** 卡片的锚点 id：题号小圆片点一下就滚到这里 */
export const errorAnchor = (key: string) => `err-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** 滚到某道错题并闪一下高亮 */
export function jumpToError(key: string) {
  const el = document.getElementById(errorAnchor(key));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("card--flash");
  void el.offsetWidth; // 重新触发动画
  el.classList.add("card--flash");
  window.setTimeout(() => el.classList.remove("card--flash"), 1600);
}

const unanswered = (s: string) => !s.trim() || s.trim() === "未作答";

function Verdict({ mark, student, ai }: { mark: Mark; student: string; ai?: boolean }) {
  if (mark === "blank" || unanswered(student)) return <Tag kind="pending" icon="alert">未作答</Tag>;
  if (mark === "correct") return <Tag kind="correct" icon={ai ? "sparkles" : "check"}>{ai ? "AI 判对" : "对"}</Tag>;
  if (mark === "partial") return <Tag kind="partial" icon={ai ? "sparkles" : "warning"}>{ai ? "AI 判半对" : "半对"}</Tag>;
  if (mark === "wrong") return <Tag kind="wrong" icon={ai ? "sparkles" : "xmark"}>{ai ? "AI 判错" : "错"}</Tag>;
  return <Tag kind="neutral" icon="info">未批改</Tag>;
}

/** 学生作答：多行（解答过程）用手写体分行展示，单行就跟在标签后面 */
function Answer({ text, wrong }: { text: string; wrong: boolean }) {
  if (unanswered(text)) return <b style={{ color: "var(--accent-on)" }}>未作答</b>;
  return <MathText className={`ans-text${text.includes("\n") ? " ans-text--block" : ""}${wrong ? " ans-text--wrong" : ""}`} text={text} />;
}

/** 解析：多步解法每步一行，「错在：」那行标红 */
function Analysis({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="steps">
      {lines.map((l, i) => (
        <span key={i} className={l.startsWith("错在") ? "steps__err" : undefined}>
          {lines.length > 1 && !l.startsWith("错在") && <span className="steps__no">{i + 1}</span>}
          <MathText text={l} />
        </span>
      ))}
    </div>
  );
}

function PartRow({ p }: { p: ErrorPart }) {
  const wrong = p.mark === "wrong" || p.mark === "partial";
  return (
    <div className="part">
      <div className="part__head">
        <span className="part__label">{p.label}</span>
        <Verdict mark={p.mark} student={p.student} ai={p.ai} />
      </div>
      <span className="part__line">作答：<Answer text={p.student} wrong={wrong} /></span>
      {p.mark !== "correct" && <span className="part__line">正确：<b className="ans-right">{p.answer ? <MathText text={p.answer} /> : "—"}</b></span>}
      {p.mark !== "correct" && <Analysis text={p.analysis} />}
    </div>
  );
}

/** 一道错题：题干、作答与正确答案、解析、细分知识点；一题多问时逐问展示；showKnowledge 在没按知识点分组的列表里把知识点标在卡片上 */
export function ErrorCard({ item, showSource, showKnowledge }: { item: ErrorItem; showSource?: boolean; showKnowledge?: boolean }) {
  const q = item.q;
  const c = subjectColors(q.subject);
  const unclear = hasUnrecognized(q.stemText);
  return (
    <div className="card" id={errorAnchor(item.key)} style={{ gap: 8, scrollMarginTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="t-headline">第 {q.number} 题</span>
        <SubjectChip subject={q.subject} small />
        <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}{q.aiGraded ? " · AI 阅卷" : ""}</span>
        <span style={{ marginLeft: "auto" }}>
          <Tag kind={item.kind === "未作答" ? "pending" : item.kind === "半对" ? "partial" : "wrong"} icon={item.kind === "未作答" ? "alert" : item.kind === "半对" ? "warning" : "xmark"}>{item.kind}</Tag>
        </span>
      </div>
      {(showSource || item.sectionLabel || showKnowledge) && (
        <span className="t-cap c-sec" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {showKnowledge && <span className="tag" style={{ background: c.bg, color: c.color, height: 22 }}>{item.knowledge}</span>}
          {[showSource ? `${item.folderName} · ${item.paperName}` : "", item.sectionLabel].filter(Boolean).join(" · ")}
        </span>
      )}
      <p className="t-sub"><MathText text={item.stem} /></p>
      {q.options.length > 0 && <p className="t-foot c-sec"><MathText text={q.options.join("　")} /></p>}
      {unclear && (
        <span className="t-cap" style={{ color: "var(--wrong)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="alert" size={13} stroke={2.2} />题目里有内容没识别出来，建议把这一张重拍清楚
        </span>
      )}
      <div className="blk-feedback">
        {item.parts.length > 1 ? (
          item.parts.map((p, i) => <PartRow key={i} p={p} />)
        ) : (
          <>
            <span>作答：<Answer text={q.studentAnswer} wrong={item.kind !== "未作答"} /></span>
            <span>正确：<b className="ans-right">{q.correctAnswer ? <MathText text={q.correctAnswer} /> : "—"}</b></span>
            <Analysis text={q.analysis} />
          </>
        )}
        {q.tip && <span>下次注意：<MathText text={q.tip} /></span>}
        {item.subKnowledge.length > 0 && <span className="t-cap">细分：{item.subKnowledge.join("、")}</span>}
      </div>
    </div>
  );
}
