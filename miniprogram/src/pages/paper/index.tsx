import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ErrorCard } from "../../components/ErrorCard";
import { ExportSheet } from "../../components/ExportSheet";
import { FigureImage } from "../../components/FigureImage";
import { figureAt } from "../../lib/figures";
import { Empty, ErrorFilterTags, Hint, MathText, Segmented, Tag, Verdict, applyErrorFilter, subjectColors, type ErrorFilter } from "../../components/ui";
import { retake } from "../../lib/capture";
import { groupBySection, paperErrors } from "../../lib/errors";
import { formatDateTime, unwrapLines } from "../../lib/format";
import { useDataVersion } from "../../lib/hooks";
import { gradeIfNeeded, isGrading, scanStageText } from "../../lib/jobs";
import { autoMark, paperQuality, paperStats, validDigitized } from "../../lib/logic";
import { mathPlain } from "../../lib/math";
import { deletePaper, getFolder, updatePaper } from "../../lib/store";
import type { DigitizedBlank, DigitizedBlock } from "../../lib/types";

type Tab = "paper" | "answers" | "errors";

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

/** 一张试卷的电子版：「试卷」干净原题，「作答」逐空对照，「错题」按试卷顺序 */
export default function PaperPage() {
  const { params } = useRouter();
  const folderId = params.folderId ?? "";
  const paperId = params.paperId ?? "";
  const [version, refresh] = useDataVersion();
  const folder = useMemo(() => getFolder(folderId), [folderId, version]);
  const paper = folder?.papers.find((p) => p.id === paperId);
  const digitized = paper ? validDigitized(paper.digitized) : null;
  const [tab, setTab] = useState<Tab>("paper");
  const [filter, setFilter] = useState<ErrorFilter>("all");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (paper) Taro.setNavigationBarTitle({ title: paper.name });
  }, [paper?.name]);
  useEffect(() => {
    if (folder && paper) void gradeIfNeeded(folder.id, paper);
  }, [paper?.id, Boolean(folder), Boolean(digitized)]);

  const errors = useMemo(() => (folder && paper ? paperErrors(folder, paper) : []), [folder, paper]);
  const shown = useMemo(() => applyErrorFilter(errors, filter), [errors, filter]);
  const groups = useMemo(() => groupBySection(shown), [shown]);

  if (!folder || !paper) return <Empty title="试卷不存在" />;
  const grading = isGrading(paper.id);

  const doRetake = async () => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["拍照", "从相册选（可多张，作为这张试卷的几页）"] });
    } catch {
      return;
    }
    await retake(folderId, paperId, r.tapIndex === 0 ? "camera" : "album");
    refresh();
  };

  if (!digitized) {
    return (
      <View className="page center-page">
        {paper.scanJob ? (
          <>
            <Text className="t-title3 b">正在扫描「{paper.name}」</Text>
            <View className="progress wide">
              <View className="progress__bar" style={{ width: `${Math.max(6, paper.scanJob.progress)}%` }} />
            </View>
            <Text className="t-sub c-sec center">{scanStageText(paper.scanJob)} · 在服务器上进行，切走也不影响，好了会自动显示</Text>
          </>
        ) : (
          <>
            <Text className="t-title3 b">{paper.scanError ? "扫描失败" : "还没扫描"}</Text>
            {paper.scanError && <Text className="t-sub c-sec center">{paper.scanError}</Text>}
            <View className="btn" onClick={doRetake}>
              重新拍 / 选照片扫描
            </View>
          </>
        )}
        <View className="btn btn--tinted" onClick={() => Taro.navigateBack()}>
          先回文件夹
        </View>
      </View>
    );
  }

  const stats = paperStats(paper);
  const quality = paperQuality(paper);
  const sheets = digitized.pages;
  const colors = subjectColors(digitized.questions[0]?.subject);

  const menu = async () => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["重新扫描 / 改照片", "查看原图", "重命名", "删除这张试卷"] });
    } catch {
      return;
    }
    if (r.tapIndex === 0) await doRetake();
    if (r.tapIndex === 1) void Taro.previewImage({ urls: paper.pages.map((p) => p.src), current: paper.pages[0]?.src });
    if (r.tapIndex === 2) {
      const m = await Taro.showModal({ title: "试卷名称", editable: true, content: paper.name });
      if (m.confirm && m.content?.trim()) updatePaper(folderId, paperId, { name: m.content.trim().slice(0, 30) });
      refresh();
    }
    if (r.tapIndex === 3) {
      const m = await Taro.showModal({ title: "删除这张试卷？", content: "照片和电子版会一起删掉。", confirmText: "删除", confirmColor: "#d92d20" });
      if (m.confirm) {
        deletePaper(folderId, paperId);
        Taro.navigateBack();
      }
    }
  };

  const printBlock = (block: DigitizedBlock, bi: number, si: number) => {
    switch (block.type) {
      case "figure": {
        const fig = figureAt(paper, si, bi);
        return fig ? <FigureImage key={bi} fig={fig} /> : null;
      }
      case "section":
        return (
          <View className="blk-section" key={bi}>
            <View className="row-center gap6">
              <View className="sec-bar" style={{ background: colors.color }} />
              <Text className="blk-section__title flex1">
                {block.label && `${block.label}. `}
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
                <PrintText text={unwrapLines(block.text)} blanks={block.blanks} />
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

  const paperTab = (
    <>
      <Hint>打印版只有原题，空格留白。手写和批改在「作答」里。</Hint>
      {sheets.map((sheet, si) => (
        <View className="sheet-paper" key={si}>
          <View className="sheet-paper__head">
            {sheet.title && <Text className="sheet-paper__title">{mathPlain(sheet.title)}</Text>}
            <View className="row-wrap t-cap c-sec">
              {sheet.label && <Text>{sheet.label}</Text>}
              {[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).length > 0 && <Text>{[sheet.region, sheet.examGrade, sheet.examLevel].filter(Boolean).join(" · ")}</Text>}
              {sheet.score && <Text className="c-wrong b">{sheet.score}</Text>}
            </View>
          </View>
          {sheet.blocks.map((b, bi) => printBlock(b, bi, si))}
          {sheet.note && <MathText className="t-cap c-sec" text={sheet.note} />}
        </View>
      ))}
    </>
  );

  const answersTab = (
    <>
      <Hint>学生手写内容的转写，与老师批改、正确答案逐空对照。空题按未作答计入错题。</Hint>
      {sheets.map((sheet, si) => {
        const rows = sheet.blocks.flatMap((b, bi) =>
          b.type === "passage" || b.type === "item" ? b.blanks.map((x) => ({ ...x, rowKey: `${bi}:${x.id}`, mark: autoMark(x.mark, x.student, x.answer, b.questionType) })) : [],
        );
        if (rows.length === 0) return null;
        return (
          <View className="card ans" key={si}>
            <View className="row-center">
              <Text className="t-headline flex1">{sheet.label || `第 ${sheet.page + 1} 页`}</Text>
              <Text className="t-cap c-sec">{rows.length} 个空</Text>
            </View>
            <View className="ans__row ans__row--head">
              <Text className="ans__num">题号</Text>
              <Text className="ans__hand">学生作答</Text>
              <Text className="ans__mark">判定</Text>
              <Text className="ans__answer">正确答案</Text>
            </View>
            {rows.map((b) => {
              const wrong = b.mark === "wrong" || b.mark === "partial";
              const sub = /-(\d+)$/.exec(b.id)?.[1];
              const note = b.note && b.note !== "未作答" ? b.note : "";
              return (
                <View className={`ans__item${wrong ? " ans__row--wrong" : ""}`} key={b.rowKey}>
                <View className="ans__row">
                  <Text className="ans__num">
                    {b.number || b.id.split("-")[0]}
                    {sub ? <Text className="ans__sub">({sub})</Text> : null}
                  </Text>
                  <View className="ans__hand">{b.student.trim() ? <MathText className={`hand${wrong ? " hand--wrong" : ""}`} text={b.student} /> : <Text>—</Text>}</View>
                  <View className="ans__mark">
                    <Verdict mark={b.mark} student={b.student} grading={grading} />
                  </View>
                  <View className="ans__answer">{b.mark === "correct" ? null : <MathText text={b.answer} />}</View>
                </View>
                {note && (
                  <View className="ans__note">
                    <Text className="ans__note-label">批注</Text>
                    <MathText text={note} />
                  </View>
                )}
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );

  const errorsTab = (
    <>
      <ErrorFilterTags value={filter} onChange={setFilter} counts={{ wrong: errors.filter((e) => e.kind !== "未作答").length, blank: errors.filter((e) => e.kind === "未作答").length }} />
      {errors.length === 0 ? (
        <Empty title="这张试卷没有错题，也没有空题" text="真棒。" />
      ) : shown.length === 0 ? (
        <Empty title="这一类没有题" />
      ) : (
        groups.map(([k, items]) => (
          <View key={k || "_"} className="col gap10">
            {k && (
              <Text className="t-headline section-title">
                {mathPlain(k)} · {items.length} 题
              </Text>
            )}
            {items.map((i) => (
              <ErrorCard key={i.key} item={i} showKnowledge />
            ))}
          </View>
        ))
      )}
    </>
  );

  return (
    <View className="page">
      <View className="row-center gap12">
        <Image className="thumb" src={paper.pages[0]?.src} mode="aspectFill" onClick={() => Taro.previewImage({ urls: paper.pages.map((p) => p.src) })} />
        <View className="flex1 col gap4 minw0">
          <Text className="t-title3 ellipsis b">{paper.name}</Text>
          {paper.scannedAt && <Text className="t-foot c-sec">扫描于 {formatDateTime(paper.scannedAt)}</Text>}
          <View className="row-wrap">
            <Tag kind="wrong">{stats.wrong} 错</Tag>
            {stats.blank > 0 && <Tag kind="pending">{stats.blank} 空</Tag>}
            <Tag kind="correct">{stats.correct} 对</Tag>
            <Tag>{sheets.length} 个卷面</Tag>
          </View>
        </View>
        <View className="icon-btn" onClick={menu}>
          ···
        </View>
      </View>
      {quality.warn && (
        <View className="quality-card">
          <View className="flex1 col gap4">
            <Text className="b">这张{quality.label}</Text>
            <Text className="t-foot">{quality.detail}。重拍一张清楚、完整的，识别和批改会更准。</Text>
          </View>
          <View className="btn btn--sm btn--tinted" onClick={doRetake}>
            重拍
          </View>
        </View>
      )}
      <Segmented value={tab} onChange={setTab} options={[{ value: "paper", label: "试卷" }, { value: "answers", label: "作答" }, { value: "errors", label: `错题 ${stats.problems}` }]} />

      {tab === "paper" && paperTab}
      {tab === "answers" && answersTab}
      {tab === "errors" && errorsTab}

      <View className="bottom-bar">
        <View className="btn btn--outline flex1" onClick={() => setExporting(true)}>
          导出这张
        </View>
        <View className={`btn flex13${stats.problems === 0 ? " btn--disabled" : ""}`} onClick={() => stats.problems > 0 && setTab("errors")}>
          看错题 · {stats.problems}
        </View>
      </View>

      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`${folder.name} · ${paper.name}`} subtitle={sheets.find((s) => s.syllabus)?.syllabus ? `按${sheets.find((s) => s.syllabus)!.syllabus}归类` : undefined} errors={errors} papers={[paper]} />
    </View>
  );
}
