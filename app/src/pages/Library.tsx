import { useEffect, useMemo, useState } from "react";
import type { Subject } from "../api/types";
import { ErrorCard } from "../components/ErrorCard";
import { Icon, type IconName } from "../components/Icon";
import { Buddy } from "../components/Illustration";
import { TrendBars } from "../components/Insights";
import { CountUp } from "../components/Motion";
import { Segmented } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { allErrors } from "../lib/errors";
import { listFolders, type Folder } from "../lib/folders";
import { SUBJECT_LABEL } from "../lib/format";
import { RANGE_LABEL, analyze, inRange, type Range } from "../lib/insights";
import { BOARDS, TYPE_LABEL, rank, type Board, type TypeFilter } from "../lib/ranks";
import { useJobs } from "../lib/jobs";

const BOARD_ICON: Record<Board, IconName> = { question: "target", knowledge: "brain", repeat: "loop", blank: "alert" };

/**
 * 分析 = 错题榜。版式参照生活类 App 的榜单页：顶部时间范围，四张榜单入口卡，学科页签，左边按题型筛，右边是带名次的榜单。
 * 易错指数由错题数量、是否真错、跨几份试卷、离现在多近算出（lib/ranks.ts），扫描完自动更新。
 */
export default function Library() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [board, setBoard] = useState<Board>("question");
  const [subject, setSubject] = useState<Subject | "all">("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const jobsVersion = useJobs((s) => s.version);

  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const ranged = useMemo(() => inRange(errors, range), [errors, range]);
  const insight = useMemo(() => analyze(ranged), [ranged]);
  const subjects = insight.subjects.map(([s]) => s);
  const scoped = useMemo(() => ranged.filter((e) => (subject === "all" || e.subject === subject) && (type === "all" || e.q.questionType === type)), [ranged, subject, type]);
  const rows = useMemo(() => rank(scoped, board), [scoped, board]);
  const boardInfo = BOARDS.find((b) => b.id === board)!;
  const types = (["all", "choice", "fill", "solve"] as TypeFilter[]).filter((t) => t === "all" || ranged.some((e) => (subject === "all" || e.subject === subject) && e.q.questionType === t));
  const listTitle = `${subject === "all" ? "" : SUBJECT_LABEL[subject]}${type === "all" ? "" : TYPE_LABEL[type]}${boardInfo.title}`;
  const reset = () => setOpen(null);

  return (
    <div className="screen rank-screen">
      <header className="topbar topbar--center">
        <div style={{ width: "min(280px, 100%)" }}>
          <Segmented value={range} onChange={(r) => { setRange(r); reset(); }} options={(["7d", "30d", "all"] as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
        </div>
      </header>

      <div className="screen__content" style={{ gap: 14 }}>
        {folders && errors.length === 0 && <div className="empty rise"><Buddy scene="chart" size={150} /><span className="empty__title">还没有错题榜</span><span className="t-sub">扫描试卷后，这里会按易错程度排出你的错题榜。</span></div>}

        {errors.length > 0 && (
          <>
            <section className="rank-hero rise" style={{ ["--i" as string]: 0 }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="rank-hero__title">错题榜</span>
                <span className="t-foot rank-hero__sub">依据{RANGE_LABEL[range]} <CountUp value={insight.total} /> 道错题自动排出 · 每次扫描后更新</span>
                <span className="t-sub rank-hero__summary">{insight.summary}</span>
              </div>
              <Buddy scene="chart" size={100} style={{ flexShrink: 0, margin: "-10px -12px -14px 0" }} />
            </section>

            <div className="board-cards rise" style={{ ["--i" as string]: 1 }}>
              {BOARDS.map((b) => (
                <button key={b.id} className={`board-card board-card--${b.id}${board === b.id ? " on" : ""}`} onClick={() => { setBoard(b.id); reset(); }} aria-pressed={board === b.id}>
                  <span className="board-card__title">{b.title}<Icon name="chevron-right" size={12} stroke={3} /></span>
                  <span className="board-card__slogan">{b.slogan}</span>
                  <span className="board-card__icon"><Icon name={BOARD_ICON[b.id]} size={26} stroke={2} /></span>
                </button>
              ))}
            </div>

            <section className="rank-panel rise" style={{ ["--i" as string]: 2 }}>
              <div className="subject-tabs" role="tablist">
                {(["all", ...subjects] as (Subject | "all")[]).map((s) => (
                  <button key={s} role="tab" aria-selected={subject === s} className={`subject-tab${subject === s ? " on" : ""}`} onClick={() => { setSubject(s); setType("all"); reset(); }}>
                    {s === "all" ? "全部" : SUBJECT_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="rank-body">
                <nav className="rank-side" aria-label="按题型">
                  <span className="rank-side__head">题型</span>
                  {types.map((t) => (
                    <button key={t} className={`rank-side__item${type === t ? " on" : ""}`} onClick={() => { setType(t); reset(); }}>
                      <Laurel />{t === "all" ? "全部" : TYPE_LABEL[t].slice(0, 2)}<Laurel flip />
                    </button>
                  ))}
                </nav>
                <div className="rank-list">
                  <div className="rank-list__head"><Laurel />{listTitle}<Laurel flip /></div>
                  {rows.length === 0 && <div className="rank-empty"><Icon name="seal" size={28} /><span>这个榜上还没有题{board === "repeat" ? "，同一个知识点在两份以上试卷里都错才会上榜" : ""}</span></div>}
                  {rows.slice(0, 20).map((r, i) => (
                    <div key={r.key} className="rank-card" style={{ ["--i" as string]: Math.min(i, 8) }}>
                      <button className="rank-card__main" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                        <span className={`rank-badge rank-badge--${i < 3 ? i + 1 : "n"}`}>{i + 1}</span>
                        <span className="rank-card__body">
                          <span className="rank-card__title">{subject === "all" && <SubjectTile subject={r.subject} size="xs" />}<span className="clamp2">{r.title}</span></span>
                          <span className="rank-card__meta">{r.meta.map((m) => <span key={m} className="ellipsis">{m}</span>)}</span>
                          <span className="rank-index">易错指数 {r.score.toFixed(1)}</span>
                          <span className="rank-card__quote clamp2">“{r.quote}”</span>
                        </span>
                      </button>
                      {open === r.key && (
                        <div className="rank-card__more">
                          {r.items.slice(0, 5).map((e) => <ErrorCard key={e.key} item={e} showSource />)}
                          {r.items.length > 5 && <span className="t-foot c-sec" style={{ textAlign: "center" }}>还有 {r.items.length - 5} 道，在文件夹的错题汇总里看</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="card rise" style={{ ["--i" as string]: 3 }}><TrendBars key={range} items={errors} /></div>
          </>
        )}
      </div>
    </div>
  );
}

/** 榜单两边的小麦穗 */
function Laurel({ flip }: { flip?: boolean }) {
  return (
    <svg className="laurel" width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M9 17C5 14 3.5 9 5 2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M5.2 4.5C3 4 2 2.5 2 1c1.8.3 3 1.5 3.2 3.5zM4.6 8.5C2.4 8.3 1.2 7 1 5.3c1.9.2 3.2 1.3 3.6 3.2zM5.3 12.4C3.2 12.6 1.7 11.6 1.2 10c1.9-.1 3.4.8 4.1 2.4z" fill="currentColor" />
    </svg>
  );
}
