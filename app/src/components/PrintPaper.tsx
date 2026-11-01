import { Fragment, type ReactNode } from "react";
import type { DigitizedBlank, DigitizedBlock, DigitizedPage } from "../api/types";
import { figureAt, type FigureRef } from "../lib/figures";
import { stripLeadingNumber, unwrapLines } from "../lib/format";
import { validDigitized, type Paper } from "../lib/folders";
import { Figures } from "./FigureImage";
import { MathText, mathNodes } from "./MathText";
import { subjectColors } from "./v2";

const BLANK_RE = /\[\[([^[\]]{1,24})\]\]/g;
const stripParen = (s: string) => s.replace(/^[（(]|[）)]$/g, "");

/** 打印版：把 [[id]] 占位换成只带空号的空格，不带任何手写内容 */
function renderPrint(text: string, blanks: DigitizedBlank[]): ReactNode[] {
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={`t${i}`}>{mathNodes(text.slice(last, start), `t${i++}`)}</Fragment>);
    const id = m[1];
    const num = byId.get(id)?.number || id.split("-")[0];
    out.push(
      <span className="blank blank--print" key={`b${i++}`}>
        <span className="blank__num">{num}</span>
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${i}`}>{mathNodes(text.slice(last), `t${i++}`)}</Fragment>);
  return out;
}

/**
 * 试卷的打印版：扫描识别出的原题，空格留白，不带作答和批改。
 * clean：原题空白卷，不显示得分；插图从擦过手写的照片里裁（还没擦的照片用原图）。
 */
export function PrintSheets({ paper, sheets, clean = false }: { paper: Paper; sheets: DigitizedPage[]; clean?: boolean }) {
  const colors = subjectColors(validDigitized(paper.digitized)?.questions[0]?.subject);

  const renderBlock = (block: DigitizedBlock, bi: number, si: number) => {
    switch (block.type) {
      case "figure": {
        // 连着的几个 figure 一起排（选项图排成一行）：只在一串的第一个块上渲染
        const prev = sheets[si].blocks[bi - 1];
        if (prev?.type === "figure") return null;
        const run: FigureRef[] = [];
        for (let j = bi; j < sheets[si].blocks.length && sheets[si].blocks[j].type === "figure"; j++) {
          const f = figureAt(paper, si, j, clean);
          if (f) run.push(f);
        }
        return run.length ? <Figures key={bi} figs={run} /> : null;
      }
      case "section":
        return (
          <div className="blk-section" key={bi}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="sec-bar" style={{ background: colors.color }} />
              <span className="blk-section__title" style={{ flex: 1 }}>
                {block.label && `${block.label.replace(/[.．、\s]+$/, "")}. `}
                {block.title}
              </span>
              {block.points && <span className="t-cap c-sec">{stripParen(block.points)}</span>}
            </div>
            {block.instruction && <div className="blk-section__instruction" style={{ marginLeft: 12 }}>{block.instruction}</div>}
          </div>
        );
      case "wordbank":
        return (
          <div className="blk-wordbank" key={bi}>
            {block.options.map((o, i) => (
              <span key={i}><MathText text={o} /></span>
            ))}
          </div>
        );
      case "text":
        return (
          <p className="blk-plain" key={bi}>
            <MathText text={block.text} />
          </p>
        );
      case "passage":
        return (
          <div className="blk-passage" key={bi}>
            {block.label && <span className="blk-passage__label">{block.label}</span>}
            <p className="blk-text">{renderPrint(unwrapLines(block.text), block.blanks)}</p>
          </div>
        );
      case "item":
        return (
          <div className="blk-item" key={bi}>
            <span className="blk-item__num">{block.number}.</span>
            <div className="blk-item__body">
              <p className="blk-text">
                {renderPrint(stripLeadingNumber(unwrapLines(block.text), block.number), block.blanks)}
                {block.hint && <span className="blk-hint"><MathText text={block.hint} /></span>}
                {block.instruction && <span className="blk-instruction">（{stripParen(block.instruction)}）</span>}
              </p>
              {block.options.length > 0 && (
                <div className="blk-options">
                  {block.options.map((o, i) => (
                    <span key={i}><MathText text={/^[A-H][.、．]/.test(o) ? o : `${String.fromCharCode(65 + i)}. ${o}`} /></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {sheets.map((sheet, si) => (
        <div className="paper" key={si}>
          <div className="paper__head">
            {sheet.title && <div className="paper__title">{sheet.title}</div>}
            <div className="paper__meta">
              {sheet.label && <span>{sheet.label}</span>}
              {[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).length > 0 && <span>{[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ")}</span>}
              {sheet.score && !clean && <span className="paper__score">{sheet.score}</span>}
            </div>
          </div>
          {sheet.blocks.map((b, bi) => renderBlock(b, bi, si))}
          {sheet.note && !clean && <p className="paper__note">{sheet.note}</p>}
        </div>
      ))}
    </>
  );
}
