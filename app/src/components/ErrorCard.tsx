import type { ErrorItem } from "../lib/errors";
import { QTYPE_LABEL } from "../lib/format";
import { Icon } from "./Icon";
import { SubjectChip } from "./ui";
import { Tag } from "./v2";

/** 一道错题：左侧勾选「已订正」，题干、作答与正确答案、解析、细分知识点 */
export function ErrorCard({ item, onToggle, showSource }: { item: ErrorItem; onToggle: (next: boolean) => void; showSource?: boolean }) {
  const q = item.q;
  const student = q.studentAnswer.trim() || "未作答";
  return (
    <div className="card" style={{ gap: 8, border: item.corrected ? "1.5px solid var(--mastered)" : "1.5px solid transparent", opacity: item.corrected ? 0.85 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button role="checkbox" aria-checked={item.corrected} aria-label={`第 ${q.number} 题${item.corrected ? "已订正" : "未订正"}`} className={`pick${item.corrected ? " on" : ""}`} style={item.corrected ? { background: "var(--mastered)" } : undefined} onClick={() => onToggle(!item.corrected)}>
          {item.corrected && <Icon name="check" size={14} stroke={2.8} />}
        </button>
        <span className="t-headline">第 {q.number} 题</span>
        <SubjectChip subject={q.subject} small />
        <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</span>
        <span style={{ marginLeft: "auto" }}>
          {item.corrected ? <Tag kind="correct">已订正</Tag> : <Tag kind={item.kind === "未作答" ? "pending" : item.kind === "半对" ? "partial" : "wrong"} icon={item.kind === "未作答" ? "alert" : item.kind === "半对" ? "warning" : "xmark"}>{item.kind}</Tag>}
        </span>
      </div>
      {(showSource || item.sectionLabel) && (
        <span className="t-cap c-sec">{[showSource ? `${item.folderName} · ${item.paperName}` : "", item.sectionLabel].filter(Boolean).join(" · ")}</span>
      )}
      <p className="t-sub" style={{ whiteSpace: "pre-wrap" }}>{q.stemText}</p>
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
