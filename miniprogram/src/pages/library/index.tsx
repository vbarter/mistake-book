import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { ErrorCard } from "../../components/ErrorCard";
import { ExportSheet } from "../../components/ExportSheet";
import { Empty, Segmented, SubjectTile, Tag, subjectColors } from "../../components/ui";
import { allErrors, groupByKnowledge, groupByMonth, groupBySubject, type ErrorItem } from "../../lib/errors";
import { SUBJECT_LABEL } from "../../lib/format";
import { useDataVersion } from "../../lib/hooks";
import { listFolders } from "../../lib/store";
import type { Subject } from "../../lib/types";

type View_ = "subject" | "time";

/** 错题库：所有文件夹的错题。按学科：学科 → 知识点 → 题；按时间：月份 → 文件夹 → 题 */
export default function Library() {
  const [version] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const [view, setView] = useState<View_>("subject");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const errors = useMemo(() => allErrors(folders), [folders]);
  const bySubject = useMemo(() => groupBySubject(errors), [errors]);
  const byMonth = useMemo(() => groupByMonth(errors), [errors]);
  const activeSubject = subject && bySubject.some(([s]) => s === subject) ? subject : (bySubject[0]?.[0] ?? null);
  const activeMonth = month && byMonth.some(([m]) => m === month) ? month : (byMonth[0]?.[0] ?? null);
  const scoped: ErrorItem[] = view === "subject" ? errors.filter((e) => e.subject === activeSubject) : (byMonth.find(([m]) => m === activeMonth)?.[1] ?? []);
  const scopeLabel = view === "subject" ? (activeSubject ? SUBJECT_LABEL[activeSubject] : "全部") : (activeMonth ?? "全部");
  const syllabus = folders.flatMap((f) => f.papers).flatMap((p) => p.digitized?.pages ?? []).find((s) => s.syllabus)?.syllabus;

  const byFolder = useMemo(() => {
    const map = new Map<string, ErrorItem[]>();
    for (const e of scoped) map.set(e.folderId, [...(map.get(e.folderId) ?? []), e]);
    return [...map.entries()];
  }, [scoped]);

  if (errors.length === 0)
    return (
      <View className="page page--tab">
        <Empty title="还没有错题" text="扫描试卷后，判错的题会自动汇总到这里。" />
      </View>
    );

  const kpGroup = (items: ErrorItem[], subj: Subject) => {
    const groups = groupByKnowledge(items);
    const c = subjectColors(subj);
    return (
      <View className="card card--flush">
        <View className="row-center gap12 kp-head" style={{ background: c.bg }}>
          <SubjectTile subject={subj} size="sm" style={{ background: "#fff" }} />
          <View className="flex1 col">
            <Text className="t-headline" style={{ color: c.color }}>
              {SUBJECT_LABEL[subj]}
            </Text>
            <Text className="t-cap" style={{ color: c.color }}>
              {items.length} 题 · {groups.length} 个知识点 · 错得多的在前
            </Text>
          </View>
        </View>
        {groups.map(([k, list]) => {
          const key = `${subj}:${k}`;
          const open = openKey === key;
          const blank = list.filter((i) => i.kind === "未作答").length;
          return (
            <View key={k} className="kp-row-wrap">
              <View className={`list-row${open ? " list-row--open" : ""}`} onClick={() => setOpenKey(open ? null : key)}>
                <View className="kp-dot" style={{ background: c.bg, color: c.color }}>
                  {k.slice(0, 1)}
                </View>
                <View className="flex1 col">
                  <Text className="t-body">{k}</Text>
                  <Text className="t-cap c-sec">
                    来自 {new Set(list.map((i) => i.folderId)).size} 个文件夹{blank ? ` · 未作答 ${blank}` : ""}
                  </Text>
                </View>
                <Tag kind="wrong">{list.length}</Tag>
                <Text className="c-ter">{open ? "⌄" : "›"}</Text>
              </View>
              {open && (
                <View className="col gap10 kp-open">
                  {list.map((i) => (
                    <ErrorCard key={i.key} item={i} showSource />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View className="page page--tab">
      <View className="row-center gap12">
        <View className="flex1">
          <Segmented value={view} onChange={setView} options={[{ value: "subject", label: "按学科" }, { value: "time", label: "按时间" }]} />
        </View>
        <View className={`btn btn--sm btn--tinted${scoped.length === 0 ? " btn--disabled" : ""}`} onClick={() => scoped.length && setExporting(true)}>
          导出
        </View>
      </View>

      {view === "subject" && (
        <>
          <ScrollView scrollX className="hscroll" enhanced showScrollbar={false}>
            {bySubject.map(([s, list]) => {
              const c = subjectColors(s);
              const on = s === activeSubject;
              return (
                <View key={s} className="chip chip--big" style={{ background: on ? c.color : "#fff", color: on ? "#fff" : "#1c1c1e", borderColor: on ? c.color : "#ececf0" }} onClick={() => setSubject(s)}>
                  {SUBJECT_LABEL[s]} {list.length}
                </View>
              );
            })}
          </ScrollView>
          {activeSubject && kpGroup(scoped, activeSubject)}
        </>
      )}

      {view === "time" && (
        <>
          <ScrollView scrollX className="hscroll" enhanced showScrollbar={false}>
            {byMonth.map(([m, list]) => (
              <View key={m} className={`chip chip--big${m === activeMonth ? " chip--on" : ""}`} onClick={() => setMonth(m)}>
                {m} · {list.length}
              </View>
            ))}
          </ScrollView>
          {byFolder.map(([fid, list]) => {
            const f = folders.find((x) => x.id === fid);
            const key = `f:${fid}`;
            const open = openKey === key;
            return (
              <View key={fid} className="col gap10">
                <View className="card card--row" onClick={() => setOpenKey(open ? null : key)}>
                  <SubjectTile subject={list[0].subject} size="sm" />
                  <View className="flex1 col minw0">
                    <Text className="t-headline ellipsis">{f?.name ?? list[0].folderName}</Text>
                    <Text className="t-cap c-sec">
                      {new Set(list.map((i) => i.paperId)).size} 张试卷 · {list.length} 道错题
                    </Text>
                  </View>
                  <Tag kind="wrong">{list.length}</Tag>
                  <Text className="c-ter">{open ? "⌄" : "›"}</Text>
                </View>
                {open && (
                  <>
                    <Text className="t-foot c-brand b link" onClick={() => Taro.navigateTo({ url: `/pages/folder/index?id=${fid}` })}>
                      打开这个文件夹 ›
                    </Text>
                    {list.map((i) => (
                      <ErrorCard key={i.key} item={i} showSource />
                    ))}
                  </>
                )}
              </View>
            );
          })}
        </>
      )}

      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={`错题库 · ${scopeLabel}`} subtitle={syllabus ? `按${syllabus}归类` : undefined} errors={scoped} />
    </View>
  );
}
