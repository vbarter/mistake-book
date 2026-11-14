import { useEffect, useMemo, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { AvatarPrompt } from "../../components/AvatarPrompt";
import { Buddy } from "../../components/Buddy";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon, base64 } from "../../components/Icon";
import { Avatar, Progress, SubjectTile, useMenuButton } from "../../components/ui";
import { hourMin, loadDay, nextTodo, tileSubject, useHomework } from "../../lib/homework";
import { captureInto } from "../../lib/capture";
import { useDataVersion, useTabBar } from "../../lib/hooks";
import { pollPendingJobs } from "../../lib/jobs";
import { currentUser, isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { MARK_REVIEWED, PLANS_EVENT, createdLabel, fetchPlans, type PlanInfo, type PlanSummary } from "../../lib/plans";
import { isScanErrorSeen, markScanErrorSeen } from "../../lib/scanNotice";
import { listFolders } from "../../lib/store";
import { C, useTheme, useThemeClass } from "../../lib/theme";
import { useShare, useShareTimelineToo } from "../../lib/share";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页（和 App 一致）：头图（问候、小人、一句提示），下面依次是两个入口「错题收集」「试卷擦除」、识别进度、
 * 没扫出来的小喇叭通知、学习计划（每个计划一行：名字、身份图标、创建时间）。错题统计和导出错题本在「分析」页。
 */
/** 头图上的装饰：几颗星星和淡淡的圆弧（画成背景图，靠左下角对齐） */
const HERO_DECO = (() => {
  const star = "M0-8l2.2 5.8L8 0 2.2 2.2 0 8l-2.2-5.8L-8 0l5.8-2.2z";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="236" viewBox="0 0 390 236" fill="none">` +
    `<path transform="translate(236 150)" d="${star}" fill="#ffc53d"/><path transform="translate(206 176) scale(.7)" d="${star}" fill="#fff" opacity=".5"/>` +
    `<path transform="translate(24 196) scale(.6)" d="${star}" fill="#fff" opacity=".35"/><path transform="translate(176 196) scale(.5)" d="${star}" fill="#ffc53d" opacity=".8"/>` +
    `<path d="M-10 226c60-34 120-34 190-8" stroke="#fff" stroke-opacity=".07" stroke-width="22" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;base64,${base64(svg)}`;
})();

export default function Home() {
  const tc = useThemeClass();
  const theme = useTheme();
  useShare();
  useShareTimelineToo();
  useTabBar(0);
  const [version, refresh] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const nickname = useMemo(() => currentUser()?.nickname ?? "", [version]);

  // 学习计划的汇总：没登录、没网时这一行照样在，只是不带数字
  const [plans, setPlans] = useState<PlanSummary | null>(null);
  const [planList, setPlanList] = useState<PlanInfo[]>([]);
  const [plansVersion, setPlansVersion] = useState(0);
  useEffect(() => {
    const on = () => setPlansVersion((x) => x + 1);
    Taro.eventCenter.on(PLANS_EVENT, on);
    return () => {
      Taro.eventCenter.off(PLANS_EVENT, on);
    };
  }, []);
  useEffect(() => {
    if (!isLoggedIn()) {
      setPlans(null);
      setPlanList([]);
      return;
    }
    fetchPlans()
      .then((r) => {
        setPlans(r.summary);
        setPlanList(r.plans);
      })
      .catch(() => undefined);
  }, [version, plansVersion]);
  // 首页直接列几个学习计划：有作业待交 / 待批阅的排前面，其余按新旧，最多 3 个（和 App 一致）
  const pending = (p: PlanInfo) => (p.role === "owner" ? (MARK_REVIEWED ? p.toReview ?? 0 : 0) : p.todo ?? 0);
  const topPlans = [...planList].sort((a, b) => Number(pending(b) > 0) - Number(pending(a) > 0) || (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3);

  usePullDownRefresh(async () => {
    await pollPendingJobs();
    refresh();
    Taro.stopPullDownRefresh();
  });

  const papers = folders.flatMap((f) => f.papers.map((p) => ({ f, p })));
  const scanning = papers.filter(({ p }) => p.scanJob);
  // 没扫出来、还没点开看过的：首页用小喇叭提醒，最近失败的排前面
  const [seenVersion, setSeenVersion] = useState(0);
  const failed = useMemo(
    () => papers.filter(({ p }) => p.scanError && !p.scanJob && !isScanErrorSeen(p)).sort((x, y) => ((x.p.scanErrorAt ?? x.p.updatedAt) < (y.p.scanErrorAt ?? y.p.updatedAt) ? 1 : -1)),
    [folders, seenVersion],
  );
  const go = (url: string) => Taro.navigateTo({ url });
  const openFailed = () => {
    const { f, p } = failed[0];
    markScanErrorSeen(p);
    setSeenVersion((x) => x + 1);
    go(`/pages/paper/index?folderId=${f.id}&paperId=${p.id}`);
  };

  const now = new Date();
  const h = now.getHours();
  const hello = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  const today = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAY[now.getDay()]}`;

  const collect = async () => {
    let r: Taro.showActionSheet.SuccessCallbackResult;
    try {
      r = await Taro.showActionSheet({ itemList: ["拍照", "从相册选"] });
    } catch {
      return;
    }
    try {
      const fid = await captureInto(null, r.tapIndex === 0 ? "camera" : "album");
      if (fid) go(`/pages/folder/index?id=${fid}`);
    } catch (e) {
      toast(String((e as Error).message || e));
    }
  };

  // 试卷擦除：从最近的试卷里挑一份去擦；一份都没有就先去拍
  const erase = async () => {
    const recentPapers = papers
      .filter(({ p }) => !p.scanJob)
      .sort((x, y) => (x.p.createdAt < y.p.createdAt ? 1 : -1))
      .slice(0, 6);
    if (recentPapers.length === 0) return toast(papers.length ? "试卷还在识别，好了再来擦" : "先拍一份试卷，再来擦掉手写");
    try {
      const r = await Taro.showActionSheet({ alertText: "擦哪一份试卷", itemList: recentPapers.map(({ p }) => p.name.slice(0, 20)) });
      const { f, p } = recentPapers[r.tapIndex];
      go(`/pages/erase/index?folderId=${f.id}&paperId=${p.id}`);
    } catch {
      /* 取消 */
    }
  };

  const mb = useMenuButton();
  // 头图里那颗提示：有作业先说作业，一份试卷都没有时提醒拍第一张
  const pill = plans && plans.todo > 0 ? { n: plans.todo, text: "份作业待交", go: () => go("/pages/plans/index") }
    : MARK_REVIEWED && plans && plans.toReview > 0 ? { n: plans.toReview, text: "份等你批阅", go: () => go("/pages/plans/index") }
    : papers.length === 0 ? { n: 0, text: "拍下第一张试卷", go: collect }
    : null;

  // 计划行只留头像、名字、身份图标和创建时间：状态文字和右边的进度标记都拿掉了，进计划里再看
  const planRow = (p: PlanInfo) => {
    const owner = p.role === "owner";
    const created = createdLabel(p.createdAt);
    return (
      <View key={p.id} className="h4__plan" hoverClass="h4--hover" onClick={() => go(`/pages/plan/index?id=${p.id}`)}>
        <Avatar name={p.teacher} url={p.teacherAvatar} size={44} />
        <View className="h4__main">
          <Text className="h4__name ellipsis">{p.name}</Text>
          <View className="h4__sub">
            {/* 插旗是我建的，进门是我加入的 */}
            <ColorIcon name={owner ? "plan-mine" : "plan-joined"} size={18} />
            <Text className="h4__time ellipsis">{created || (owner ? "我建的" : p.teacher)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className={"home4" + tc}>
      <AvatarPrompt version={version} />
      <View className="h4__hero" style={{ height: `${mb.bottom + 148}px`, paddingTop: `${mb.top}px`, backgroundImage: `url("${HERO_DECO}"), linear-gradient(160deg, var(--hero-a) 0%, var(--hero-b) 70%)` }}>
        <View className="h4__spot" />
        <Buddy scene={scanning.length ? "scan" : papers.length === 0 ? "empty" : "hero"} size={150} style={{ position: "absolute", right: "8px", bottom: "30px" }} />
        <View className="h4__brand" style={{ height: `${mb.height}px` }}>
          <View className="h4__logo">
            <Icon name="check" size={17} color={theme === "pop" ? "#fb7299" : "#1f3b73"} stroke={3} />
          </View>
          <Text className="h4__bname">上壹课</Text>
          <Text className="h4__date">{today}</Text>
        </View>
        <Text className="h4__hi ellipsis">
          {hello}
          {nickname ? `，${nickname}` : ""}
        </Text>
        {pill && (
          <View className="h4__pill" hoverClass="h4--hover" onClick={pill.go}>
            <View className="h4__pilln">{pill.n > 0 ? <Text>{pill.n}</Text> : <Icon name="camera" size={12} color="#5a3600" stroke={2.6} />}</View>
            <Text>{pill.text}</Text>
          </View>
        )}
      </View>

      <View className="h4">
        <View className="h4__acts rise">
          <View className="h4__act h4__act--a" hoverClass="h4--hover" onClick={collect}>
            <ColorIcon name="collect" size={72} className="h4__art" />
            <Text className="h4__actt">错题收集</Text>
          </View>
          <View className="h4__act h4__act--b" hoverClass="h4--hover" onClick={erase}>
            <ColorIcon name="erase" size={72} className="h4__art" />
            <Text className="h4__actt">试卷擦除</Text>
          </View>
        </View>

        {scanning.length > 0 && (
          <View className="h4__card rise rise--1" hoverClass="h4--hover" onClick={() => go(`/pages/folder/index?id=${scanning[0].f.id}`)}>
            <ColorIcon name="scan" size={44} />
            <View className="h4__main">
              <Text className="h4__name ellipsis">正在识别 {scanning[0].p.name}</Text>
              <Progress value={scanning[0].p.scanJob!.progress || 0} style={{ marginTop: "6px" }} />
            </View>
            <Text className="h4__pct">{Math.round(scanning[0].p.scanJob!.progress || 0)}%</Text>
          </View>
        )}

        {/* 没扫出来的试卷：一行小喇叭通知，点开去看那张试卷，看过就不再提醒（还有别的失败会接着提醒下一张） */}
        {failed.length > 0 && (
          <View className="h4__notice rise rise--1" hoverClass="h4--hover" onClick={openFailed}>
            <ColorIcon name="horn" size={24} />
            <Text className="h4__noticet ellipsis">
              「{failed[0].p.name}」{failed.length > 1 ? `等 ${failed.length} 张` : ""}没扫出来
            </Text>
            <Text className="h4__noticea">查看</Text>
            <Icon name="chevron-right" size={12} color={C.tertiary} stroke={2.4} />
          </View>
        )}

        <HomeworkCard />

        <View className="rise rise--2">
          <View className="h4__sech">
            <Text className="h4__sect" onClick={() => go("/pages/plans/index")}>学习计划</Text>
            <View className="h4__add" hoverClass="h4--hover" onClick={() => go("/pages/plan-new/index")}>
              <Icon name="plus" size={13} color="#ffffff" stroke={3} />
              <Text>新建</Text>
            </View>
          </View>
          <View className="h4__plans">
            {topPlans.length > 0 ? (
              topPlans.map(planRow)
            ) : (
              <View className="h4__empty" hoverClass="h4--hover" onClick={() => go("/pages/plans/index")}>
                <ColorIcon name="plan" size={40} />
                <Text>还没有学习计划</Text>
              </View>
            )}
            {planList.length > topPlans.length && (
              <View className="h4__more" hoverClass="h4--hover" onClick={() => go("/pages/plans/index")}>
                <Text>全部 {planList.length} 个 ›</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

/** 首页的「今天作业计划」卡片（和 App 一致）：没有事项时引导添加；做到一半显示进度和下一项；做完了显示用时 */
function HomeworkCard() {
  const { data } = useHomework();
  useDidShow(() => {
    if (isLoggedIn()) loadDay().catch(() => undefined);
  });
  const today = data && data.day === data.today ? data : null;
  const s = today?.summary;
  const next = today ? (today.items.find((it) => it.id === s?.currentId) ?? (s?.nextId ? today.items.find((it) => it.id === s.nextId) : null) ?? nextTodo(today.items)) : null;
  const sub = !s || !s.total ? "打一句、拍一张，自动列清单" : s.allDone ? `${s.total} 项全做完了 · 用了 ${hourMin(s.used)}` : `做完 ${s.done} 项，还剩 ${s.left} 项`;
  const go = !s || !s.total ? "添加" : s.allDone ? "看看" : s.done || s.currentId ? "继续" : "查看";
  return (
    <View className="h4__hw rise rise--1" hoverClass="card--pressed" onClick={() => void Taro.navigateTo({ url: "/pages/homework/index" })}>
      <View className="h4__hwtop">
        <ColorIcon name="todo" size={40} />
        <View className="minw0 flex1">
          <Text className="h4__hwb">今天作业计划</Text>
          <Text className="h4__hws ellipsis">{sub}</Text>
        </View>
        <View className="h4__hwgo">
          <Text className="h4__hwgot">{go}</Text>
          <Icon name="chevron-right" size={12} color="#ffffff" stroke={2.6} />
        </View>
      </View>
      {s && s.total > 0 && !s.allDone && (
        <View className="hw-bar" style={{ margin: 0 }}>
          <View className="hw-bar__in" style={{ width: `${(s.done / s.total) * 100}%` }} />
        </View>
      )}
      {next && s && !s.allDone && (
        <View className="h4__hwnext">
          <SubjectTile subject={tileSubject(next.subject)} size="xs" />
          <Text className="ellipsis flex1">
            {next.status === "todo" ? "下一项" : "正在做"} {next.title}
          </Text>
          {next.status === "todo" && next.remindAt && (
            <View className="hw-rmd">
              <ColorIcon name="remind" size={18} />
              <Text>{next.remindAt}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
