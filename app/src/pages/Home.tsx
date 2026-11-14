import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { AvatarPrompt } from "../components/AvatarPrompt";
import { ColorIcon } from "../components/ColorIcon";
import { Icon } from "../components/Icon";
import { RoleIcon, type RoleName } from "../components/RoleIcon";
import { Sheet } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { loadDay, nextTodo, tileSubject, useHomework, type HwCheckin } from "../lib/homework";
import { allErrors } from "../lib/errors";
import { listFolders, thumbOf, type Folder } from "../lib/folders";
import { SUBJECT_LABEL } from "../lib/format";
import { analyze, inRange } from "../lib/insights";
import { useJobs } from "../lib/jobs";
import { isScanErrorSeen, markScanErrorSeen } from "../lib/scanNotice";
import { MARK_REVIEWED, fetchPlans, joinPath, pendingJoin, usePlans, type PlanSummary } from "../lib/plans";
import { toast } from "../store/banner";
import chalkTodo from "../assets/chalk/todo.png";
import chalkPlan from "../assets/chalk/plan.png";
import chalkWrong from "../assets/chalk/wrong.png";
import chalkErase from "../assets/chalk/erase.png";
import chalkTag from "../assets/chalk/tag.png";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_MS = 86400000;

/**
 * 首页（黑板四宫格，界面稿见项目文件 screenshots/home-blackboard/）：
 * 顶部品牌名、「今天，学一点」和连续打卡天数；本周打卡条；四块黑板入口「待办事项」「学习计划」「错题收集」「试卷擦除」，
 * 黑板颜色跟主题走（--hero-a / --hero-b），粉笔字是烘好的透明图（assets/chalk/，tools/chalk-titles.mjs 生成），小人是角色图标（RoleIcon）；
 * 下面是识别进度、没扫出来的小喇叭通知、今天作业计划的下一项、近 30 天错题数。
 * 打卡：当天作业计划全部做完算打一次卡（服务端 GET /api/homework 带的 checkin）。
 */
