import type { Subject } from "../api/types";
import { paperSubject, type Paper } from "../lib/folders";
import { SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { Sheet } from "./ui";
import { SubjectTile } from "./v2";

/** 给一张试卷选学科（识别不出来，或认错了要换子目录） */
export function SubjectPicker({ paper, onClose, onPick }: { paper: Paper | null; onClose: () => void; onPick: (s: Subject) => void }) {
  const current = paper ? paperSubject(paper) : null;
  return (
    <Sheet open={Boolean(paper)} onClose={onClose} title="放到哪个学科？">
      <span className="t-foot c-sec">选好后这张试卷会归到文件夹里对应的学科目录，重新扫描也不会改回去。</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SUBJECTS.map((s) => (
          <button key={s} className={`chip chip--select${current === s ? " on" : ""}`} onClick={() => onPick(s)} style={{ gap: 6 }}>
            <SubjectTile subject={s} size="xs" />{SUBJECT_LABEL[s]}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
