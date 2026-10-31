import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { ExportSheet } from "../components/ExportSheet";
import { Icon, type IconName } from "../components/Icon";
import { KnowledgeBars } from "../components/Insights";
import { Buddy } from "../components/Illustration";
import { CountUp } from "../components/Motion";
import { Button } from "../components/ui";
import { allErrors } from "../lib/errors";
import { listFolders, thumbOf, type Folder } from "../lib/folders";
import { analyze, inRange, since } from "../lib/insights";
import { scanStageText, useJobs } from "../lib/jobs";
import { getLastExportAt } from "../lib/prefs";
import { useAuth } from "../store/auth";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 首页：一条闭环 收集 → 识别归档 → 分析 → 导出，可以一直循环。
 * 一个主入口（添加试卷），一个收尾动作（一键导出新增错题），中间的识别、归类、命名、分析全部自动。
 */
export default function Home() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const jobsVersion = useJobs((s) => s.version);
  const nickname = useAuth((s) => s.user?.nickname) ?? "";

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

  // 闭环四步，高亮「下一步该做的」
  const next = papers.length === 0 ? 0 : scanning.length > 0 ? 1 : fresh.length > 0 ? 3 : 0;
  const steps: { icon: IconName; title: string; go: () => void }[] = [
    { icon: "camera", title: "收集", go: add.open },
    { icon: "sparkles", title: "识别归档", go: () => nav("/papers") },
    { icon: "chart", title: "分析", go: () => nav("/rank") },
    { icon: "printer", title: "导出", go: () => setExporting(true) },
  ];

  return (
    <div className="screen">
      <header className="topbar">
        <span className="t-foot c-sec" style={{ fontWeight: 600 }}>{eyebrow}</span>
      </header>
      <div className="screen__content" style={{ gap: 16 }}>
        <section className="hero rise" style={{ ["--i" as string]: 0 }}>
          <div className="hero__top">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <h2 className="t-title2">{hello}{nickname ? `，${nickname}` : ""}</h2>
              <p className="t-sub" style={{ opacity: 0.88 }}>{papers.length ? "又考完一张？点下面的相机，错题我来整理。" : "点下面的相机拍下试卷，自动找出错题、归到知识点。"}</p>
            </div>
            <Buddy scene={scanning.length ? "scan" : "hero"} size={112} style={{ flexShrink: 0, margin: "-12px -8px -16px 0" }} />
          </div>
        </section>

        <section className="loop rise" style={{ ["--i" as string]: 1 }} aria-label="学习闭环">
          {steps.map((s, i) => (
            <button key={s.title} className={`loop__step${i === next ? " on" : ""}`} onClick={s.go}>
              <span className="loop__icon"><Icon name={s.icon} size={20} stroke={2.2} /></span>
              <span className="loop__title">{s.title}</span>
            </button>
          ))}
        </section>

        {(scanning.length > 0 || failed.length > 0) && (
          <div className="group rise" style={{ ["--i" as string]: 2 }}>
            <div className="group__header"><span>正在识别</span><span>好了会自动归档</span></div>
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

        {recent.total > 0 && (
          <section className="card rise" style={{ gap: 14, ["--i" as string]: 3 }}>
            <button style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }} onClick={() => nav("/rank")}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="t-foot c-sec" style={{ fontWeight: 600 }}>近 30 天 · <CountUp value={recent.total} /> 道错题</span>
                <span className="t-body" style={{ fontWeight: 600 }}>{recent.summary}</span>
              </span>
              <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
            </button>
            <KnowledgeBars groups={recent.knowledge} limit={3} />
          </section>
        )}

        {papers.length === 0 && folders && (
          <div className="group rise" style={{ ["--i" as string]: 2 }}>
            <div className="group__header"><span>四步搞定，可以一直循环</span></div>
            {[
              ["camera", "收集", "拍照，或从相册一次选好整叠试卷"],
              ["sparkles", "自动识别归档", "还原题目、批改、按知识点归类，自动命名"],
              ["chart", "看分析", "最近错在哪、哪个知识点最该补"],
              ["printer", "一键导出", "带目录的错题本 PDF，打印出来重做"],
            ].map(([icon, t, s]) => (
              <div key={t} className="row" style={{ minHeight: 56 }}>
                <span className="row__icon" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name={icon as IconName} size={18} stroke={2.2} /></span>
                <span className="row__main"><span className="row__title">{t}</span><span className="row__sub">{s}</span></span>
              </div>
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="rise" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6, ["--i" as string]: 4 }}>
            <Button icon="printer" onClick={() => setExporting(true)}>{fresh.length > 0 && lastExport ? `一键导出新增 ${fresh.length} 道错题` : `一键导出错题本 · ${errors.length} 题`}</Button>
            <span className="t-cap c-sec" style={{ textAlign: "center" }}>按知识点排好、自动生成目录，打印后左边重做、右边对答案</span>
          </div>
        )}
      </div>
      {add.sheet}
      <ExportSheet open={exporting} onClose={() => setExporting(false)} title={fresh.length > 0 && lastExport ? "新增错题" : "全部错题"} errors={exportSet} />
    </div>
  );
}
