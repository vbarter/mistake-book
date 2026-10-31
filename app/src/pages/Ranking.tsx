import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { Icon } from "../components/Icon";
import { MathText } from "../components/MathText";
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
 * 分析 = 错题榜。顶部时间范围，下面学科页签和四个榜单切换，再下面是带名次的列表；点卡片进详情页，左右滑切换。
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
            <section className="rank-head rise" style={{ ["--i" as string]: 0 }}>
              <div className="rank-head__text">
                <h1 className="t-title1">错题榜</h1>
                <span className="t-foot c-sec">{RANGE_LABEL[range]} <CountUp value={insight.total} /> 道错题</span>
                <span className="t-sub rank-head__summary">{insight.summary}</span>
              </div>
              <Buddy scene="chart" size={100} style={{ flexShrink: 0, margin: "-6px -4px -10px 0" }} />
            </section>

            <section className="rank-panel rise" style={{ ["--i" as string]: 2 }}>
              <div className="subject-tabs" role="tablist">
                {(["all", ...subjects] as (Subject | "all")[]).map((s) => (
                  <button key={s} role="tab" aria-selected={subject === s} className={`subject-tab${subject === s ? " on" : ""}`} onClick={() => setSubject(s)}>
                    {s === "all" ? "全部" : SUBJECT_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="rank-boards" role="group" aria-label="榜单">
                {BOARDS.map((b) => (
                  <button key={b.id} className={`chip chip--select${board === b.id ? " on" : ""}`} onClick={() => setBoard(b.id)} aria-pressed={board === b.id}>{b.short}</button>
                ))}
              </div>
              <p className="rank-hint t-foot c-sec">{boardInfo.hint}</p>
              <div className="rank-list">
                {rows.length === 0 && <div className="rank-empty"><Icon name="seal" size={28} /><span>这个榜上还没有题{board === "repeat" ? "，同一个知识点在两份以上试卷里都错才会上榜" : ""}</span></div>}
                {rows.slice(0, 20).map((r, i) => (
                  <button key={r.key} className="rank-card" style={{ ["--i" as string]: Math.min(i, 8) }} onClick={() => openDetail(i)}>
                    <span className={`rank-badge${i < 3 ? " rank-badge--top" : ""}`}>{i + 1}</span>
                    <span className="rank-card__body">
                      <span className="rank-card__title">{subject === "all" && <SubjectTile subject={r.subject} size="xs" />}<MathText className="clamp2" text={r.title} style={{ whiteSpace: "normal" }} /></span>
                      <span className="rank-card__meta">{r.meta.map((m) => <span key={m} className="ellipsis">{m}</span>)}</span>
                      <MathText className="rank-card__quote clamp2" text={r.quote} style={{ whiteSpace: "normal" }} />
                    </span>
                    <span className="rank-index" aria-label={`易错指数 ${Math.round(r.score)}`}><span className="num">{Math.round(r.score)}</span><small>易错指数</small></span>
                  </button>
                ))}
              </div>
            </section>

            <div className="card rise" style={{ ["--i" as string]: 3 }}><TrendBars key={range} items={errors} /></div>
          </>
        )}
      </div>
    </div>
  );
}

