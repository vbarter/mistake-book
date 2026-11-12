import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { AvatarPrompt } from "../components/AvatarPrompt";
import { ColorIcon } from "../components/ColorIcon";
import { Icon } from "../components/Icon";
import { Buddy } from "../components/Illustration";
import { Sheet } from "../components/ui";
import { Avatar } from "../components/v2";
import { listFolders, thumbOf, type Folder } from "../lib/folders";
import { useJobs } from "../lib/jobs";
import { isScanErrorSeen, markScanErrorSeen } from "../lib/scanNotice";
import { createdLabel, fetchPlans, joinPath, pendingJoin, usePlans, type PlanInfo, type PlanSummary } from "../lib/plans";
import { useAuth } from "../store/auth";
import { toast } from "../store/banner";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页：头图（问候、小人、一句提示），下面依次是两个入口「错题收集」「试卷擦除」、识别进度、
 * 没扫出来的小喇叭通知、学习计划（每个计划一行：名字、身份图标、创建时间）。错题统计和导出错题本在「分析」页。
 */
/** 头图上的装饰：几颗星星和淡淡的圆弧 */
function HeroDeco() {
  const star = "M0-8l2.2 5.8L8 0 2.2 2.2 0 8l-2.2-5.8L-8 0l5.8-2.2z";
  return (
    <svg className="h4__deco" viewBox="0 0 390 236" preserveAspectRatio="xMinYMax slice" fill="none" aria-hidden="true">
      <path transform="translate(236 150)" d={star} fill="#ffc53d" />
      <path transform="translate(206 176) scale(.7)" d={star} fill="#fff" opacity=".5" />
      <path transform="translate(24 196) scale(.6)" d={star} fill="#fff" opacity=".35" />
      <path transform="translate(176 196) scale(.5)" d={star} fill="#ffc53d" opacity=".8" />
      <circle cx="352" cy="34" r="46" stroke="#fff" strokeOpacity=".08" strokeWidth="14" />
      <path d="M-10 226c60-34 120-34 190-8" stroke="#fff" strokeOpacity=".07" strokeWidth="22" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [picking, setPicking] = useState(false);
  const jobsVersion = useJobs((s) => s.version);
  const nickname = useAuth((s) => s.user?.nickname) ?? "";
  const [plans, setPlans] = useState<PlanSummary | null>(null);
  const [planList, setPlanList] = useState<PlanInfo[]>([]);
  const plansVersion = usePlans((s) => s.version);
  // 点开了老师的卡片、刚登录 / 注册完落到首页：接着去加入
  useEffect(() => {
    const target = pendingJoin();
    if (target) nav(joinPath(target), { replace: true });
  }, [nav]);
  useEffect(() => {
    fetchPlans().then((r) => { setPlans(r.summary); setPlanList(r.plans); }).catch(() => undefined); // 没网时卡片照样在，只是不带数字
  }, [plansVersion]);
  // 首页直接列几个学习计划：有作业待交 / 待批阅的排前面，其余按新旧，最多 3 个
  const pending = (p: PlanInfo) => (p.role === "owner" ? p.toReview ?? 0 : p.todo ?? 0);
  const topPlans = [...planList].sort((a, b) => Number(pending(b) > 0) - Number(pending(a) > 0) || (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3);

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

  const now = new Date();
  const today = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAY[now.getDay()]}`;
  const h = now.getHours();
  const hello = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";

  const erase = () => {
    if (erasable.length === 0) return toast(papers.length ? "试卷还在识别，好了再来擦" : "先拍一份试卷，再来擦掉手写");
    setPicking(true);
  };

  // 头图里那颗提示：有作业先说作业，一份试卷都没有时提醒拍第一张
  const pill = plans && plans.todo > 0 ? { n: plans.todo, text: "份作业待交", go: () => nav("/plans") }
    : plans && plans.toReview > 0 ? { n: plans.toReview, text: "份等你批阅", go: () => nav("/plans") }
    : folders && papers.length === 0 ? { n: 0, text: "拍下第一张试卷", go: add.open }
    : null;

  // 计划行只留头像、名字、身份图标和创建时间：状态文字和右边的进度标记都拿掉了，进计划里再看
  const planRow = (p: PlanInfo) => {
    const owner = p.role === "owner";
    const created = createdLabel(p.createdAt);
    return (
      <button key={p.id} className="h4__plan" aria-label={`${p.name}，${owner ? "我建的" : `${p.teacher}建的`}`} onClick={() => nav(`/plans/${p.id}`)}>
        <Avatar name={p.teacher} url={p.teacherAvatar} size={44} />
        <span className="h4__main">
          <span className="h4__name ellipsis">{p.name}</span>
          <span className="h4__sub">
            {/* 插旗是我建的，进门是我加入的 */}
            <ColorIcon name={owner ? "plan-mine" : "plan-joined"} size={18} />
            <span className="h4__time ellipsis">{created || (owner ? "我建的" : p.teacher)}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="screen home4">
      <AvatarPrompt />
      <header className="h4__hero">
        <HeroDeco />
        <span className="h4__spot" />
        <Buddy scene={scanning.length ? "scan" : folders && papers.length === 0 ? "empty" : "hero"} size={150} style={{ position: "absolute", right: 8, bottom: 30 }} />
        <div className="h4__brand">
          <span className="h4__logo"><Icon name="check" size={17} stroke={3} /></span>
          <span className="h4__bname">上壹课</span>
          <span className="h4__date">{today}</span>
        </div>
        <div className="h4__hi ellipsis">{hello}{nickname ? `，${nickname}` : ""}</div>
        {pill && (
          <button className="h4__pill" onClick={pill.go}>
            <i>{pill.n > 0 ? pill.n : <Icon name="camera" size={12} stroke={2.6} />}</i>{pill.text}
          </button>
        )}
      </header>
      <div className="h4">
        <div className="h4__acts rise" style={{ ["--i" as string]: 0 }}>
          <button className="h4__act h4__act--a" onClick={add.open}><ColorIcon name="collect" size={72} className="h4__art" /><b>错题收集</b></button>
          <button className="h4__act h4__act--b" onClick={erase}><ColorIcon name="erase" size={72} className="h4__art" /><b>试卷擦除</b></button>
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

        <section className="rise" style={{ ["--i" as string]: 2 }}>
          <div className="h4__sech">
            <button className="h4__sect" onClick={() => nav("/plans")}>学习计划</button>
            <button className="h4__add" aria-label="新建学习计划" onClick={() => nav("/plans/new")}><Icon name="plus" size={13} stroke={3} />新建</button>
          </div>
          <div className="h4__plans">
            {topPlans.length > 0 ? topPlans.map(planRow) : (
              <button className="h4__empty" onClick={() => nav("/plans")}><ColorIcon name="plan" size={40} />还没有学习计划</button>
            )}
            {planList.length > topPlans.length && <button className="h4__more" onClick={() => nav("/plans")}>全部 {planList.length} 个 ›</button>}
          </div>
        </section>
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
