import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { AvatarPrompt } from "../../components/AvatarPrompt";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon, base64 } from "../../components/Icon";
import { Progress, SubjectTile, subjectColors, useMenuButton } from "../../components/ui";
import type { ThemeName } from "../../lib/colorIcons";
import { allErrors } from "../../lib/errors";
import { SUBJECT_LABEL } from "../../lib/format";
import { loadDay, nextTodo, tileSubject, useHomework, type HwCheckin } from "../../lib/homework";
import { analyze, inRange } from "../../lib/insights";
import { roleIconSvg, type RoleName } from "../../lib/roleIcons";
import { captureInto } from "../../lib/capture";
import { useDataVersion, useTabBar } from "../../lib/hooks";
import { pollPendingJobs } from "../../lib/jobs";
import { isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { MARK_REVIEWED, PLANS_EVENT, fetchPlans, type PlanSummary } from "../../lib/plans";
import { isScanErrorSeen, markScanErrorSeen } from "../../lib/scanNotice";
import { listFolders } from "../../lib/store";
import { C, useTheme, useThemeClass } from "../../lib/theme";
import { useShare, useShareTimelineToo } from "../../lib/share";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页（和 App 一致，界面稿见项目文件 screenshots/home-blackboard/）：顶部品牌名、「今天，学一点」和连续打卡天数；本周打卡条；
 * 四块黑板入口「待办事项」「学习计划」「错题收集」「试卷擦除」（板面颜色跟主题走，粉笔字是 assets/chalk/ 里烘好的透明图，小人是 lib/roleIcons.ts 的角色图标）；
 * 下面是识别进度、没扫出来的小喇叭通知、今天作业计划的下一项、近 30 天错题数。打卡：当天作业计划全部做完算打一次卡（GET /api/homework 带的 checkin）。
 */
export default function Home() {
  const tc = useThemeClass();
  useShare();
  useShareTimelineToo();
  useTabBar(0);
  const [version, refresh] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);

  // 学习计划的汇总：没登录、没网时这一行照样在，只是不带数字
  const [plans, setPlans] = useState<PlanSummary | null>(null);
  const [planCount, setPlanCount] = useState<number | null>(null);
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
      setPlanCount(null);
      return;
    }
    fetchPlans()
      .then((r) => {
        setPlans(r.summary);
        setPlanCount(r.plans.length);
      })
      .catch(() => undefined);
  }, [version, plansVersion]);
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
  const theme = useTheme();
  // 黑板做成正方形：两块并排，屏宽减去两边 16 和中间 12
  const boardH = Math.min(200, Math.round((Taro.getSystemInfoSync().windowWidth - 44) / 2));

  // 错题：近 30 天几道、错得最多的三科（和「分析」页同一套算法），本周一以来新收了几道
  const errors = useMemo(() => allErrors(folders), [folders]);
  const month = useMemo(() => inRange(errors, "30d"), [errors]);
  const topSubjects = useMemo(() => analyze(month).subjects.slice(0, 3), [month]);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const weekNew = errors.filter((e) => new Date(e.scannedAt).getTime() >= monday).length;

  const { data: hw } = useHomework();
  useDidShow(() => {
    if (isLoggedIn()) loadDay().catch(() => undefined); // 打卡和下一项都从这里来
  });
  const hs = hw && hw.day === hw.today ? hw.summary : null;
  const checkin = (isLoggedIn() && hw?.checkin) || null;

  // 四块黑板右下角的粉笔圈：一个最要紧的数
  const todoBadge = !hs || !hs.total ? "去添加" : hs.allDone ? "全做完" : <>还剩<Text className="bb__numb">{hs.left}</Text>项</>;
  const planBadge = plans && plans.todo > 0 ? <><Text className="bb__numb">{plans.todo}</Text>份待交</>
    : MARK_REVIEWED && plans && plans.toReview > 0 ? <><Text className="bb__numb">{plans.toReview}</Text>份待批</>
    : planCount ? <><Text className="bb__numb">{planCount}</Text>个计划</>
    : planCount === 0 ? "去新建" : null;
  const wrongBadge = weekNew > 0 ? <>本周<Text className="bb__numb">+{weekNew}</Text></> : "拍一张";
  const goHomework = () => go("/pages/homework/index");

  return (
    <View className={"home4" + tc}>
      <AvatarPrompt version={version} />
      <View className="hb__head" style={{ paddingTop: `${mb.top}px` }}>
        <View className="hb__brand" style={{ height: `${mb.height}px` }}>
          <View className="hb__logo">
            <Icon name="check" size={18} color="#ffffff" stroke={3} />
          </View>
          <Text className="hb__name">上壹课</Text>
          <Text className="hb__date">{today}</Text>
        </View>
        <View className="hb__row">
          <View className="hb__slogan">
            <Text>今天，学一点</Text>
            <Image className="hb__swoosh" src={swooshUri(theme)} mode="aspectFit" />
          </View>
          <View className="hb__streak" hoverClass="h4--hover" onClick={goHomework}>
            <Icon name="sparkles" size={15} color={C.tie} stroke={2.2} />
            {checkin && checkin.streak > 0 ? (
              <Text>
                连续打卡 <Text className="hb__streakb">{checkin.streak}</Text> 天
              </Text>
            ) : (
              <Text>今天来打卡</Text>
            )}
          </View>
        </View>
      </View>

      <View className="hb">
        <WeekStrip checkin={checkin} now={now} onClick={goHomework} />

        <View className="hb__grid rise">
          <Board role="todo" doodle="sun" badge={todoBadge} height={boardH} onClick={goHomework} />
          <Board role="plan" doodle="star" badge={planBadge} height={boardH} onClick={() => go("/pages/plans/index")} />
          <Board role="wrong" doodle="star" badge={wrongBadge} height={boardH} onClick={collect} />
          <Board role="erase" doodle="sun" math="6 ÷ 2 =" height={boardH} onClick={erase} />
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

        <NextUp />

        <View className="hb__stat rise rise--2" hoverClass="h4--hover" onClick={() => void Taro.switchTab({ url: "/pages/rank/index" })}>
          <Text className="hb__statn">{month.length}</Text>
          <View className="hb__statt">
            <Text>道错题</Text>
            <Text className="hb__stats ellipsis">{month.length ? `近 30 天 · ${topSubjects.map(([s, l]) => `${SUBJECT_LABEL[s]} ${l.length}`).join(" · ")}` : "近 30 天没有新错题"}</Text>
          </View>
          {topSubjects.length > 0 && (
            <View className="hb__bars">
              {topSubjects.map(([s, l]) => (
                <View key={s} className="hb__bar" style={{ height: `${Math.max(6, Math.round((l.length / topSubjects[0][1].length) * 30))}px`, background: subjectColors(s).color }} />
              ))}
            </View>
          )}
          <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
        </View>
      </View>
    </View>
  );
}

