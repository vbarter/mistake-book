import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ErrorCard } from "../../components/ErrorCard";
import { ExportSheet } from "../../components/ExportSheet";
import { SubjectPicker } from "../../components/SubjectPicker";
import { PrintSheets } from "../../components/PrintSheets";
import { Icon } from "../../components/Icon";
import { Button, Empty, ErrorFilterTags, Hint, IconSegmented, MathText, Progress, Tag, Verdict, applyErrorFilter, type ErrorFilter } from "../../components/ui";
import { C } from "../../lib/theme";
import { retake, rotateAndRescan } from "../../lib/capture";
import { groupBySection, paperErrors } from "../../lib/errors";
import { SUBJECT_LABEL, formatDateTime } from "../../lib/format";
import { toast, useDataVersion } from "../../lib/hooks";
import { gradeIfNeeded, isGrading, notDuplicate, printIfNeeded, scanStageText, tagIfNeeded } from "../../lib/jobs";
import { autoMark, paperQuality, paperStats, validDigitized } from "../../lib/logic";
import { mathPlain } from "../../lib/math";
import { deletePaper, getFolder, updatePaper } from "../../lib/store";
import { useShare } from "../../lib/share";

type Tab = "paper" | "answers" | "errors";

/** 一张试卷的电子版：「试卷」干净原题，「作答」逐空对照，「错题」按试卷顺序 */
export default function PaperPage() {
  useShare();
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
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (paper) Taro.setNavigationBarTitle({ title: paper.name });
  }, [paper?.name]);
  useEffect(() => {
    if (folder && paper) void printIfNeeded(folder.id, paper).then((done) => (done ? refresh() : undefined)).then(() => gradeIfNeeded(folder.id, paper)).then(() => tagIfNeeded(folder.id, paper));
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

  /** 照片横着 / 倒着拍的：选个方向，把这张试卷的照片都转正，再扫一次 */
  const doRotate = async () => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["向右转 90°", "向左转 90°", "转 180°"] });
    } catch {
      return;
    }
    const turns = [1, 3, 2][r.tapIndex];
    if (!turns) return;
    await rotateAndRescan(folderId, paperId, turns);
    refresh();
  };

  if (!digitized) {
    return (
      <View className="page center-page">
        {paper.scanJob ? (
          <>
            <Icon name="sparkles" size={44} color={C.brand} />
            <Text className="t-title3">正在扫描「{paper.name}」</Text>
            <Progress value={paper.scanJob.progress} className="wide" />
            <Text className="t-sub c-sec center">{scanStageText(paper.scanJob)} · 在服务器上进行，切走也不影响，好了会自动显示</Text>
          </>
        ) : (
          <>
            <Icon name={paper.scanError ? "warning" : "viewfinder"} size={44} color={paper.scanError ? C.wrong : C.brand} />
            <Text className="t-title3">{paper.scanError ? "扫描失败" : "还没扫描"}</Text>
            {paper.scanError && <Text className="t-sub c-sec center">{paper.scanError}</Text>}
            <Button icon="camera" onClick={doRetake}>
              重新拍 / 选照片扫描
            </Button>
            {paper.pages.length > 0 && (
              <Button variant="tinted" icon="rotate" onClick={doRotate}>
                照片拍横了？转正再扫
              </Button>
            )}
          </>
        )}
        <Button variant="tinted" size="sm" onClick={() => Taro.navigateBack()}>
          先回文件夹
        </Button>
      </View>
    );
  }

  const stats = paperStats(paper);
  const quality = paperQuality(paper);
  const sheets = digitized.pages;

  const menu = async () => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["重新扫描 / 改照片", "旋转照片并重新扫描", "查看原图", "重命名", "改学科", "删除这张试卷"] });
    } catch {
      return;
    }
    if (r.tapIndex === 0) await doRetake();
    if (r.tapIndex === 1) await doRotate();
    if (r.tapIndex === 2) void Taro.previewImage({ urls: paper.pages.map((p) => p.src), current: paper.pages[0]?.src });
    if (r.tapIndex === 3) {
      const m = await Taro.showModal({ title: "试卷名称", editable: true, content: paper.name });
      if (m.confirm && m.content?.trim()) updatePaper(folderId, paperId, { name: m.content.trim().slice(0, 30) });
      refresh();
    }
    if (r.tapIndex === 4) setPicking(true);
    if (r.tapIndex === 5) {
      const m = await Taro.showModal({ title: "删除这张试卷？", content: "照片和电子版会一起删掉。", confirmText: "删除", confirmColor: "#b42323" });
      if (m.confirm) {
        deletePaper(folderId, paperId);
        Taro.navigateBack();
      }
    }
  };

  const paperTab = (
    <>
      <Hint icon="printer">这是打印版，空格留白。你的作答和老师批改在「作答」页。</Hint>
      <PrintSheets paper={paper} sheets={sheets} />
    </>
  );

  const answersTab = (
    <>
      <Hint icon="pencil">学生手写内容的转写，与老师批改、正确答案逐空对照。空题按未作答计入错题。</Hint>
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
        <Empty icon="seal" title="这张试卷没有错题，也没有空题" />
      ) : shown.length === 0 ? (
        <Empty icon="seal" title="这一类没有题">
          <Button size="xs" variant="plain" onClick={() => setFilter("all")}>
            看全部
          </Button>
        </Empty>
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
          <Text className="t-title3 ellipsis xb">{paper.name}</Text>
          {paper.scannedAt && (
            <View className="row-center gap4">
              <Icon name="clock" size={13} color={C.secondary} stroke={2} />
              <Text className="t-foot c-sec">扫描于 {formatDateTime(paper.scannedAt)}</Text>
            </View>
          )}
          <View className="row-wrap">
            <Tag kind="wrong">{stats.wrong} 错</Tag>
            {stats.blank > 0 && (
              <Tag kind="pending" icon="alert">
                {stats.blank} 空
              </Tag>
            )}
            <Tag kind="correct">{stats.correct} 对</Tag>
            <Tag kind="neutral" icon="document">
              {sheets.length} 个卷面
            </Tag>
          </View>
        </View>
        <View className="icon-btn" onClick={menu}>
          <Icon name="ellipsis" size={24} color={C.brand} />
        </View>
      </View>
      {quality.warn && (
        <View className="quality-card">
          <Icon name="alert" size={18} color={C.accentOn} stroke={2.2} />
          <View className="flex1 col gap4">
            <Text className="b">这张{quality.label}</Text>
            <Text className="t-foot">{quality.detail}。重拍一张清楚、完整的，识别和批改会更准。</Text>
          </View>
          <View className="btn btn--xs btn--tinted" onClick={doRetake}>
            重拍
          </View>
        </View>
      )}
      {paper.duplicateOf && !paper.keepDuplicate && (() => {
        const m = paper.duplicateOf;
        const other = `「${m.paperName}」`;
        const text =
          m.kind === "retake"
            ? `这是${other}重做的一遍，有 ${m.shared} 道题相同。两次都错的题会合并显示「错过 2 次」。`
            : m.kind === "partial"
              ? `这份是${other}其中几页又扫了一遍，${m.shared} 道题和作答都一样。这份的错题不再重复计入。`
              : `这份和${other}是同一份，作答也一样，可能扫了两次。这份的错题不再重复计入。`;
        const openOther = () => Taro.redirectTo({ url: `/pages/paper/index?folderId=${m.folderId}&paperId=${m.paperId}` });
        return (
          <View className="quality-card">
            <Icon name="info" size={18} color={C.accentOn} stroke={2.2} />
            <View className="flex1 col gap4">
              <Text className="b">{m.kind === "retake" ? "重做的试卷" : "扫过的试卷"}</Text>
              <Text className="t-foot">{text}{m.folderId !== folderId ? `（在「${m.folderName}」里）` : ""}</Text>
              <View className="row-wrap">
                {m.kind !== "retake" && (
                  <View className="btn btn--xs btn--tinted" onClick={() => { deletePaper(folderId, paperId); void openOther(); }}>删掉这份</View>
                )}
                <View className="btn btn--xs btn--tinted" onClick={() => { updatePaper(folderId, paperId, { keepDuplicate: true }); refresh(); }}>{m.kind === "retake" ? "知道了" : "两份都留"}</View>
                <View className="btn btn--xs btn--plain" onClick={() => { notDuplicate(folderId, paper); refresh(); }}>不是同一份</View>
              </View>
            </View>
          </View>
        );
      })()}
      <IconSegmented value={tab} onChange={setTab} options={[{ value: "paper", label: "试卷", icon: "document" }, { value: "answers", label: "作答", icon: "pencil" }, { value: "errors", label: `错题 ${stats.problems}`, icon: "xcircle" }]} />

      {tab === "paper" && paperTab}
      {tab === "answers" && answersTab}
      {tab === "errors" && errorsTab}

      <View className="bottom-bar">
        <Button variant="outline" icon="export" style={{ flex: 1 }} onClick={() => setExporting(true)}>
          导出这张
        </Button>
        <Button icon="xcircle" style={{ flex: 1.3 }} disabled={stats.problems === 0} onClick={() => setTab("errors")}>
          看错题 · {stats.problems}
        </Button>
      </View>

      <SubjectPicker
        paper={picking ? paper : null}
        onClose={() => setPicking(false)}
        onPick={(sub) => {
          setPicking(false);
          updatePaper(folderId, paperId, { subject: sub, subjectManual: true });
          toast(`已归到「${SUBJECT_LABEL[sub]}」`);
          refresh();
        }}
      />
            <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`${folder.name} · ${paper.name}`} subtitle={sheets.find((s) => s.syllabus)?.syllabus ? `按${sheets.find((s) => s.syllabus)!.syllabus}归类` : undefined} errors={errors} papers={[paper]} />
    </View>
  );
}
