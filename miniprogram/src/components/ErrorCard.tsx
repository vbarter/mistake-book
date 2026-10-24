import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ErrorItem, ErrorPart } from "../lib/errors";
import { QTYPE_LABEL } from "../lib/format";
import { mathPlain } from "../lib/math";
import { MathText, SubjectTile, Tag, Verdict, subjectColors } from "./ui";

export const errorAnchor = (key: string) => `err-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** 滚到某道错题 */
export function jumpToError(key: string) {
  void Taro.pageScrollTo({ selector: `#${errorAnchor(key)}`, offsetTop: -12, duration: 300 });
}

const unanswered = (s: string) => !s.trim() || s.trim() === "未作答";

function Answer({ text, wrong }: { text: string; wrong: boolean }) {
  if (unanswered(text)) return <Text className="c-accent b">未作答</Text>;
  return <MathText className={`hand${wrong ? " hand--wrong" : ""}`} text={text} />;
}

/** 解析：多步解法每步一行，「错在」那行标红 */
function Analysis({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <View className="steps">
      {lines.map((l, i) => (
        <View key={i} className={l.startsWith("错在") ? "steps__err" : "steps__line"}>
          {lines.length > 1 && !l.startsWith("错在") && <Text className="steps__no">{i + 1}</Text>}
          <MathText text={l} />
        </View>
      ))}
    </View>
  );
}

function PartRow({ p }: { p: ErrorPart }) {
  const wrong = p.mark === "wrong" || p.mark === "partial";
  return (
    <View className="part">
      <View className="part__head">
        <Text className="b">{p.label}</Text>
        <Verdict mark={p.mark} student={p.student} />
      </View>
      <View>
        <Text>作答：</Text>
        <Answer text={p.student} wrong={wrong} />
      </View>
      {p.mark !== "correct" && (
        <View>
          <Text>正确：</Text>
          {p.answer ? <MathText className="right" text={p.answer} /> : <Text>—</Text>}
        </View>
      )}
      {p.mark !== "correct" && <Analysis text={p.analysis} />}
    </View>
  );
}

/** 一道错题：题干、作答与正确答案、解析、细分知识点 */
export function ErrorCard({ item, showSource, showKnowledge }: { item: ErrorItem; showSource?: boolean; showKnowledge?: boolean }) {
  const q = item.q;
  const c = subjectColors(q.subject);
  const meta = [showSource ? `${item.folderName} · ${item.paperName}` : "", mathPlain(item.sectionLabel)].filter(Boolean).join(" · ");
  return (
    <View className="card ecard" id={errorAnchor(item.key)}>
      <View className="ecard__head">
        <Text className="t-headline">第 {q.number} 题</Text>
        <SubjectTile subject={q.subject} size="xs" />
        <Text className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</Text>
        <View className="flex1" />
        <Tag kind={item.kind === "未作答" ? "pending" : item.kind === "半对" ? "partial" : "wrong"}>{item.kind}</Tag>
      </View>
      {(meta || showKnowledge) && (
        <View className="row-wrap t-cap c-sec">
          {showKnowledge && (
            <Text className="tag" style={{ background: c.bg, color: c.color }}>
              {item.knowledge}
            </Text>
          )}
          {meta && <Text>{meta}</Text>}
        </View>
      )}
      <MathText className="t-sub stem" text={item.stem} />
      {q.options.length > 0 && <MathText className="t-foot c-sec" text={q.options.join("　")} />}
      {q.stemText.includes("□") && <Text className="t-cap c-wrong">题目里有内容没识别出来，建议把这一张重拍清楚</Text>}
      <View className="feedback">
        {item.parts.length > 1 ? (
          item.parts.map((p, i) => <PartRow key={i} p={p} />)
        ) : (
          <>
            <View>
              <Text>作答：</Text>
              <Answer text={q.studentAnswer} wrong={item.kind !== "未作答"} />
            </View>
            <View>
              <Text>正确：</Text>
              {q.correctAnswer ? <MathText className="right" text={q.correctAnswer} /> : <Text>—</Text>}
            </View>
            <Analysis text={q.analysis} />
          </>
        )}
        {q.tip && (
          <View>
            <Text>下次注意：</Text>
            <MathText text={q.tip} />
          </View>
        )}
        {item.subKnowledge.length > 0 && <Text className="t-cap">细分：{item.subKnowledge.join("、")}</Text>}
      </View>
    </View>
  );
}
