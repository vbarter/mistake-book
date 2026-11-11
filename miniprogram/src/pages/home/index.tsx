import { useEffect, useMemo, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { AvatarPrompt } from "../../components/AvatarPrompt";
import { Buddy } from "../../components/Buddy";
import { Icon } from "../../components/Icon";
import { Avatar, Progress, SubjectTile, Tag, TopBar } from "../../components/ui";
import { captureInto } from "../../lib/capture";
import { allErrors } from "../../lib/errors";
import { useDataVersion, useTabBar } from "../../lib/hooks";
import { analyze, inRange } from "../../lib/insights";
import { pollPendingJobs, scanStageText } from "../../lib/jobs";
import { currentUser, isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { PLANS_EVENT, teacherLine, dueLabel, fetchPlans, planIdleLabel, type PlanInfo, type PlanSummary } from "../../lib/plans";
import { listFolders } from "../../lib/store";
import { C } from "../../lib/theme";
import { useShare, useShareTimelineToo } from "../../lib/share";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页（和 App 一致）：顶部「今日安排」（学习计划、待办事项），中间小人用气泡说识别进度 / 近 30 天错题总结，
 * 底部两块大入口「错题收集」「试卷擦除」。导出错题本在「分析」页。
 */
export default function Home() {
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
  const hasPlans = !!plans && plans.owned + plans.joined > 0;
  // 卡片上的大数字：有待交先说待交，没有再说待批阅；两样都没有就说一共有多少份作业
  // （扫描的和上传文件的都算）。以前这时一直显示「0 份作业待交」，自己创建的计划里明明有作业也是 0。
  const planMode = plans && plans.todo > 0 ? "todo" : plans && plans.toReview > 0 ? "review" : "all";
  const planCount = !plans ? 0 : planMode === "todo" ? plans.todo : planMode === "review" ? plans.toReview : planList.reduce((n, p) => n + (p.assignments ?? 0), 0);
  const planUnit = planMode === "todo" ? "份 作业待交" : planMode === "review" ? "份 等你批阅" : "份 作业";
  // 首页直接列几个学习计划：有作业待交 / 待批阅的排前面，其余按新旧，最多 3 个（和 App 一致）
  const pending = (p: PlanInfo) => (p.role === "owner" ? p.toReview ?? 0 : p.todo ?? 0);
  const topPlans = [...planList].sort((a, b) => Number(pending(b) > 0) - Number(pending(a) > 0) || (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3);

  usePullDownRefresh(async () => {
    await pollPendingJobs();
    refresh();
    Taro.stopPullDownRefresh();
  });

  const errors = useMemo(() => allErrors(folders), [folders]);
  const recent = useMemo(() => analyze(inRange(errors, "30d")), [errors]);
  const papers = folders.flatMap((f) => f.papers.map((p) => ({ f, p })));
  const scanning = papers.filter(({ p }) => p.scanJob);
  const failed = papers.filter(({ p }) => p.scanError && !p.scanJob);
  const go = (url: string) => Taro.navigateTo({ url });

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

  return (
    <View className="home2">
      <AvatarPrompt version={version} />
      <TopBar>
        <View className="home2__logo">
          <Icon name="check" size={18} color="#ffffff" stroke={3} />
        </View>
        <Text className="home2__name">上壹课</Text>
        <Text className="home2__date">{today}</Text>
      </TopBar>

      <View className="plan rise">
        <View className="plan__top">
          <Text className="plan__title">今日安排</Text>
          <Text className="plan__sub">计划和作业，一眼看清</Text>
        </View>
        <View className="plan__cards">
          <View className="pc" hoverClass="pc--hover" onClick={() => go("/pages/plans/index")}>
            <View className="pc__h">
              <Text className="pc__t">学习计划</Text>
              {/* 右上角直接新建；卡片其余地方点了还是进计划列表（和 App 一致） */}
              <View className="pc__add" hoverClass="pc__add--hover" hoverStopPropagation onClick={(e) => (e.stopPropagation(), go("/pages/plan-new/index"))}>
                <Icon name="plus" size={12} color="#ffffff" stroke={3} />
                <Text>新建</Text>
              </View>
            </View>
            {hasPlans && plans ? (
              <>
                <View className="pc__big">
                  <Text className="pc__num">{planCount}</Text>
                  <Text>{planUnit}</Text>
                </View>
                <View className="pc__m">
                  {plans.todo > 0 && plans.nextSubject && plans.nextSubject !== "mixed" && <SubjectTile subject={plans.nextSubject} size="xs" className="pc__tile" />}
                  <Text className="ellipsis flex1">{plans.todo > 0 ? plans.nextTitle ?? "作业" : plans.owned > 0 ? `今天已交 ${plans.submittedToday} 份` : "作业都交了"}</Text>
                </View>
                {plans.todo > 0 && plans.nextDue && <Text className="pc__m pc__m--due">{dueLabel(plans.nextDue)} 截止</Text>}
              </>
            ) : (
              <>
                <Text className="pc__empty">还没有计划</Text>
                <Text className="pc__m pc__m--wrap">加入老师的计划，或自己建一个</Text>
              </>
            )}
          </View>
          {/* 待办事项还没做好：先占个位置，点了提示一下（和 App 一致） */}
          <View className="pc pc--tie" hoverClass="pc--hover" onClick={() => toast("待办事项还在开发中，过几天就能用了")}>
            <View className="pc__h">
              <Text className="pc__t">待办事项</Text>
              <Text className="tag tag--neutral">即将上线</Text>
            </View>
            <Text className="pc__empty">记下今天要做的事</Text>
            <Text className="pc__m pc__m--wrap">拍一张作业单，自动列成待办</Text>
          </View>
        </View>
        {topPlans.length > 0 && (
          <View className="plist">
            {topPlans.map((p) => (
              <View key={p.id} className="plist__row" hoverClass="plist__row--hover" onClick={() => go(`/pages/plan/index?id=${p.id}`)}>
                <Avatar name={p.teacher} url={p.teacherAvatar} size={36} />
                <View className="plist__main">
                  <Text className="plist__name ellipsis">{p.name}</Text>
                  <Text className="plist__sub ellipsis">
                    {teacherLine(p.teacher, p.subject)}
                  </Text>
                </View>
                {pending(p) > 0 ? (
                  <Tag kind={p.role === "owner" ? "info" : "pending"} icon={null}>
                    {p.role === "owner" ? `待批 ${pending(p)}` : `待交 ${pending(p)}`}
                  </Tag>
                ) : (
                  <Text className="plist__ok">{planIdleLabel(p)}</Text>
                )}
                <Icon name="chevron-right" size={13} color={C.tertiary} stroke={2.4} />
              </View>
            ))}
            {planList.length > topPlans.length && (
              <View className="plist__more" hoverClass="plist__row--hover" onClick={() => go("/pages/plans/index")}>
                <Text>全部 {planList.length} 个学习计划 ›</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <View className="hero2 rise rise--2">
        {scanning.length > 0 ? (
          <View className="bubble" onClick={() => go(`/pages/folder/index?id=${scanning[0].f.id}`)}>
            <Text className="bubble__small">
              正在识别 · {scanStageText(scanning[0].p.scanJob!)}
              {scanning.length > 1 ? ` · 共 ${scanning.length} 份` : ""}
            </Text>
            <Text className="bubble__text">「{scanning[0].p.name}」好了会自动归档。</Text>
            <Progress value={scanning[0].p.scanJob!.progress} style={{ marginTop: "8px" }} />
          </View>
        ) : failed.length > 0 ? (
          <View className="bubble" onClick={() => go(`/pages/paper/index?folderId=${failed[0].f.id}&paperId=${failed[0].p.id}`)}>
            <Text className="bubble__small" style={{ color: C.wrong }}>
              识别失败
            </Text>
            <Text className="bubble__text">「{failed[0].p.name}」没识别出来。</Text>
            <Text className="bubble__more">点开重新识别 ›</Text>
          </View>
        ) : recent.total > 0 ? (
          <View className="bubble" onClick={() => Taro.switchTab({ url: "/pages/rank/index" })}>
            <Text className="bubble__small">近 30 天 · {recent.total} 道错题</Text>
            <Text className="bubble__text">{recent.summary}</Text>
            <Text className="bubble__more">看错题榜 ›</Text>
          </View>
        ) : (
          <View className="bubble">
            <Text className="bubble__small">
              {hello}
              {nickname ? `，${nickname}` : ""}
            </Text>
            <Text className="bubble__text">{papers.length === 0 ? "点「错题收集」或下面的相机，拍下第一张试卷。" : "拍下新试卷，错题会自动整理。"}</Text>
          </View>
        )}
        <Buddy scene={scanning.length ? "scan" : "hero"} size={148} />
      </View>

      <View className="sheet2 rise rise--3">
        <View className="big">
          <View className="bt bt--a" hoverClass="bt--hover" onClick={collect}>
            <View className="bt__deco" />
            <View className="bt__ic">
              <Icon name="camera" size={25} color="#ffffff" stroke={2} />
            </View>
            <Text className="bt__t">错题收集</Text>
            <Text className="bt__s">拍试卷，错题自动整理</Text>
          </View>
          <View className="bt bt--b" hoverClass="bt--hover" onClick={erase}>
            <View className="bt__deco" />
            <View className="bt__ic">
              <Icon name="brush" size={25} color="#ffffff" stroke={2} />
            </View>
            <Text className="bt__t">试卷擦除</Text>
            <Text className="bt__s">擦掉手写，空白卷重练</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
