import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { Icon } from "../components/Icon";
import { Buddy } from "../components/Illustration";
import { Sheet } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { allErrors } from "../lib/errors";
import { listFolders, thumbOf, type Folder } from "../lib/folders";
import { analyze, inRange } from "../lib/insights";
import { scanStageText, useJobs } from "../lib/jobs";
import { dueLabel, fetchPlans, joinPath, pendingJoin, usePlans, type PlanSummary } from "../lib/plans";
import { useAuth } from "../store/auth";
import { toast } from "../store/banner";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页：顶部「今日安排」（学习计划、待办事项），中间小人用气泡说识别进度 / 近 30 天错题总结，
 * 底部两块大入口「错题收集」「试卷擦除」。导出错题本在「分析」页。
 */
export default function Home() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [picking, setPicking] = useState(false);
  const jobsVersion = useJobs((s) => s.version);
  const nickname = useAuth((s) => s.user?.nickname) ?? "";
  const [plans, setPlans] = useState<PlanSummary | null>(null);
  const plansVersion = usePlans((s) => s.version);
  // 点开了老师的卡片、刚登录 / 注册完落到首页：接着去加入
  useEffect(() => {
    const target = pendingJoin();
    if (target) nav(joinPath(target), { replace: true });
  }, [nav]);
  useEffect(() => {
    fetchPlans().then((r) => setPlans(r.summary)).catch(() => undefined); // 没网时卡片照样在，只是不带数字
  }, [plansVersion]);
  const hasPlans = !!plans && plans.owned + plans.joined > 0;
  const planCount = plans ? plans.todo + plans.toReview : 0;

  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const recent = useMemo(() => analyze(inRange(errors, "30d")), [errors]);
  const papers = folders?.flatMap((f) => f.papers.map((p) => ({ f, p }))) ?? [];
  const scanning = papers.filter(({ p }) => p.scanJob);
  const failed = papers.filter(({ p }) => p.scanError && !p.scanJob);
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

  return (
    <div className="screen home2">
      <header className="topbar home2__head">
        <span className="home2__logo"><Icon name="check" size={18} stroke={3} /></span>
        <span className="home2__name">上壹课</span>
        <span className="home2__date">{today}</span>
      </header>
      <div className="home2__body">
        <section className="plan rise" style={{ ["--i" as string]: 0 }}>
          <div className="plan__top"><span className="plan__title">今日安排</span><span className="plan__sub">计划和作业，一眼看清</span></div>
          <div className="plan__cards">
            <button className="pc" onClick={() => nav("/plans")}>
              <span className="pc__h"><span className="pc__t">学习计划</span><span className="pc__go"><Icon name="chevron-right" size={11} stroke={3} /></span></span>
              {hasPlans && plans ? (
                <>
                  <span className="pc__big"><b className="pc__num">{planCount}</b>{plans.todo > 0 || plans.toReview === 0 ? "份 作业待交" : "份 等你批阅"}</span>
                  <span className="pc__m">
                    {plans.todo > 0 && plans.nextSubject && plans.nextSubject !== "mixed" && <SubjectTile subject={plans.nextSubject} size="xs" style={{ width: 16, height: 16, borderRadius: 5, fontSize: 10 }} />}
                    <span className="ellipsis">{plans.todo > 0 ? plans.nextTitle ?? "作业" : plans.owned > 0 ? `今天已交 ${plans.submittedToday} 份` : "作业都交了"}</span>
                  </span>
                  {plans.todo > 0 && plans.nextDue && <span className="pc__m pc__m--due">{dueLabel(plans.nextDue)} 截止</span>}
                </>
              ) : (
                <>
                  <span className="pc__empty">还没有计划</span>
                  <span className="pc__m pc__m--wrap">加入老师的计划，或自己建一个</span>
                </>
              )}
            </button>
            {/* 待办事项还没做好：先占个位置，点了提示一下 */}
            <button className="pc" onClick={() => toast("待办事项还在开发中，过几天就能用了")}>
              <span className="pc__h"><span className="pc__t">待办事项</span><span className="tag tag--neutral">即将上线</span></span>
              <span className="pc__empty">记下今天要做的事</span>
              <span className="pc__m pc__m--wrap">拍一张作业单，自动列成待办</span>
            </button>
          </div>
        </section>

        <section className="hero2 rise" style={{ ["--i" as string]: 2 }}>
          {scanning.length > 0 ? (
            <button className="bubble" onClick={() => nav(`/papers/${scanning[0].f.id}`)}>
              <span className="bubble__small">正在识别 · {scanStageText(scanning[0].p.scanJob!)}{scanning.length > 1 ? ` · 共 ${scanning.length} 份` : ""}</span>
              <span className="bubble__text">「{scanning[0].p.name}」好了会自动归档。</span>
              <span className="progress" style={{ background: "var(--brand-tint)", marginTop: 8 }}><span style={{ width: `${Math.max(6, scanning[0].p.scanJob!.progress)}%` }} /></span>
            </button>
          ) : failed.length > 0 ? (
            <button className="bubble" onClick={() => nav(`/papers/${failed[0].f.id}/${failed[0].p.id}`)}>
              <span className="bubble__small" style={{ color: "var(--wrong)" }}>识别失败</span>
              <span className="bubble__text">「{failed[0].p.name}」没识别出来。</span>
              <span className="bubble__more">点开重新识别 ›</span>
            </button>
          ) : recent.total > 0 ? (
            <button className="bubble" onClick={() => nav("/rank")}>
              <span className="bubble__small">近 30 天 · {recent.total} 道错题</span>
              <span className="bubble__text">{recent.summary}</span>
              <span className="bubble__more">看错题榜 ›</span>
            </button>
          ) : (
            <div className="bubble">
              <span className="bubble__small">{hello}{nickname ? `，${nickname}` : ""}</span>
              <span className="bubble__text">{papers.length === 0 ? "点「错题收集」或下面的相机，拍下第一张试卷。" : "拍下新试卷，错题会自动整理。"}</span>
            </div>
          )}
          <Buddy scene={scanning.length ? "scan" : "hero"} size={148} style={{ flexShrink: 0 }} />
        </section>

        <section className="sheet2 rise" style={{ ["--i" as string]: 3 }}>
          <div className="big">
            <button className="bt bt--a" onClick={add.open}>
              <span className="bt__deco" /><span className="bt__ic"><Icon name="camera" size={25} stroke={2} /></span>
              <span className="bt__t">错题收集</span><span className="bt__s">拍试卷，错题自动整理</span>
            </button>
            <button className="bt bt--b" onClick={erase}>
              <span className="bt__deco" /><span className="bt__ic"><Icon name="brush" size={25} stroke={2} /></span>
              <span className="bt__t">试卷擦除</span><span className="bt__s">擦掉手写，空白卷重练</span>
            </button>
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
