import { useNavigate } from "react-router-dom";
import type { Mistake } from "../api/types";
import { formatDate } from "../lib/format";
import { MasteryChip, SubjectChip } from "./ui";

export function MistakeRow({ m, showTopic = true }: { m: Mistake; showTopic?: boolean }) {
  const nav = useNavigate();
  const topic = m.knowledgePoints[0] ?? "未分类";
  return (
    <button className="row" onClick={() => nav(`/mistake/${m.id}`)} style={{ minHeight: 60 }}>
      <SubjectChip subject={m.subject} small />
      <span className="row__main">
        <span className="t-sub ellipsis" style={{ fontWeight: 500 }}>
          {showTopic && <span>{topic} · </span>}
          {m.stemText}
        </span>
        <span className="row__sub">
          {formatDate(m.createdAt)}
          {m.source?.name ? ` · ${m.source.name}` : ""}
          {m.wrongCount > 1 ? ` · 错过 ${m.wrongCount} 次` : ""}
        </span>
      </span>
      <MasteryChip mastery={m.mastery} small />
    </button>
  );
}
