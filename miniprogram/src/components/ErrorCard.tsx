import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ErrorItem, ErrorPart } from "../lib/errors";
import { QTYPE_LABEL, formatDate } from "../lib/format";
import { mathPlain } from "../lib/math";
import { Figures } from "./FigureImage";
import { answerLabels } from "../lib/figures";
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
  // 数理化详解按【思路】【知识点】【解答】【技巧】【易错】分段，【解答】下的步骤编号
  const sectioned = lines.some((l) => /^【[^】]+】/.test(l));
  let no = 0;
  return (
    <View className="steps">
      {lines.map((l, i) => {
        const sec = sectioned ? /^【([^】]+)】(.*)$/.exec(l) : null;
        if (sec) {
          no = 0;
          return (
            <View key={i} className="steps__sec">
              <Text className="steps__tag">{sec[1]}</Text>
              {sec[2].trim() && <MathText text={sec[2].trim()} />}
            </View>
          );
        }
        if (l.startsWith("错在")) return <View key={i} className="steps__err"><MathText text={l} /></View>;
        no += 1;
        return (
          <View key={i} className="steps__line">
            {(sectioned || lines.length > 1) && <Text className="steps__no">{no}</Text>}
            <MathText text={l} />
          </View>
        );
      })}
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
        {item.repeats && item.repeats.length > 0 && <Tag kind="wrong">错过 {item.repeats.length + 1} 次</Tag>}
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
      {item.figures.length > 0 && <Figures figs={item.figures} right={answerLabels(q.correctAnswer)} chosen={answerLabels(q.studentAnswer)} />}
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
      {item.repeats && item.repeats.length > 0 && (
        <View className="col gap4 t-cap c-sec">
          <Text>之前也错过：</Text>
          {item.repeats.map((r) => (
            <Text key={r.key}>
              {formatDate(r.scannedAt)} · {r.folderName} · {r.paperName} 第 {r.q.number} 题 · {r.kind === "未作答" ? "没作答" : `写的：${r.q.studentAnswer || "—"}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
