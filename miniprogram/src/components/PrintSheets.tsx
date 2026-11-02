/** 电子版试卷的打印版（试卷页「试卷」页签、原题空白卷共用，和 App 的 components/PrintPaper.tsx 一致）：只有原题，空格留白。
 *  clean：原题空白卷，不显示得分和批注；插图从擦过手写的照片里裁（还没擦的照片用原图）。 */
import { Text, View } from "@tarojs/components";
import { Figures } from "./FigureImage";
import { MathText, subjectColors } from "./ui";
import { figureAt, type FigureRef } from "../lib/figures";
import { stripLeadingNumber, unwrapLines } from "../lib/format";
import { mathPlain } from "../lib/math";
import type { Paper } from "../lib/store";
import type { DigitizedBlank, DigitizedBlock, DigitizedPage } from "../lib/types";

const BLANK_RE = /\[\[([^[\]]{1,24})\]\]/g;
const stripParen = (s: string) => s.replace(/^[（(]|[）)]$/g, "");

/** 打印版正文：[[id]] 占位换成只带空号的下划线 */
function PrintText({ text, blanks }: { text: string; blanks: DigitizedBlank[] }) {
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const out: JSX.Element[] = [];
  let last = 0;
  let i = 0;
  const re = new RegExp(BLANK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    if (start > last) out.push(<MathText key={`t${i++}`} text={text.slice(last, start)} />);
    const num = byId.get(m[1])?.number || m[1].split("-")[0];
    out.push(
      <Text key={`b${i++}`} className="pblank">
        {`  ${num}  `}
      </Text>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<MathText key={`t${i++}`} text={text.slice(last)} />);
  return <Text className="blk-text">{out}</Text>;
}

export function PrintSheets({ paper, sheets, clean = false }: { paper: Paper; sheets: DigitizedPage[]; clean?: boolean }) {
  const colors = subjectColors(sheets.find((s) => s.subject)?.subject);
  const printBlock = (block: DigitizedBlock, bi: number, si: number) => {
    switch (block.type) {
      case "figure": {
        // 连着的几个 figure 一起排（选项图排成一行）：只在一串的第一个块上渲染
        const blocks = sheets[si].blocks;
        if (blocks[bi - 1]?.type === "figure") return null;
        const run: FigureRef[] = [];
        for (let j = bi; j < blocks.length && blocks[j].type === "figure"; j++) {
          const f = figureAt(paper, si, j, clean);
          if (f) run.push(f);
        }
        return run.length ? <Figures key={bi} figs={run} /> : null;
      }
      case "section":
        return (
          <View className="blk-section" key={bi}>
            <View className="row-center gap6">
              <View className="sec-bar" style={{ background: colors.color }} />
              <Text className="blk-section__title flex1">
                {block.label && `${block.label.replace(/[.．、\s]+$/, "")}. `}
                {mathPlain(block.title)}
              </Text>
              {block.points && <Text className="t-cap c-sec">{mathPlain(stripParen(block.points))}</Text>}
            </View>
            {block.instruction && <MathText className="blk-section__instruction" text={block.instruction} />}
          </View>
        );
      case "wordbank":
        return (
          <View className="blk-wordbank" key={bi}>
            {block.options.map((o, i) => (
              <MathText key={i} className="wb" text={o} />
            ))}
          </View>
        );
      case "text":
        return <MathText key={bi} className="blk-plain" text={block.text} />;
      case "passage":
        return (
          <View className="blk-passage" key={bi}>
            {block.label && <Text className="b">{block.label}</Text>}
            <PrintText text={unwrapLines(block.text)} blanks={block.blanks} />
          </View>
        );
      case "item":
        return (
          <View className="blk-item" key={bi}>
            <Text className="blk-item__num">{block.number}.</Text>
            <View className="flex1 col gap4 minw0">
              <View>
                <PrintText text={stripLeadingNumber(unwrapLines(block.text), block.number)} blanks={block.blanks} />
                {block.hint && <MathText className="c-sec" text={` ${block.hint}`} />}
                {block.instruction && <Text className="c-sec">（{stripParen(block.instruction)}）</Text>}
              </View>
              {block.options.length > 0 && (
                <View className="blk-options">
                  {block.options.map((o, i) => (
                    <MathText key={i} text={/^[A-H][.、．]/.test(o) ? o : `${String.fromCharCode(65 + i)}. ${o}`} />
                  ))}
                </View>
              )}
            </View>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {sheets.map((sheet, si) => (
        <View className="sheet-paper" key={si}>
          <View className="sheet-paper__head">
            {sheet.title && <Text className="sheet-paper__title">{mathPlain(sheet.title)}</Text>}
            <View className="row-wrap t-cap c-sec">
              {sheet.label && <Text>{sheet.label}</Text>}
              {[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).length > 0 && <Text>{[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ")}</Text>}
              {sheet.score && !clean && <Text className="c-wrong b">{sheet.score}</Text>}
            </View>
          </View>
          {sheet.blocks.map((b, bi) => printBlock(b, bi, si))}
          {sheet.note && !clean && <MathText className="t-cap c-sec" text={sheet.note} />}
        </View>
      ))}
    </>
  );
}
