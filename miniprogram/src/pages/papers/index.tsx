import { useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { AddSheet } from "../../components/AddSheet";
import { Buddy } from "../../components/Buddy";
import { Icon } from "../../components/Icon";
import { Button, Empty, SubjectTile, Tag, TopBar, WrongRing, subjectColors } from "../../components/ui";
import { captureInto, type Source } from "../../lib/capture";
import { folderErrors, groupByKnowledge, knowledgeKey } from "../../lib/errors";
import { SUBJECT_LABEL, formatDate } from "../../lib/format";
import { toast, useDataVersion, useTabBar } from "../../lib/hooks";
import { pollPendingJobs, scanStageText } from "../../lib/jobs";
import { folderStats } from "../../lib/logic";
import { deleteFolder, listFolders, moveFolder, saveFolder, type Folder } from "../../lib/store";
import { C, useThemeClass } from "../../lib/theme";
import { useShare, useShareTimelineToo } from "../../lib/share";

/** 试卷 Tab（和 App 一致）：一次考试一个文件夹，自动建、自动命名。添加试卷走底栏相机键，不用先选文件夹。 */
export default function Papers() {
  const tc = useThemeClass();
  useShare();
  useShareTimelineToo();
  useTabBar(1);
  const [version, refresh] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const [adding, setAdding] = useState(false);
  const paperCount = folders.reduce((n, f) => n + f.papers.length, 0);

  usePullDownRefresh(async () => {
    await pollPendingJobs();
    refresh();
    Taro.stopPullDownRefresh();
  });

  const add = async (source: Source) => {
    setAdding(false);
    const fid = await captureInto(null, source);
    refresh();
    if (fid) Taro.navigateTo({ url: `/pages/folder/index?id=${fid}` });
  };

  /** 长按：排序、重命名、删除（小程序里左滑、拖动容易和系统手势打架，用菜单代替） */
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
      const m = await Taro.showModal({ title: `删除「${f.name}」？`, content: `里面的 ${f.papers.length} 张试卷和错题会一起删掉，删了就找不回来了。`, confirmText: "删除", confirmColor: C.wrong });
      if (m.confirm) {
        deleteFolder(f.id);
        toast("已删除");
      }
    }
    refresh();
  };

  return (
    <View className={"page page--tab" + tc} style={{ paddingTop: 0 }}>
      <TopBar>
        <Text className="topbar__text">{`${folders.length} 个文件夹 · ${paperCount} 份试卷`}</Text>
        <Text className="topbar__hint flex1" style={{ textAlign: "right" }}>
          {folders.length ? "长按排序、改名、删除" : ""}
        </Text>
      </TopBar>

      {folders.length === 0 && (
        <Empty art={<Buddy scene="empty" size={150} />} title="还没有试卷" text="点下面中间的相机，拍下整页试卷或从相册多选，错题会自动按知识点归类。">
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            添加试卷
          </Button>
        </Empty>
      )}

      {folders.map((f, i) => {
        const st = folderStats(f);
        const groups = groupByKnowledge(folderErrors(f));
        const c = subjectColors(st.subject);
        const scanning = f.papers.filter((p) => p.scanJob).sort((a, b) => a.scanJob!.progress - b.scanJob!.progress)[0];
        const thumb = f.papers[0]?.pages[0]?.src;
        return (
          <View key={f.id} className={`card card--row rise${i < 4 ? ` rise--${i + 1}` : ""}`} style={{ padding: "14px 16px 14px 14px" }} hoverClass="card--pressed" onClick={() => Taro.navigateTo({ url: `/pages/folder/index?id=${f.id}` })} onLongPress={() => menu(f)}>
            {/* 左：缩略图 + 标题 + 知识点；右：错题环 / 扫描状态，在整张卡片里上下居中 */}
            <View className="flex1 col gap12 minw0">
              <View className="row-center gap12">
                <View className="thumb-wrap">
                  {thumb ? <Image className="thumb thumb--lg" src={thumb} mode="aspectFill" /> : <SubjectTile subject={st.subject} size="md" style={{ width: "48px", height: "60px", borderRadius: "10px" }} />}
                  {thumb && <SubjectTile subject={st.subject} size="xs" className="thumb-badge" style={{ position: "absolute" }} />}
                </View>
                <View className="flex1 col gap4 minw0">
                  <Text className="t-headline ellipsis b">
                    {f.name}
                    {st.subjects.length > 1 ? ` · ${st.subjects.map((s) => SUBJECT_LABEL[s]).join(" / ")}` : ""}
                  </Text>
                  <View className="row-center t-foot c-sec" style={{ gap: "10px" }}>
                    <View className="row-center gap4">
                      <Icon name="document" size={14} color={C.secondary} stroke={2} />
                      <Text>{f.papers.length} 张</Text>
                    </View>
                    <View className="row-center gap4">
                      <Icon name="clock" size={14} color={C.secondary} stroke={2} />
                      <Text>{formatDate(f.updatedAt)}</Text>
                    </View>
                  </View>
                </View>
              </View>
              <View className="row-wrap">
                {groups.slice(0, 2).map(([k, items]) => (
                  <Text key={knowledgeKey(items[0])} className="tag" style={{ background: c.bg, color: c.color }}>
                    {k} {items.length}
                  </Text>
                ))}
                {groups.length > 2 && <Tag kind="neutral">+{groups.length - 2}</Tag>}
                {groups.length === 0 && <Text className="t-foot c-sec">{st.unscanned > 0 ? `${st.unscanned} 张待扫描，扫完错题自动归到知识点` : "没有错题"}</Text>}
              </View>
            </View>
            <View className="row-center shrink0">
              {scanning ? (
                <Tag kind="info" icon="sparkles">
                  {scanStageText(scanning.scanJob!)}
                </Tag>
              ) : st.unscanned > 0 && st.problems === 0 ? (
                <Tag kind="accent" icon="viewfinder">
                  去扫描
                </Tag>
              ) : (
                <WrongRing wrong={st.problems} />
              )}
            </View>
          </View>
        );
      })}

      <AddSheet open={adding} onClose={() => setAdding(false)} onPick={add} />
    </View>
  );
}
