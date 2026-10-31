import type { Mark } from "../api/types";
import type { ErrorItem, ErrorPart } from "../lib/errors";
import { QTYPE_LABEL, formatDate } from "../lib/format";
import { Figures } from "./FigureImage";
import { answerLabels } from "../lib/figures";
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

/** 判定：对 ✅、错 ❌，不区分是老师批的还是 AI 判的 */
export function Verdict({ mark, student }: { mark: Mark; student: string }) {
  if (mark === "blank" || unanswered(student)) return <Tag kind="pending" icon="alert">未作答</Tag>;
  if (mark === "correct") return <span className="verdict" role="img" aria-label="对">✅</span>;
  if (mark === "wrong") return <span className="verdict" role="img" aria-label="错">❌</span>;
  if (mark === "partial") return <Tag kind="partial" icon="warning">半对</Tag>;
  return <Tag kind="neutral" icon="info">未批改</Tag>;
}

/** 学生作答：多行（解答过程）用手写体分行展示，单行就跟在标签后面 */
function Answer({ text, wrong }: { text: string; wrong: boolean }) {
  if (unanswered(text)) return <b style={{ color: "var(--accent-on)" }}>未作答</b>;
  return <MathText className={`ans-text${text.includes("\n") ? " ans-text--block" : ""}${wrong ? " ans-text--wrong" : ""}`} text={text} />;
}

/** 解析：多步解法每步一行，「错在：」那行标红；数理化详解按【思路】【知识点】【解答】【技巧】【易错】分段，【解答】下的步骤编号 */
function Analysis({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sectioned = lines.some((l) => /^【[^】]+】/.test(l));
  let no = 0;
  return (
    <div className={`steps${sectioned ? " steps--sec" : ""}`}>
      {lines.map((l, i) => {
        const sec = sectioned ? /^【([^】]+)】(.*)$/.exec(l) : null;
        if (sec) {
          no = 0;
          return (
            <span key={i} className="steps__sec">
              <b className="steps__tag">{sec[1]}</b>
              {sec[2].trim() && <MathText text={sec[2].trim()} />}
            </span>
          );
        }
        if (l.startsWith("错在")) return <span key={i} className="steps__err"><MathText text={l} /></span>;
        no += 1;
        return (
          <span key={i}>
            {(sectioned || lines.length > 1) && <span className="steps__no">{no}</span>}
            <MathText text={l} />
          </span>
        );
      })}
    </div>
  );
}

function PartRow({ p }: { p: ErrorPart }) {
  const wrong = p.mark === "wrong" || p.mark === "partial";
  return (
    <div className="part">
      <div className="part__head">
        <span className="part__label">{p.label}</span>
        <Verdict mark={p.mark} student={p.student} />
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
        <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          {item.repeats && item.repeats.length > 0 && <Tag kind="wrong" icon="refresh">错过 {item.repeats.length + 1} 次</Tag>}
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
      {item.figures.length > 0 && <Figures figs={item.figures} right={answerLabels(q.correctAnswer)} chosen={answerLabels(q.studentAnswer)} />}
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
      {item.repeats && item.repeats.length > 0 && (
        <div className="t-cap c-sec" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>之前也错过：</span>
          {item.repeats.map((r) => (
            <span key={r.key}>
              {formatDate(r.scannedAt)} · {r.folderName} · {r.paperName} 第 {r.q.number} 题 · {r.kind === "未作答" ? "没作答" : `写的：${r.q.studentAnswer || "—"}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