export default function Home() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [picking, setPicking] = useState(false);
  const jobsVersion = useJobs((s) => s.version);
  const [plans, setPlans] = useState<PlanSummary | null>(null);
  const [planCount, setPlanCount] = useState<number | null>(null);
  const plansVersion = usePlans((s) => s.version);
  // 点开了老师的卡片、刚登录 / 注册完落到首页：接着去加入
  useEffect(() => {
    const target = pendingJoin();
    if (target) nav(joinPath(target), { replace: true });
  }, [nav]);
  useEffect(() => {
    fetchPlans().then((r) => { setPlans(r.summary); setPlanCount(r.plans.length); }).catch(() => undefined); // 没网时黑板照样在，只是不带数字
  }, [plansVersion]);
  useEffect(() => {
    loadDay().catch(() => undefined); // 打卡和下一项都从这里来
  }, []);
  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  const papers = folders?.flatMap((f) => f.papers.map((p) => ({ f, p }))) ?? [];
  const scanning = papers.filter(({ p }) => p.scanJob);
  // 没扫出来、还没点开看过的：首页用小喇叭提醒，最近失败的排前面
  const [, setSeenVersion] = useState(0);
  const failed = papers
    .filter(({ p }) => p.scanError && !p.scanJob && !isScanErrorSeen(p))
    .sort((x, y) => ((x.p.scanErrorAt ?? x.p.updatedAt) < (y.p.scanErrorAt ?? y.p.updatedAt) ? 1 : -1));
  const openFailed = () => {
    const { f, p } = failed[0];
    markScanErrorSeen(p);
    setSeenVersion((x) => x + 1);
    nav(`/papers/${f.id}/${p.id}`);
  };
  // 试卷擦除：从最近的试卷里挑一份去擦
  const erasable = papers.filter(({ p }) => !p.scanJob).sort((x, y) => (x.p.createdAt < y.p.createdAt ? 1 : -1)).slice(0, 8);
  const erase = () => {
    if (erasable.length === 0) return toast(papers.length ? "试卷还在识别，好了再来擦" : "先拍一份试卷，再来擦掉手写");
    setPicking(true);
  };

  const now = new Date();
  const today = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAY[now.getDay()]}`;

  // 错题：近 30 天几道、错得最多的三科（和「分析」页同一套算法），本周一以来新收了几道
  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const month = useMemo(() => inRange(errors, "30d"), [errors]);
  const topSubjects = useMemo(() => analyze(month).subjects.slice(0, 3), [month]);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const weekNew = errors.filter((e) => new Date(e.scannedAt).getTime() >= monday).length;

  const hw = useHomework((st) => st.data);
  const hs = hw && hw.day === hw.today ? hw.summary : null;
  const checkin = hw?.checkin ?? null;

  // 四块黑板右下角的粉笔圈：一个最要紧的数
  const todoBadge = !hs || !hs.total ? "去添加" : hs.allDone ? "全做完" : <>还剩<b>{hs.left}</b>项</>;
  const planBadge = plans && plans.todo > 0 ? <><b>{plans.todo}</b>份待交</>
    : MARK_REVIEWED && plans && plans.toReview > 0 ? <><b>{plans.toReview}</b>份待批</>
    : planCount ? <><b>{planCount}</b>个计划</>
    : planCount === 0 ? "去新建" : null;
  const wrongBadge = weekNew > 0 ? <>本周<b>+{weekNew}</b></> : "拍一张";

  return (
    <div className="screen home4">
      <AvatarPrompt />
      <header className="hb__head">
        <div className="hb__brand">
          <span className="hb__logo"><Icon name="check" size={18} stroke={3} /></span>
          <span className="hb__name">上壹课</span>
          <span className="hb__date">{today}</span>
        </div>
        <div className="hb__row">
          <span className="hb__slogan">
            今天，学一点
            <svg width="56" height="7" viewBox="0 0 56 7" fill="none" aria-hidden="true"><path d="M2 5C14 1.5 34 1 54 3.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </span>
          <button className="hb__streak" onClick={() => nav("/homework")}>
            <Icon name="sparkles" size={15} stroke={2.2} />
            {checkin && checkin.streak > 0 ? <>连续打卡 <b>{checkin.streak}</b> 天</> : "今天来打卡"}
          </button>
        </div>
      </header>
      <div className="hb">
        <WeekStrip checkin={checkin} now={now} onClick={() => nav("/homework")} />

        <div className="hb__grid rise" style={{ ["--i" as string]: 0 }}>
          <Board role="todo" chalk={chalkTodo} doodle="sun" badge={todoBadge} label="待办事项" onClick={() => nav("/homework")} />
          <Board role="plan" chalk={chalkPlan} doodle="star" badge={planBadge} label="学习计划" onClick={() => nav("/plans")} />
          <Board role="wrong" chalk={chalkWrong} doodle="star" badge={wrongBadge} label="错题收集" onClick={add.open} />
          <Board role="erase" chalk={chalkErase} doodle="sun" math="6 ÷ 2 =" label="试卷擦除" onClick={erase} />
        </div>

        {scanning.length > 0 && (
          <button className="h4__card rise" style={{ ["--i" as string]: 1 }} onClick={() => nav(`/papers/${scanning[0].f.id}`)}>
            <ColorIcon name="scan" size={44} />
            <span className="h4__main">
              <span className="h4__name ellipsis">正在识别 {scanning[0].p.name}</span>
              <span className="progress" style={{ marginTop: 6, height: 8 }}><span style={{ width: `${Math.max(6, scanning[0].p.scanJob!.progress || 0)}%` }} /></span>
            </span>
            <span className="h4__pct">{Math.round(scanning[0].p.scanJob!.progress || 0)}%</span>
          </button>
        )}

        {/* 没扫出来的试卷：一行小喇叭通知，点开去看那张试卷，看过就不再提醒（还有别的失败会接着提醒下一张） */}
        {failed.length > 0 && (
          <button className="h4__notice rise" style={{ ["--i" as string]: 1 }} onClick={openFailed}>
            <ColorIcon name="horn" size={24} />
            <span className="h4__noticet ellipsis">「{failed[0].p.name}」{failed.length > 1 ? `等 ${failed.length} 张` : ""}没扫出来</span>
            <span className="h4__noticea">查看</span>
            <Icon name="chevron-right" size={12} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        )}

        <NextUp />

        <button className="hb__stat rise" style={{ ["--i" as string]: 2 }} onClick={() => nav("/rank")}>
          <span className="hb__statn">{month.length}</span>
          <span className="hb__statt">
            道错题
            <small className="ellipsis">{month.length ? `近 30 天 · ${topSubjects.map(([s, l]) => `${SUBJECT_LABEL[s]} ${l.length}`).join(" · ")}` : "近 30 天没有新错题"}</small>
          </span>
          {topSubjects.length > 0 && (
            <span className="hb__bars" aria-hidden="true">
              {topSubjects.map(([s, l]) => <i key={s} style={{ height: `${Math.max(6, Math.round((l.length / topSubjects[0][1].length) * 30))}px`, background: `var(--${s})` }} />)}
            </span>
          )}
          <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
        </button>
      </div>
      {add.sheet}
      <Sheet open={picking} onClose={() => setPicking(false)} title="擦哪一份试卷">
        <div className="group">
          {erasable.map(({ f, p }) => (
            <button key={p.id} className="row" style={{ minHeight: 56 }} onClick={() => { setPicking(false); nav(`/papers/${f.id}/${p.id}/erase`); }}>
              <img className="thumb thumb--sm" src={thumbOf(p.pages[0])} alt="" />
              <span className="row__main"><span className="row__title ellipsis">{p.name}</span><span className="row__sub ellipsis">{f.name}</span></span>
              <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** 本周打卡条：周一到周日，打了卡的打勾，今天高亮。没登录、没网时七天都空着 */
function WeekStrip({ checkin, now, onClick }: { checkin: HwCheckin | null; now: Date; onClick: () => void }) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const todayIdx = (now.getDay() + 6) % 7;
  return (
    <button className="hb__wk" onClick={onClick} aria-label={`本周打卡 ${checkin?.weekDone ?? 0} 天`}>
      <span className="hb__wkl"><small>本周打卡</small><b><i>{checkin?.weekDone ?? 0}</i>天</b></span>
      <span className="hb__wkdays">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday.getTime() + i * DAY_MS);
          const done = !!checkin?.week[i]?.done;
          const cls = [i === todayIdx && "today", done && "done", i > todayIdx && "later"].filter(Boolean).join(" ");
          return (
            <span key={i} className={`hb__wkd ${cls}`}>
              <span className="hb__wkc">{done ? <Icon name="check" size={14} stroke={3} /> : d.getDate()}</span>
              {i === todayIdx ? "今天" : WEEKDAY[(i + 1) % 7]}
            </span>
          );
        })}
      </span>
    </button>
  );
}

const DOODLE = {
  sun: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </svg>
  ),
  star: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
    </svg>
  ),
};

/** 一块黑板：粉笔字（烘好的图）、角落的小涂鸦、左下角的角色小人、右下角粉笔圈里一个数 */
function Board({ role, chalk, doodle, badge, math, label, onClick }: { role: RoleName; chalk: string; doodle: keyof typeof DOODLE; badge?: ReactNode; math?: string; label: string; onClick: () => void }) {
  return (
    <button className="bb" onClick={onClick} aria-label={label}>
      <span className="bb__face">
        <img className="bb__tag" src={chalkTag} alt="" />
        <span className="bb__doodle">{DOODLE[doodle]}</span>
        <img className="bb__chalk" src={chalk} alt="" />
        {badge ? <span className="bb__num">{badge}</span> : math ? <span className="bb__math">{math}</span> : null}
        <RoleIcon name={role} size={86} shadow={false} className="bb__buddy" />
      </span>
      <span className="bb__tray" aria-hidden="true"><i /><i /></span>
    </button>
  );
}

/** 今天作业计划的下一项（或正在做的那项）：点「开始 / 继续」直接去做。没有清单或全做完了就不显示 */
function NextUp() {
  const nav = useNavigate();
  const data = useHomework((s) => s.data);
  const today = data && data.day === data.today ? data : null;
  const s = today?.summary;
  if (!today || !s || !s.total || s.allDone) return null;
  const next = today.items.find((it) => it.id === s.currentId) ?? (s.nextId ? today.items.find((it) => it.id === s.nextId) : null) ?? nextTodo(today.items);
  if (!next) return null;
  const doing = next.status === "running" || next.status === "paused";
  const meta = doing ? "正在做" : next.remindAt ? `下一项 · ${next.remindAt} 开始` : `下一项 · 约 ${next.est} 分钟`;
  return (
    <button className="hb__next rise" style={{ ["--i" as string]: 1 }} onClick={() => nav(doing ? `/homework/focus/${next.id}` : `/homework/${next.id}`)}>
      <SubjectTile subject={tileSubject(next.subject)} size="sm" />
      <span className="hb__nextm">
        <small className="ellipsis">今天作业计划 · {meta}</small>
        <b className="ellipsis">{next.title}</b>
      </span>
      <span className="hb__go">{doing ? "继续" : "开始"}<Icon name="chevron-right" size={13} stroke={2.6} /></span>
      {s.done > 0 && <span className="hb__nextbar" aria-hidden="true"><i style={{ width: `${(s.done / s.total) * 100}%` }} /></span>}
    </button>
  );
}
