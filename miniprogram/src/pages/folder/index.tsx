import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ErrorCard, jumpToError } from "../../components/ErrorCard";
import { ExportSheet } from "../../components/ExportSheet";
import { AddSheet } from "../../components/AddSheet";
import { Icon } from "../../components/Icon";
import { Button, Empty, ErrorFilterTags, Hint, IconSegmented, KnowledgeIcon, Progress, Sheet, Stat, SubjectStack, SubjectTile, Tag, applyErrorFilter, type ErrorFilter } from "../../components/ui";
import { ensureLogin } from "../../lib/auth";
import { captureInto, type Source } from "../../lib/capture";
import { folderErrors, groupByKnowledge, groupBySection, knowledgeKey, paperErrors } from "../../lib/errors";
import { C } from "../../lib/theme";
import { SUBJECTS, SUBJECT_LABEL, formatDate, formatDateTime } from "../../lib/format";
import { toast, useDataVersion } from "../../lib/hooks";
import { gradeIfNeeded, scanStageText, tagIfNeeded } from "../../lib/jobs";
import { folderStats, paperQuality, paperStats, paperSubject } from "../../lib/logic";
import { deleteFolder, deletePaper, getFolder, movePaper, saveFolder, updatePaper, type Folder, type Paper } from "../../lib/store";
import type { Subject } from "../../lib/types";

type Tab = "papers" | "errors";

