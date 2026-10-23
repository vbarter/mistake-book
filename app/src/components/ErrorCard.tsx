import type { ErrorItem } from "../lib/errors";
import { QTYPE_LABEL } from "../lib/format";
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

/** 一道错题：题干、作答与正确答案、解析、细分知识点；showKnowledge 在没按知识点分组的列表里把知识点标在卡片上 */
export function ErrorCard({ item, showSource, showKnowledge }: { item: ErrorItem; showSource?: boolean; showKnowledge?: boolean }) {
  const q = item.q;
  const c = subjectColors(q.subject);
  const student = q.studentAnswer.trim() || "未作答";
  return (
    <div className="card" id={errorAnchor(item.key)} style={{ gap: 8, scrollMarginTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="t-headline">第 {q.number} 题</span>
        <SubjectChip subject={q.subject} small />
        <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</span>
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
      <p className="t-sub" style={{ whiteSpace: "pre-wrap" }}>{item.stem}</p>
      {q.options.length > 0 && <p className="t-foot c-sec">{q.options.join("　")}</p>}
      <div className="blk-feedback">
        <span>作答：<b style={{ color: item.kind === "未作答" ? "var(--accent-on)" : "var(--wrong)" }}>{student}</b>　正确：<b style={{ color: "var(--mastered)" }}>{q.correctAnswer || "—"}</b></span>
        {q.analysis && <span>{q.analysis}</span>}
        {q.tip && <span>下次注意：{q.tip}</span>}
        {item.subKnowledge.length > 0 && <span className="t-cap">细分：{item.subKnowledge.join("、")}</span>}
      </div>
    </div>
  );
}