const DAY_MS = 86400000;

/** 「今天，学一点」下面那道领带色的弧线 */
const swooshUri = (theme: string) =>
  `data:image/svg+xml;base64,${base64(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="7" viewBox="0 0 56 7" fill="none"><path d="M2 5C14 1.5 34 1 54 3.5" stroke="${theme === "pop" ? "#0095c8" : "#a3303f"}" stroke-width="2.4" stroke-linecap="round"/></svg>`)}`;

/** 本周打卡条（和 App 一致）：周一到周日，打了卡的打勾，今天高亮。没登录、没网时七天都空着 */
function WeekStrip({ checkin, now, onClick }: { checkin: HwCheckin | null; now: Date; onClick: () => void }) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const todayIdx = (now.getDay() + 6) % 7;
  return (
    <View className="hb__wk" hoverClass="h4--hover" onClick={onClick}>
      <View className="hb__wkl">
        <Text className="hb__wkls">本周打卡</Text>
        <Text className="hb__wklb">
          <Text className="hb__wkli">{checkin?.weekDone ?? 0}</Text>天
        </Text>
      </View>
      <View className="hb__wkdays">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday.getTime() + i * DAY_MS);
          const done = !!checkin?.week[i]?.done;
          const today = i === todayIdx;
          const cls = [today && "today", done && "done", i > todayIdx && "later"].filter(Boolean).join(" ");
          return (
            <View key={i} className={`hb__wkd ${cls}`}>
              <View className="hb__wkc">{done ? <Icon name="check" size={14} color={today ? "#ffffff" : C.brand} stroke={3} /> : <Text>{d.getDate()}</Text>}</View>
              <Text>{today ? "今天" : WEEKDAY[(i + 1) % 7]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const DOODLE = {
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>`,
};
const doodleUri = (k: keyof typeof DOODLE) => `data:image/svg+xml;base64,${base64(DOODLE[k])}`;
const roleCache = new Map<string, string>();
function roleUri(role: RoleName, theme: ThemeName): string {
  const key = `${theme}|${role}`;
  let u = roleCache.get(key);
  if (!u) {
    u = `data:image/svg+xml;base64,${base64(roleIconSvg(role, theme, false, false))}`; // 图里没有中文，可以直接用最简单的 base64
    roleCache.set(key, u);
  }
  return u;
}

