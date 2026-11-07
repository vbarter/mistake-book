import { Text, View } from "@tarojs/components";
import { SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { paperSubject } from "../lib/logic";
import type { Paper } from "../lib/store";
import type { Subject } from "../lib/types";
import { Sheet, SubjectTile } from "./ui";

/** 给一张试卷选学科（识别不出来，或认错了要换子目录）：学科有 10 个，超过 showActionSheet 的上限，用面板 */
export function SubjectPicker({ paper, onClose, onPick }: { paper: Paper | null; onClose: () => void; onPick: (s: Subject) => void }) {
  const current = paper ? paperSubject(paper) : null;
  return (
    <Sheet open={Boolean(paper)} onClose={onClose} title="放到哪个学科？">
      <Text className="t-foot c-sec">选好后这张试卷会归到文件夹里对应的学科目录，重新扫描也不会改回去。</Text>
      <View className="row-wrap" style={{ gap: "8px" }}>
        {SUBJECTS.map((s) => (
          <View key={s} className={`chip${current === s ? " chip--on" : ""}`} onClick={() => onPick(s)}>
            <SubjectTile subject={s} size="xs" />
            <Text>{SUBJECT_LABEL[s]}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
