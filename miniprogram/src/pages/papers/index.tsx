import { useMemo, useState } from "react";
import { Image, Input, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { captureInto, type Source } from "../../lib/capture";
import { folderErrors, groupByKnowledge } from "../../lib/errors";
import { SUBJECTS, SUBJECT_LABEL, formatDate } from "../../lib/format";
import { useDataVersion, toast } from "../../lib/hooks";
import { scanStageText, pollPendingJobs } from "../../lib/jobs";
import { folderStats } from "../../lib/logic";
import { createFolder, defaultFolderName, deleteFolder, listFolders, moveFolder, saveFolder, type Folder } from "../../lib/store";
import type { Subject } from "../../lib/types";
import { Empty, Sheet, SubjectTile, Tag, WrongRing, subjectColors } from "../../components/ui";

/** 试卷 Tab：一次考试一个文件夹；底栏拍试卷 / 相册多选（先选放进哪个文件夹） */
export default function Papers() {
  const [version, refresh] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const [pick, setPick] = useState<Source | null>(null);
  const [creating, setCreating] = useState<{ source: Source | null } | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState<Subject | undefined>();

  usePullDownRefresh(async () => {
    await pollPendingJobs();
    refresh();
    Taro.stopPullDownRefresh();
  });

  const shoot = async (folderId: string | null, source: Source) => {
    const fid = await captureInto(folderId, source);
    refresh();
    if (fid) Taro.navigateTo({ url: `/pages/folder/index?id=${fid}` });
  };

  const start = (source: Source) => {
    if (folders.length === 0) {
      setName(defaultFolderName());
      setSubject(undefined);
      setCreating({ source });
    } else setPick(source);
  };

  const confirmCreate = async () => {
    const f = createFolder(name || defaultFolderName(), subject);
    const src = creating?.source;
    setCreating(null);
    setPick(null);
    refresh();
    if (src) await shoot(f.id, src);
    else Taro.navigateTo({ url: `/pages/folder/index?id=${f.id}` });
  };

  /** 长按：排序、重命名、删除 */
  const menu = async (f: Folder) => {
    const items = ["上移", "下移", "重命名", "删除"];
    let r: { tapIndex: number };
    try {
      r = await Taro.showActionSheet({ itemList: items });
    } catch {
      return;
    }
    if (r.tapIndex === 0 || r.tapIndex === 1) moveFolder(f.id, r.tapIndex === 0 ? -1 : 1);
    if (r.tapIndex === 2) {
      const m = await Taro.showModal({ title: "文件夹名称", editable: true, content: f.name, placeholderText: f.name });
      if (m.confirm && m.content?.trim()) saveFolder({ ...f, name: m.content.trim().slice(0, 30) });
    }
    if (r.tapIndex === 3) {
      const m = await Taro.showModal({ title: `删除「${f.name}」？`, content: `里面的 ${f.papers.length} 张试卷和错题会一起删掉，删了就找不回来了。`, confirmText: "删除", confirmColor: "#d92d20" });
      if (m.confirm) {
        deleteFolder(f.id);
        toast("已删除");
      }
    }
    refresh();
  };

  return (
    <View className="page page--tab">
      <View className="head-row">
        <Text className="t-foot c-sec flex1">长按文件夹可以排序、改名、删除</Text>
        <View className="btn btn--sm btn--tinted" onClick={() => { setName(""); setSubject(undefined); setCreating({ source: null }); }}>
          + 新建文件夹
        </View>
      </View>

      {folders.length === 0 && <Empty title="还没有试卷" text="拍下整页试卷或从相册多选，会自动扫描成电子版，找出错题并按知识点归类。一次拍一页、让试卷铺满画面，图表和小字才认得清。" />}

      {folders.map((f) => {
        const st = folderStats(f);
        const groups = groupByKnowledge(folderErrors(f));
        const c = subjectColors(st.subject);
        const scanning = f.papers.filter((p) => p.scanJob).sort((a, b) => a.scanJob!.progress - b.scanJob!.progress)[0];
        const thumb = f.papers[0]?.pages[0]?.src;
        return (
          <View key={f.id} className="card card--row" hoverClass="card--pressed" onClick={() => Taro.navigateTo({ url: `/pages/folder/index?id=${f.id}` })} onLongPress={() => menu(f)}>
            <View className="flex1 col gap12 minw0">
              <View className="row-center gap12">
                <View className="thumb-wrap">
                  {thumb ? <Image className="thumb" src={thumb} mode="aspectFill" /> : <SubjectTile subject={st.subject} size="md" />}
                </View>
                <View className="flex1 col gap4 minw0">
                  <Text className="t-headline ellipsis b">
                    {f.name}
                    {st.subjects.length > 1 ? ` · ${st.subjects.map((s) => SUBJECT_LABEL[s]).join(" / ")}` : ""}
                  </Text>
                  <Text className="t-foot c-sec">
                    {f.papers.length} 张 · {formatDate(f.updatedAt)}
                  </Text>
                </View>
              </View>
              <View className="row-wrap">
                {groups.slice(0, 2).map(([k, items]) => (
                  <Text key={k} className="tag" style={{ background: c.bg, color: c.color }}>
                    {k} {items.length}
                  </Text>
                ))}
                {groups.length > 2 && <Tag>+{groups.length - 2}</Tag>}
                {groups.length === 0 && <Text className="t-foot c-sec">{st.unscanned > 0 ? `${st.unscanned} 张待扫描，扫完错题自动归到知识点` : "没有错题，真棒"}</Text>}
              </View>
            </View>
            <View className="row-center">
              {scanning ? <Tag kind="info">{scanStageText(scanning.scanJob!)}</Tag> : st.unscanned > 0 && st.problems === 0 ? <Tag kind="accent">去扫描</Tag> : <WrongRing wrong={st.problems} />}
            </View>
          </View>
        );
      })}

      <View className="bottom-bar">
        <View className="btn flex13" onClick={() => start("camera")}>
          拍试卷
        </View>
        <View className="btn btn--tinted flex1" onClick={() => start("album")}>
          相册
        </View>
      </View>

      <Sheet open={Boolean(pick)} onClose={() => setPick(null)} title="放进哪个文件夹？">
        <View className="group">
          {folders.map((f) => {
            const st = folderStats(f);
            return (
              <View key={f.id} className="list-row" onClick={() => { const s = pick!; setPick(null); void shoot(f.id, s); }}>
                <SubjectTile subject={st.subject} size="sm" />
                <View className="flex1 col minw0">
                  <Text className="t-body">{f.name}</Text>
                  <Text className="t-cap c-sec">{f.papers.length} 张试卷</Text>
                </View>
                <Text className="c-ter">›</Text>
              </View>
            );
          })}
        </View>
        <View className="btn btn--tinted" onClick={() => { setName(defaultFolderName()); setSubject(undefined); setCreating({ source: pick }); setPick(null); }}>
          + 新建文件夹
        </View>
      </Sheet>

      <Sheet open={Boolean(creating)} onClose={() => setCreating(null)} title="新建文件夹">
        <Input className="input" value={name} maxlength={30} placeholder={defaultFolderName()} onInput={(e) => setName(e.detail.value)} />
        <View className="row-wrap">
          {SUBJECTS.map((s) => (
            <View key={s} className={`chip${subject === s ? " chip--on" : ""}`} onClick={() => setSubject(subject === s ? undefined : s)}>
              <SubjectTile subject={s} size="xs" />
              <Text>{SUBJECT_LABEL[s]}</Text>
            </View>
          ))}
        </View>
        <Text className="t-foot c-sec">学科可以不选，扫描后会自动判断。</Text>
        <View className="btn" onClick={confirmCreate}>
          {creating?.source ? "建好并开始拍" : "建好"}
        </View>
      </Sheet>
    </View>
  );
}