/** 一块黑板（和 App 一致）：粉笔字（烘好的图）、角落的小涂鸦、左下角的角色小人、右下角粉笔圈里一个数 */
function Board({ role, doodle, badge, math, height, onClick }: { role: RoleName; doodle: keyof typeof DOODLE; badge?: ReactNode; math?: string; height: number; onClick: () => void }) {
  const theme = useTheme();
  return (
    <View className="bb" style={{ height: `${height}px` }} hoverClass="bb--hover" onClick={onClick}>
      <View className="bb__face">
        <Image className="bb__tag" src="/assets/chalk/tag.png" mode="aspectFit" />
        <Image className={`bb__doodle bb__doodle--${doodle}`} src={doodleUri(doodle)} mode="aspectFit" />
        <Image className="bb__chalk" src={`/assets/chalk/${role}.png`} mode="aspectFit" />
        {badge ? <View className="bb__num">{badge}</View> : math ? <Text className="bb__math">{math}</Text> : null}
        <Image className="bb__buddy" src={roleUri(role, theme)} mode="aspectFit" />
      </View>
      <View className="bb__tray">
        <View className="bb__trayi" />
        <View className="bb__trayi bb__trayi--tie" />
      </View>
    </View>
  );
}

/** 今天作业计划的下一项（或正在做的那项，和 App 一致）：点「开始 / 继续」直接去做。没有清单或全做完了就不显示 */
function NextUp() {
  const { data } = useHomework();
  const today = data && data.day === data.today ? data : null;
  const s = today?.summary;
  if (!today || !s || !s.total || s.allDone) return null;
  const next = today.items.find((it) => it.id === s.currentId) ?? (s.nextId ? today.items.find((it) => it.id === s.nextId) : null) ?? nextTodo(today.items);
  if (!next) return null;
  const doing = next.status === "running" || next.status === "paused";
  const meta = doing ? "正在做" : next.remindAt ? `下一项 · ${next.remindAt} 开始` : `下一项 · 约 ${next.est} 分钟`;
  return (
    <View
      className="hb__next rise rise--1"
      hoverClass="h4--hover"
      onClick={() => void Taro.navigateTo({ url: doing ? `/pages/homework-focus/index?id=${next.id}` : `/pages/homework-item/index?id=${next.id}` })}
    >
      <SubjectTile subject={tileSubject(next.subject)} size="sm" />
      <View className="hb__nextm">
        <Text className="hb__nexts ellipsis">今天作业计划 · {meta}</Text>
        <Text className="hb__nextb ellipsis">{next.title}</Text>
      </View>
      <View className="hb__go">
        <Text>{doing ? "继续" : "开始"}</Text>
        <Icon name="chevron-right" size={13} color="#ffffff" stroke={2.6} />
      </View>
      {s.done > 0 && (
        <View className="hb__nextbar">
          <View className="hb__nextbari" style={{ width: `${(s.done / s.total) * 100}%` }} />
        </View>
      )}
    </View>
  );
}
