import { useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { Buddy } from "../../components/Buddy";
import { ExportSheet } from "../../components/ExportSheet";
import { Icon, type IconName } from "../../components/Icon";
import { KnowledgeBars } from "../../components/Insights";
import { Button, Progress, TopBar } from "../../components/ui";
import { allErrors } from "../../lib/errors";
import { useDataVersion, useTabBar } from "../../lib/hooks";
import { analyze, inRange, since } from "../../lib/insights";
import { pollPendingJobs, scanStageText } from "../../lib/jobs";
import { getLastExportAt } from "../../lib/prefs";
import { currentUser } from "../../lib/auth";
import { listFolders } from "../../lib/store";
import { C } from "../../lib/theme";
import { useShare, useShareTimelineToo } from "../../lib/share";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页（和 App 一致）：问候、识别进度、近 30 天各学科薄弱知识点、导出错题本。
 * 导出按钮固定在 Tab 栏上方，知识点再多也不用滚到底才看得到。添加试卷走底栏中间的相机键。
 */
export default function Home() {
  useShare();
  useShareTimelineToo();
  useTabBar(0);
  const [version, refresh] = useDataVersion();
  const [exporting, setExporting] = useState(false);
  const folders = useMemo(() => listFolders(), [version, exporting]);
  const lastExport = useMemo(() => getLastExportAt(), [version, exporting]);
  const nickname = useMemo(() => currentUser()?.nickname ?? "", [version]);

  usePullDownRefresh(async () => {
    await pollPendingJobs();
    refresh();
    Taro.stopPullDownRefresh();
  });

  const errors = useMemo(() => allErrors(folders), [folders]);
  const recent = useMemo(() => analyze(inRange(errors, "30d")), [errors]);
  const fresh = useMemo(() => since(errors, lastExport), [errors, lastExport]);
  const papers = folders.flatMap((f) => f.papers.map((p) => ({ f, p })));
  const scanning = papers.filter(({ p }) => p.scanJob);
  const failed = papers.filter(({ p }) => p.scanError && !p.scanJob);
  const exportSet = fresh.length > 0 ? fresh : errors;
  const go = (url: string) => Taro.navigateTo({ url });

  const now = new Date();
  const eyebrow = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAY[now.getDay()]}`;
  const h = now.getHours();
  const hello = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";

  return (
    <View className={`page page--tab${errors.length > 0 ? " page--dock" : ""}`} style={{ gap: "16px", paddingTop: 0 }}>
      <TopBar>
        <Text className="topbar__text">{eyebrow}</Text>
      </TopBar>

      <View className="greet rise">
        <View className="greet__text">
          <Text className="t-title1">
            {hello}
            {nickname ? `，${nickname}` : ""}
          </Text>
          <Text className="t-sub c-sec">{papers.length === 0 ? "点下面的相机，拍下第一张试卷。" : scanning.length ? "试卷正在识别，好了会自动归档。" : "拍下新试卷，错题会自动整理。"}</Text>
        </View>
        <Buddy scene={scanning.length ? "scan" : "hero"} size={112} style={{ margin: "-8px -4px -12px 0" }} />
      </View>

      {(scanning.length > 0 || failed.length > 0) && (
        <View className="group rise rise--2">
          <View className="group__header">
            <Text>识别中</Text>
            <Text>完成后自动归档</Text>
          </View>
          {scanning.map(({ f, p }) => (
            <View key={p.id} className="list-row" hoverClass="list-row--hover" style={{ minHeight: "60px" }} onClick={() => go(`/pages/folder/index?id=${f.id}`)}>
              <Image className="thumb thumb--sm" src={p.pages[0]?.src} mode="aspectFill" />
              <View className="flex1 col gap4 minw0">
                <Text className="row__title ellipsis">{p.name}</Text>
                <Progress value={p.scanJob!.progress} />
              </View>
              <Text className="t-cap c-brand b">{scanStageText(p.scanJob!)}</Text>
            </View>
          ))}
          {failed.map(({ f, p }) => (
            <View key={p.id} className="list-row" hoverClass="list-row--hover" style={{ minHeight: "56px" }} onClick={() => go(`/pages/paper/index?folderId=${f.id}&paperId=${p.id}`)}>
              <View className="row__icon" style={{ background: C.wrong }}>
                <Icon name="warning" size={18} color="#ffffff" />
              </View>
              <View className="flex1 col gap2 minw0">
                <Text className="row__title ellipsis">{p.name}</Text>
                <Text className="row__sub">识别失败 · 点开重新识别</Text>
              </View>
              <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
            </View>
          ))}
        </View>
      )}

      {recent.total > 0 && (
        <View className="card rise rise--3" style={{ gap: "14px" }}>
          <View className="row-center" onClick={() => Taro.switchTab({ url: "/pages/rank/index" })}>
            <View className="flex1 col gap2 minw0">
              <Text className="t-foot c-sec b">近 30 天 · {recent.total} 道错题</Text>
              <Text className="t-body" style={{ fontWeight: 600 }}>
                {recent.summary}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={C.tertiary} stroke={2.4} />
          </View>
          <KnowledgeBars groups={recent.bySubject} />
        </View>
      )}

      {papers.length === 0 && (
        <View className="group rise rise--2">
          <View className="group__header">
            <Text>怎么用</Text>
          </View>
          {(
            [
              ["camera", "拍试卷", "拍照，或从相册一次选多张"],
              ["viewfinder", "自动识别", "还原题目和批改，按知识点归类"],
              ["chart", "看错题榜", "最近错在哪、哪个知识点该补"],
              ["printer", "导出错题本", "PDF，打印出来重做"],
            ] as [IconName, string, string][]
          ).map(([icon, t, s]) => (
            <View key={t} className="list-row" style={{ minHeight: "56px" }}>
              <View className="row__icon" style={{ background: C.brandTint }}>
                <Icon name={icon} size={18} color={C.brand} stroke={2.2} />
              </View>
              <View className="flex1 col gap2 minw0">
                <Text className="row__title">{t}</Text>
                <Text className="row__sub">{s}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {errors.length > 0 && (
        <View className="home-dock">
          <Button icon="printer" className="btn--glow rise rise--4" onClick={() => setExporting(true)}>
            {fresh.length > 0 && lastExport ? `导出新增的 ${fresh.length} 道错题` : `导出错题本（${errors.length} 题）`}
          </Button>
        </View>
      )}
      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={fresh.length > 0 && lastExport ? "新增错题" : "全部错题"} errors={exportSet} />
    </View>
  );
}