/** 文件夹（和 App 一致）：「目录」是自动生成的试卷目录（序号 · 卷头标题 · 大题与错题数），「错题汇总」跨试卷合并、按知识点归类；底栏导出与加卷。 */
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
      for (const p of folder.papers) {
        await gradeIfNeeded(folder.id, p);
        await tagIfNeeded(folder.id, p);
      }
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
  // 原题空白卷：没扫描的那边会引导去扫描；有插图的照片进去后在后台擦手写
  const openErase = async (p: Paper) => {
    if (p.scanJob) return toast(`${scanStageText(p.scanJob)}，扫好后就能导出空白卷`);
    if (!(await ensureLogin("擦除手写"))) return;
    Taro.navigateTo({ url: `/pages/erase/index?folderId=${folder.id}&paperId=${p.id}` });
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
      const m = await Taro.showModal({ title: "删除这张试卷？", content: "照片和电子版会一起删掉。", confirmText: "删除", confirmColor: "#b42323" });
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
      const m = await Taro.showModal({ title: `删除「${folder.name}」？`, content: `会删掉里面 ${folder.papers.length} 张试卷的照片和电子版，不能恢复。`, confirmText: "删除", confirmColor: "#b42323" });
      if (m.confirm) {
        deleteFolder(folder.id);
        toast("已删除");
        Taro.navigateBack();
      }
    }
  };

  const papersTab = (
    <>
      {folder.papers.length === 0 && <Empty icon="document" title="还没有试卷" text="拍一张或从相册选，扫描后错题会自动汇总。" />}
      {folder.papers.map((p, idx) => {
        const st = paperStats(p);
        const q = paperQuality(p);
        const outline = st.scanned ? outlineOf(folder, p) : [];
        return (
          <View key={p.id} className="card card--row" style={{ flexWrap: "wrap" }} hoverClass="card--pressed" onClick={() => openPaper(p)} onLongPress={() => paperMenu(p)}>
            <Text className="toc-num num">{String(idx + 1).padStart(2, "0")}</Text>
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
                    <Progress value={p.scanJob.progress} className="flex1" />
                    <Text className="t-cap c-brand b">{scanStageText(p.scanJob)}</Text>
                  </>
                ) : p.scanError ? (
                  <Tag kind="wrong" icon="warning">
                    扫描失败 · 点开重扫
                  </Tag>
                ) : st.scanned ? (
                  <>
                    <Tag kind="wrong">{st.wrong} 错</Tag>
                    {st.blank > 0 && (
                      <Tag kind="pending" icon="alert">
                        {st.blank} 空
                      </Tag>
                    )}
                    <Tag kind="correct">{st.correct} 对</Tag>
                    {p.duplicateOf && (
                      <Tag kind="neutral" icon="info">
                        {p.duplicateOf.kind === "retake" ? "重做" : "扫过了"}
                      </Tag>
                    )}
                  </>
                ) : (
                  <Tag kind="pending">待扫描</Tag>
                )}
              </View>
            </View>
            {p.scanJob && <Icon name="sparkles" size={20} color={C.brand} />}
            {!p.scanJob && q.warn && (
              <View className="quality-tag">
                <Icon name="alert" size={13} color={C.accentOn} stroke={2.4} />
                <Text>{q.label}</Text>
              </View>
            )}
            {/* 右侧「擦除手写」：打开原题空白卷；插图在后台擦手写时转圈 */}
            <View className={`erase-btn${p.scanJob ? " erase-btn--disabled" : ""}`} onClick={(e) => { e.stopPropagation(); openErase(p); }}>
              {p.eraseJob ? <View className="spinner" /> : <Icon name="brush" size={19} color={C.brand} stroke={2.2} />}
            </View>
            {outline.length > 0 && (
              <View className="outline">
                {outline.slice(0, 8).map((o) => (
                  <View key={o.label} className="outline__row">
                    <Text className="ellipsis flex1 minw0">{o.label}</Text>
                    {o.wrong > 0 ? <Text className="outline__wrong">{o.wrong} 错</Text> : <Icon name="check" size={12} color={C.ok} stroke={2.8} />}
                  </View>
                ))}
                {outline.length > 8 && <Text className="outline__row">还有 {outline.length - 8} 个大题</Text>}
              </View>
            )}
          </View>
        );
      })}
      {folder.papers.length > 0 && <Hint>点一张试卷看电子版，长按可以排序、改名、删除；右边的刷子导出去掉作答的原题空白卷。</Hint>}
    </>
  );

  const errorsTab = (
    <>
      {errorSubjects.length > 1 && (
        <View className="row-wrap" style={{ gap: "8px" }}>
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
      {errors.length === 0 && <Empty icon="seal" title={stats.unscanned > 0 ? "先扫描试卷" : "这个文件夹没有错题，也没有空题"} text={stats.unscanned > 0 ? "扫描后错题会自动出现在这里。" : undefined} />}
      {errors.length > 0 && shown.length === 0 && (
        <Empty icon="seal" title="这一类没有题">
          <Button size="xs" variant="plain" onClick={() => setFilter("all")}>
            看全部
          </Button>
        </Empty>
      )}
      {groups.map(([k, items]) => {
        const blank = items.filter((i) => i.kind === "未作答").length;
        const papers = new Set(items.map((i) => i.paperId)).size;
        return (
          <View key={knowledgeKey(items[0])} className="card" style={{ gap: "10px", padding: "12px 14px" }}>
            <View className="kp">
              <KnowledgeIcon name={k} subject={items[0].subject} />
              <View className="flex1 col gap2 minw0">
                <Text className="kp__name">{k}</Text>
                <Text className="kp__meta">
                  {items.length} 题{blank > 0 ? `（未作答 ${blank}）` : ""}
                  {papers > 1 ? ` · 来自 ${papers} 张试卷` : ""}
                </Text>
              </View>
              <Text className="tag tag--wrong xb">{items.length}</Text>
            </View>
            <View className="nums">
              {items.map((i) => (
                <View key={i.key} className={`num-chip${i.kind === "未作答" ? " num-chip--blank" : ""}`} onClick={() => jumpToError(i.key)}>
                  {i.q.number}
                </View>
              ))}
            </View>
          </View>
        );
      })}
      {shown.length > 0 && (
        <>
          <View className="row-center gap6" style={{ padding: "2px 4px 0" }}>
            <Icon name="list" size={16} color={C.label} stroke={2.2} />
            <Text className="t-sub b">逐题 · {shown.length}</Text>
          </View>
          {groups.map(([k, items]) => (
            <View key={`list-${knowledgeKey(items[0])}`} className="col gap10">
              <Text className="t-headline section-title">
                {k} · {items.length} 题
              </Text>
              {items.map((i) => (
                <ErrorCard key={i.key} item={i} showSource={folder.papers.length > 1} />
              ))}
            </View>
          ))}
        </>
      )}
    </>
  );

  return (
    <View className="page">
      <View className="row-center gap12">
        {stats.subjects.length > 1 ? <SubjectStack subjects={stats.subjects} /> : <SubjectTile subject={stats.subject} size="lg" />}
        <View className="flex1 col gap4 minw0">
          <Text className="t-title2 ellipsis xb">{folder.name}</Text>
          <View className="row-center gap4">
            <Icon name="pin" size={14} color={C.secondary} stroke={2} />
            <Text className="t-foot c-sec ellipsis">{stats.exam || (stats.subject ? SUBJECT_LABEL[stats.subject] : "扫描后自动识别考试信息")}</Text>
          </View>
        </View>
        <View className="icon-btn" onClick={folderMenu}>
          <Icon name="ellipsis" size={24} color={C.brand} />
        </View>
      </View>
      <View className="stats">
        <Stat label="错题" value={stats.wrong} icon="xcircle" color={C.wrong} />
        <Stat label="未作答" value={stats.blank} icon="alert" color={C.accentOn} />
      </View>
      <IconSegmented value={tab} onChange={setTab} options={[{ value: "papers", label: `目录 ${stats.papers}`, icon: "list" }, { value: "errors", label: `错题汇总 ${stats.problems}`, icon: "target" }]} />

      {tab === "papers" ? papersTab : errorsTab}

      <View className="bottom-bar">
        <Button variant="outline" icon="export" disabled={stats.papers === 0} style={{ flex: 1 }} onClick={() => setExporting(true)}>
          导出
        </Button>
        <Button icon="plus" style={{ flex: 1.3 }} onClick={() => setAddSheet(true)}>
          添加试卷
        </Button>
      </View>

      <AddSheet open={addSheet} onClose={() => setAddSheet(false)} onPick={add} />

      <Sheet open={editing} onClose={() => setEditing(false)} title="文件夹学科">
        <View className="row-wrap" style={{ gap: "8px" }}>
          {SUBJECTS.map((s) => (
            <View key={s} className={`chip${subject === s ? " chip--on" : ""}`} onClick={() => setSubject(subject === s ? undefined : s)}>
              <SubjectTile subject={s} size="xs" />
              <Text>{SUBJECT_LABEL[s]}</Text>
            </View>
          ))}
        </View>
        <Button onClick={() => { saveFolder({ ...folder, subject }); setEditing(false); refresh(); }}>保存</Button>
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

/** 一张试卷的目录：大题（卷面顺序）和每个大题里的错题数（和 App 一致） */
function outlineOf(folder: Folder, paper: Paper): { label: string; total: number; wrong: number }[] {
  const d = paper.digitized;
  if (!d) return [];
  const wrong = new Map(groupBySection(paperErrors(folder, paper)).map(([k, list]) => [k, list.length]));
  const out: { label: string; total: number; wrong: number }[] = [];
  for (const sheet of d.pages) {
    let current: { label: string; total: number; wrong: number } | null = null;
    for (const b of sheet.blocks) {
      if (b.type === "section") {
        const label = [b.label, b.title].filter(Boolean).join(" ");
        current = out.find((o) => o.label === label) ?? { label, total: 0, wrong: wrong.get(label) ?? 0 };
        if (!out.includes(current)) out.push(current);
      } else if (current && (b.type === "item" || b.type === "passage")) current.total += b.blanks.length;
    }
  }
  return out.filter((o) => o.label);
}
