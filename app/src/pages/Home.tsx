import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { ExportSheet } from "../components/ExportSheet";
import { Icon, type IconName } from "../components/Icon";
import { KnowledgeBars } from "../components/Insights";
import { CountUp } from "../components/Motion";
import { Buddy } from "../components/Illustration";
import { Button } from "../components/ui";
import { allErrors } from "../lib/errors";
import { listFolders, thumbOf, type Folder } from "../lib/folders";
import { analyze, inRange, since } from "../lib/insights";
import { scanStageText, useJobs } from "../lib/jobs";
import { getLastExportAt } from "../lib/prefs";
import { dueLabel, fetchPlans, joinPath, pendingJoin, usePlans, type PlanSummary } from "../lib/plans";
import { useAuth } from "../store/auth";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页：问候、识别进度、近 30 天错题摘要、导出错题本。
 * 导出按钮固定在 Tab 栏上方，知识点再多也不用滚到底才看得到。
 * 添加试卷走底栏相机，识别、归类、命名、分析都自动完成。
 */
export default function Home() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
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
  const planLine = !plans || plans.owned + plans.joined === 0
    ? "老师布置作业，同学拍照交回"
    : [
        plans.todo > 0 ? `待交 ${plans.todo} 份${plans.nextTitle ? `：${plans.nextTitle}${plans.nextDue ? `（截止 ${dueLabel(plans.nextDue)}）` : ""}` : ""}` : "",
        plans.owned > 0 ? `今天已交 ${plans.submittedToday} 份 · 待批阅 ${plans.toReview} 份` : "",
      ].filter(Boolean).join(" · ") || "作业都交了";

  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
    void getLastExportAt().then(setLastExport);
  }, [jobsVersion, exporting]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const recent = useMemo(() => analyze(inRange(errors, "30d")), [errors]);
  const fresh = useMemo(() => since(errors, lastExport), [errors, lastExport]);
  const papers = folders?.flatMap((f) => f.papers.map((p) => ({ f, p }))) ?? [];
  const scanning = papers.filter(({ p }) => p.scanJob);
  const failed = papers.filter(({ p }) => p.scanError && !p.scanJob);
  const exportSet = fresh.length > 0 ? fresh : errors;

  const now = new Date();
  const eyebrow = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAY[now.getDay()]}`;
  const h = now.getHours();
  const hello = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";

  return (
    <div className="screen">
      <header className="topbar">
        <span className="t-foot c-sec" style={{ fontWeight: 600 }}>{eyebrow}</span>
      </header>
      <div className={`screen__content${errors.length > 0 ? " screen__content--dock" : ""}`} style={{ gap: 16 }}>
        <section className="greet rise" style={{ ["--i" as string]: 0 }}>
          <div className="greet__text">
            <h1 className="t-title1">{hello}{nickname ? `，${nickname}` : ""}</h1>
            <p className="t-sub c-sec">{papers.length === 0 ? "点下面的相机，拍下第一张试卷。" : scanning.length ? "试卷正在识别，好了会自动归档。" : "拍下新试卷，错题会自动整理。"}</p>
          </div>
          <Buddy scene={scanning.length ? "scan" : "hero"} size={112} style={{ flexShrink: 0, margin: "-8px -4px -12px 0" }} />
        </section>

        {(scanning.length > 0 || failed.length > 0) && (
          <div className="group rise" style={{ ["--i" as string]: 2 }}>
            <div className="group__header"><span>识别中</span><span>完成后自动归档</span></div>
            {scanning.map(({ f, p }) => (
              <button key={p.id} className="row" style={{ minHeight: 60 }} onClick={() => nav(`/papers/${f.id}`)}>
                <img className="thumb thumb--sm" src={thumbOf(p.pages[0])} alt="" />
                <span className="row__main">
                  <span className="row__title ellipsis">{p.name}</span>
                  <span className="progress" style={{ background: "var(--brand-tint)" }}><span style={{ width: `${Math.max(6, p.scanJob!.progress)}%` }} /></span>
                </span>
                <span className="t-cap" style={{ color: "var(--brand)", fontWeight: 700, whiteSpace: "nowrap" }}>{scanStageText(p.scanJob!)}</span>
              </button>
            ))}
            {failed.map(({ f, p }) => (
              <button key={p.id} className="row" style={{ minHeight: 56 }} onClick={() => nav(`/papers/${f.id}/${p.id}`)}>
                <span className="row__icon" style={{ background: "var(--wrong)" }}><Icon name="warning" size={18} /></span>
                <span className="row__main"><span className="row__title ellipsis">{p.name}</span><span className="row__sub">识别失败 · 点开重新识别</span></span>
                <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            ))}
          </div>
        )}

        <div className="group rise" style={{ ["--i" as string]: 2 }}>
          <div className="group__header"><span>今日安排</span></div>
          <button className="row" style={{ minHeight: 60 }} onClick={() => nav("/plans")}>
            <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="graduation" size={18} stroke={2} /></span>
            <span className="row__main"><span className="row__title">学习计划</span><span className="row__sub ellipsis">{planLine}</span></span>
            {plans && plans.todo + plans.toReview > 0 && <span className="num-chip" style={{ background: "var(--brand)", color: "#fff" }}>{plans.todo + plans.toReview}</span>}
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        </div>

        {recent.total > 0 && (
          <section className="card rise" style={{ gap: 14, ["--i" as string]: 3 }}>
            <button style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }} onClick={() => nav("/rank")}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="t-foot c-sec" style={{ fontWeight: 600 }}>近 30 天 · <CountUp value={recent.total} /> 道错题</span>
                <span className="t-body" style={{ fontWeight: 600 }}>{recent.summary}</span>
              </span>
              <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
            </button>
            <KnowledgeBars groups={recent.bySubject} />
          </section>
        )}

        {papers.length === 0 && folders && (
          <div className="group rise" style={{ ["--i" as string]: 2 }}>
            <div className="group__header"><span>怎么用</span></div>
            {[
              ["camera", "拍试卷", "拍照，或从相册一次选多张"],
              ["viewfinder", "自动识别", "还原题目和批改，按知识点归类"],
              ["chart", "看错题榜", "最近错在哪、哪个知识点该补"],
              ["printer", "导出错题本", "PDF，打印出来重做"],
            ].map(([icon, t, s]) => (
              <div key={t} className="row" style={{ minHeight: 56 }}>
                <span className="row__icon" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name={icon as IconName} size={18} stroke={2.2} /></span>
                <span className="row__main"><span className="row__title">{t}</span><span className="row__sub">{s}</span></span>
              </div>
            ))}
          </div>
        )}

      </div>
      {errors.length > 0 && (
        <div className="home-dock">
          <div className="rise" style={{ ["--i" as string]: 4 }}>
            <Button icon="printer" onClick={() => setExporting(true)}>{fresh.length > 0 && lastExport ? `导出新增的 ${fresh.length} 道错题` : `导出错题本（${errors.length} 题）`}</Button>
          </div>
        </div>
      )}
      {add.sheet}
      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={fresh.length > 0 && lastExport ? "新增错题" : "全部错题"} errors={exportSet} />
    </div>
  );
}
