import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ErrorCard, jumpToError } from "../../components/ErrorCard";
import { ExportSheet } from "../../components/ExportSheet";
import { Empty, ErrorFilterTags, Hint, Segmented, Sheet, SubjectTile, Tag, applyErrorFilter, subjectColors, type ErrorFilter } from "../../components/ui";
import { captureInto, type Source } from "../../lib/capture";
import { folderErrors, groupByKnowledge } from "../../lib/errors";
import { SUBJECTS, SUBJECT_LABEL, formatDate, formatDateTime } from "../../lib/format";
import { toast, useDataVersion } from "../../lib/hooks";
import { gradeIfNeeded, scanStageText } from "../../lib/jobs";
import { folderStats, paperQuality, paperStats, paperSubject } from "../../lib/logic";
import { deleteFolder, deletePaper, getFolder, movePaper, saveFolder, updatePaper, type Paper } from "../../lib/store";
import type { Subject } from "../../lib/types";

type Tab = "papers" | "errors";

/** 文件夹：这次考试的试卷 + 跨试卷合并、按知识点归类的错题汇总；底栏导出与加卷 */
export default function FolderPage() {
  const { params } = useRouter();
  const folderId = params.id ?? "";
  const [version, refresh] = useDataVersion();
  const folder = useMemo(() => getFolder(folderId), [folderId, version]);
  const [tab, setTab] = useState<Tab>("papers");
  const [addSheet, setAddSheet] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState<Subject | undefined>();
  const [subjectFilter, setSubjectFilter] = useState<Subject | null>(null);
  const [filter, setFilter] = useState<ErrorFilter>("all");

  useEffect(() => {
    if (folder) Taro.setNavigationBarTitle({ title: folder.name });
  }, [folder?.name]);
  // 有老师没批改的题：交给大模型补判（一张一张来）
  useEffect(() => {
    if (!folder) return;
    void (async () => {
      for (const p of folder.papers) await gradeIfNeeded(folder.id, p);
    })();
  }, [folder?.id]);

  const stats = useMemo(() => (folder ? folderStats(folder) : null), [folder]);
  const allErrors = useMemo(() => (folder ? folderErrors(folder) : []), [folder]);
  const errorSubjects = useMemo(() => [...new Set(allErrors.map((e) => e.subject))], [allErrors]);
  const errors = useMemo(() => (subjectFilter && errorSubjects.includes(subjectFilter) ? allErrors.filter((e) => e.subject === subjectFilter) : allErrors), [allErrors, subjectFilter, errorSubjects]);
  const shown = useMemo(() => applyErrorFilter(errors, filter), [errors, filter]);
  const groups = useMemo(() => groupByKnowledge(shown), [shown]);

  if (!folder || !stats) return <Empty title="文件夹不存在" />;

  const add = async (source: Source) => {
    setAddSheet(false);
    await captureInto(folder.id, source);
    refresh();
  };

  const openPaper = (p: Paper) => {
    if (p.scanJob) return toast(`${scanStageText(p.scanJob)}，好了会自动更新`);
    Taro.navigateTo({ url: `/pages/paper/index?folderId=${folder.id}&paperId=${p.id}` });
  };

  const paperMenu = async (p: Paper) => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["上移", "下移", "重命名", "删除"] });
    } catch {
      return;
    }
    if (r.tapIndex <= 1) movePaper(folder.id, p.id, r.tapIndex === 0 ? -1 : 1);
    if (r.tapIndex === 2) {
      const m = await Taro.showModal({ title: "试卷名称", editable: true, content: p.name });
      if (m.confirm && m.content?.trim()) updatePaper(folder.id, p.id, { name: m.content.trim().slice(0, 30) });
    }
    if (r.tapIndex === 3) {
      const m = await Taro.showModal({ title: "删除这张试卷？", content: "照片和电子版会一起删掉。", confirmText: "删除", confirmColor: "#d92d20" });
      if (m.confirm) deletePaper(folder.id, p.id);
    }
    refresh();
  };

  const folderMenu = async () => {
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: ["重命名", "改学科", "删除文件夹"] });
    } catch {
      return;
    }
    if (r.tapIndex === 0) {
      const m = await Taro.showModal({ title: "文件夹名称", editable: true, content: folder.name });
      if (m.confirm && m.content?.trim()) saveFolder({ ...folder, name: m.content.trim().slice(0, 30) });
      refresh();
    }
    if (r.tapIndex === 1) {
      setSubject(folder.subject ?? stats.subject ?? undefined);
      setEditing(true);
    }
    if (r.tapIndex === 2) {
      const m = await Taro.showModal({ title: `删除「${folder.name}」？`, content: `会删掉里面 ${folder.papers.length} 张试卷的照片和电子版，不能恢复。`, confirmText: "删除", confirmColor: "#d92d20" });
      if (m.confirm) {
        deleteFolder(folder.id);
        toast("已删除");
        Taro.navigateBack();
      }
    }
  };

  const papersTab = (
    <>
      {folder.papers.length === 0 && <Empty title="还没有试卷" text="拍一张或从相册选，扫描后错题会自动汇总。" />}
      {folder.papers.map((p) => {
        const st = paperStats(p);
        const q = paperQuality(p);
        return (
          <View key={p.id} className="card card--row" hoverClass="card--pressed" onClick={() => openPaper(p)} onLongPress={() => paperMenu(p)}>
            <Image className="thumb" src={p.pages[0]?.src} mode="aspectFill" />
            <View className="flex1 col gap4 minw0">
              <View className="row-center gap6">
                {paperSubject(p) && stats.subjects.length > 1 && <SubjectTile subject={paperSubject(p)} size="xs" />}
                <Text className="t-headline ellipsis">{p.name}</Text>
              </View>
              <Text className="t-foot c-sec">
                {p.pages.length} 张照片{st.scanned ? ` · ${st.total} 题` : ""} · {p.scannedAt ? `扫描于 ${formatDateTime(p.scannedAt)}` : `拍摄于 ${formatDate(p.createdAt)}`}
              </Text>
              <View className="row-wrap">
                {p.scanJob ? (
                  <>
                    <View className="progress flex1">
                      <View className="progress__bar" style={{ width: `${Math.max(6, p.scanJob.progress)}%` }} />
                    </View>
                    <Text className="t-cap c-brand b">{scanStageText(p.scanJob)}</Text>
                  </>
                ) : p.scanError ? (
                  <Tag kind="wrong">扫描失败 · 点开重扫</Tag>
                ) : st.scanned ? (
                  <>
                    <Tag kind="wrong">{st.wrong} 错</Tag>
                    {st.blank > 0 && <Tag kind="pending">{st.blank} 空</Tag>}
                    <Tag kind="correct">{st.correct} 对</Tag>
                    {q.warn && <Tag kind="pending">{q.label}</Tag>}
                  </>
                ) : (
                  <Tag kind="pending">待扫描</Tag>
                )}
              </View>
            </View>
          </View>
        );
      })}
      {folder.papers.length > 0 && <Hint>点一张试卷看电子版，长按可以排序、改名、删除。新加的试卷扫完会自动并进「错题汇总」。</Hint>}
    </>
  );

  const errorsTab = (
    <>
      {errorSubjects.length > 1 && (
        <View className="row-wrap">
          <View className={`chip${!subjectFilter ? " chip--on" : ""}`} onClick={() => setSubjectFilter(null)}>
            全部 {allErrors.length}
          </View>
          {errorSubjects.map((s) => (
            <View key={s} className={`chip${subjectFilter === s ? " chip--on" : ""}`} onClick={() => setSubjectFilter(s)}>
              <SubjectTile subject={s} size="xs" />
              <Text>
                {SUBJECT_LABEL[s]} {allErrors.filter((e) => e.subject === s).length}
              </Text>
            </View>
          ))}
        </View>
      )}
      <ErrorFilterTags value={filter} onChange={setFilter} counts={{ wrong: errors.filter((e) => e.kind !== "未作答").length, blank: errors.filter((e) => e.kind === "未作答").length }} />
      {errors.length === 0 && <Empty title={stats.unscanned > 0 ? "先扫描试卷" : "这个文件夹没有错题，也没有空题"} text={stats.unscanned > 0 ? "扫描后错题会自动出现在这里。" : "真棒。"} />}
      {groups.map(([k, items]) => {
        const blank = items.filter((i) => i.kind === "未作答").length;
        const papers = new Set(items.map((i) => i.paperId)).size;
        const c = subjectColors(items[0].subject);
        return (
          <View key={k} className="card">
            <View className="row-center gap12">
              <View className="kp-dot" style={{ background: c.bg, color: c.color }}>
                {k.slice(0, 1)}
              </View>
              <View className="flex1 col minw0">
                <Text className="t-headline">{k}</Text>
                <Text className="t-cap c-sec">
                  {items.length} 题{blank > 0 ? `（未作答 ${blank}）` : ""}
                  {papers > 1 ? ` · 来自 ${papers} 张试卷` : ""}
                </Text>
              </View>
              <Tag kind="wrong">{items.length}</Tag>
            </View>
            <View className="row-wrap">
              {items.map((i) => (
                <View key={i.key} className={`num-chip${i.kind === "未作答" ? " num-chip--blank" : ""}`} onClick={() => jumpToError(i.key)}>
                  {i.q.number}
                </View>
              ))}
            </View>
          </View>
        );
      })}
      {shown.length > 0 &&
        groups.map(([k, items]) => (
          <View key={`list-${k}`} className="col gap10">
            <Text className="t-headline section-title">
              {k} · {items.length} 题
            </Text>
            {items.map((i) => (
              <ErrorCard key={i.key} item={i} showSource={folder.papers.length > 1} />
            ))}
          </View>
        ))}
    </>
  );

  return (
    <View className="page">
      <View className="row-center gap12">
        <SubjectTile subject={stats.subject} size="lg" />
        <View className="flex1 col gap4 minw0">
          <Text className="t-title2 ellipsis b">{folder.name}</Text>
          <Text className="t-foot c-sec">{stats.exam || (stats.subject ? SUBJECT_LABEL[stats.subject] : "扫描后自动识别考试信息")}</Text>
        </View>
        <View className="icon-btn" onClick={folderMenu}>
          ···
        </View>
      </View>
      <View className="stats">
        <View className="stat">
          <Text className="stat__value c-wrong">{stats.wrong}</Text>
          <Text className="stat__label">错题</Text>
        </View>
        <View className="stat">
          <Text className="stat__value c-accent">{stats.blank}</Text>
          <Text className="stat__label">未作答</Text>
        </View>
      </View>
      <Segmented value={tab} onChange={setTab} options={[{ value: "papers", label: `试卷 ${stats.papers}` }, { value: "errors", label: `错题汇总 ${stats.problems}` }]} />

      {tab === "papers" ? papersTab : errorsTab}

      <View className="bottom-bar">
        <View className={`btn btn--outline flex1${stats.papers === 0 ? " btn--disabled" : ""}`} onClick={() => stats.papers > 0 && setExporting(true)}>
          导出
        </View>
        <View className="btn flex13" onClick={() => setAddSheet(true)}>
          {stats.papers ? "再拍一张" : "拍试卷"}
        </View>
      </View>

      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title="加一张试卷">
        <View className="btn" onClick={() => add("camera")}>
          拍照
        </View>
        <View className="btn btn--tinted" onClick={() => add("album")}>
          从相册选（可多选，一张照片一张试卷）
        </View>
      </Sheet>

      <Sheet open={editing} onClose={() => setEditing(false)} title="文件夹学科">
        <View className="row-wrap">
          {SUBJECTS.map((s) => (
            <View key={s} className={`chip${subject === s ? " chip--on" : ""}`} onClick={() => setSubject(subject === s ? undefined : s)}>
              <SubjectTile subject={s} size="xs" />
              <Text>{SUBJECT_LABEL[s]}</Text>
            </View>
          ))}
        </View>
        <View className="btn" onClick={() => { saveFolder({ ...folder, subject }); setEditing(false); refresh(); }}>
          保存
        </View>
      </Sheet>

      <ExportSheet
        open={exporting}
        onClose={() => setExporting(false)}
        title={subjectFilter ? `${folder.name} · ${SUBJECT_LABEL[subjectFilter]}` : folder.name}
        subtitle={stats.syllabus ? `按${stats.syllabus}归类` : stats.exam}
        errors={errors}
        papers={subjectFilter ? folder.papers.filter((p) => paperSubject(p) === subjectFilter) : folder.papers}
      />
    </View>
  );
}
