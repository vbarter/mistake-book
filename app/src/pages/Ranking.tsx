import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { Icon } from "../components/Icon";
import { Buddy } from "../components/Illustration";
import { TrendBars } from "../components/Insights";
import { CountUp } from "../components/Motion";
import { Segmented } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { allErrors } from "../lib/errors";
import { listFolders, type Folder } from "../lib/folders";
import { SUBJECT_LABEL } from "../lib/format";
import { RANGE_LABEL, analyze, inRange, type Range } from "../lib/insights";
import { BOARDS, rank, type Board } from "../lib/ranks";
import { useJobs } from "../lib/jobs";
import { useRankView } from "../store/rankView";

/**
 * 分析 = 错题榜。版式参照生活类 App 的榜单页：顶部时间范围，学科页签，左边切四个榜单，右边是带名次的榜单；点卡片进详情页，左右滑切换。
 * 易错指数由错题数量、是否真错、跨几份试卷、离现在多近算出（lib/ranks.ts），扫描完自动更新。
 */
export default function Ranking() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [board, setBoard] = useState<Board>("question");
  const [pickedSubject, setSubject] = useState<Subject | "all">("all");
  const nav = useNavigate();
  const setView = useRankView((s) => s.set);
  const jobsVersion = useJobs((s) => s.version);

  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  const errors = useMemo(() => (folders ? allErrors(folders) : []), [folders]);
  const ranged = useMemo(() => inRange(errors, range), [errors, range]);
  const insight = useMemo(() => analyze(ranged), [ranged]);
  const subjects = insight.subjects.map(([s]) => s);
  const subject = pickedSubject !== "all" && subjects.includes(pickedSubject) ? pickedSubject : "all"; // 换了时间范围后这一科可能没题了
  const scoped = useMemo(() => ranged.filter((e) => subject === "all" || e.subject === subject), [ranged, subject]);
  const rows = useMemo(() => rank(scoped, board), [scoped, board]);
  const boardInfo = BOARDS.find((b) => b.id === board)!;
  const listTitle = `${subject === "all" ? "" : SUBJECT_LABEL[subject]}${boardInfo.title}`;

  /** 点一张卡片：把整张榜按顺序摊平成一串题，进详情页从这道开始，左右滑切换 */
  const openDetail = (rowIndex: number) => {
    const entries = rows.flatMap((r, i) => r.items.map((e) => ({ key: e.key, rank: i + 1, score: r.score, group: board === "question" ? "" : r.title })));
    const start = rows.slice(0, rowIndex).reduce((n, r) => n + r.items.length, 0);
    setView(listTitle, entries);
    nav(`/rank/q/${start}`);
  };

  return (
    <div className="screen">
      <header className="topbar topbar--center">
        <div style={{ width: "min(280px, 100%)" }}>
          <Segmented value={range} onChange={setRange} options={(["7d", "30d", "all"] as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
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

            <section className="rank-panel rise" style={{ ["--i" as string]: 2 }}>
              <div className="subject-tabs" role="tablist">
                {(["all", ...subjects] as (Subject | "all")[]).map((s) => (
                  <button key={s} role="tab" aria-selected={subject === s} className={`subject-tab${subject === s ? " on" : ""}`} onClick={() => setSubject(s)}>
                    {s === "all" ? "全部" : SUBJECT_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="rank-body">
                <nav className="rank-side" aria-label="榜单">
                  <span className="rank-side__head">榜单</span>
                  {BOARDS.map((b) => (
                    <button key={b.id} className={`rank-side__item${board === b.id ? " on" : ""}`} onClick={() => setBoard(b.id)} aria-pressed={board === b.id}>
                      <Laurel /><span className="rank-side__label">{b.title.replace("榜", "")}<small>{b.slogan}</small></span><Laurel flip />
                    </button>
                  ))}
                </nav>
                <div className="rank-list">
                  <div className="rank-list__head"><Laurel />{listTitle}<Laurel flip /></div>
                  {rows.length === 0 && <div className="rank-empty"><Icon name="seal" size={28} /><span>这个榜上还没有题{board === "repeat" ? "，同一个知识点在两份以上试卷里都错才会上榜" : ""}</span></div>}
                  {rows.slice(0, 20).map((r, i) => (
                    <button key={r.key} className="rank-card" style={{ ["--i" as string]: Math.min(i, 8) }} onClick={() => openDetail(i)}>
                      <span className={`rank-badge rank-badge--${i < 3 ? i + 1 : "n"}`}>{i + 1}</span>
                      <span className="rank-card__body">
                        <span className="rank-card__title">{subject === "all" && <SubjectTile subject={r.subject} size="xs" />}<span className="clamp2">{r.title}</span></span>
                        <span className="rank-card__meta">{r.meta.map((m) => <span key={m} className="ellipsis">{m}</span>)}</span>
                        <span className="rank-index">易错指数 {r.score.toFixed(1)}</span>
                        <span className="rank-card__quote clamp2">“{r.quote}”</span>
                      </span>
                      <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)", alignSelf: "center", flexShrink: 0 }} />
                    </button>
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
