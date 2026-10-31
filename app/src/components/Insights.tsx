import { useState } from "react";
import type { Subject } from "../api/types";
import type { ErrorItem } from "../lib/errors";
import { SUBJECT_LABEL } from "../lib/format";
import { weeklyTrend } from "../lib/insights";
import { Icon } from "./Icon";
import { subjectColors } from "./v2";

/** 每周错题数柱状图（单一系列，标题即图例）。点一根柱子显示那周的数字。 */
export function TrendBars({ items, weeks = 8 }: { items: ErrorItem[]; weeks?: number }) {
  const data = weeklyTrend(items, weeks);
  const max = Math.max(1, ...data.map((d) => d.count));
  const [active, setActive] = useState<number>(data.length - 1);
  const last = data[data.length - 1].count;
  const prev = data[data.length - 2]?.count ?? 0;
  const delta = last - prev;
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="t-headline">每周错题</span>
        <span className="t-foot c-sec">{delta === 0 ? "和上周持平" : delta > 0 ? `比上周多 ${delta} 题` : `比上周少 ${-delta} 题`}</span>
      </div>
      <div className="trend" role="img" aria-label={`最近 ${weeks} 周每周错题数：${data.map((d) => `${d.label} ${d.count} 题`).join("，")}`}>
        {data.map((d, i) => (
          <button key={d.start} className={`trend__col${i === active ? " on" : ""}`} onClick={() => setActive(i)} aria-label={`${d.label} ${d.count} 题`}>
            <span className="trend__val num">{i === active ? d.count : ""}</span>
            <span className="trend__area"><span className="trend__bar" style={{ height: d.count ? `${Math.max(6, (d.count / max) * 100)}%` : 2 }} /></span>
            <span className="trend__label">{d.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 薄弱知识点排行：横向条，长度 = 题数；点一行展开那个知识点的题 */
export function KnowledgeBars({ groups, limit = 6, onPick, picked }: { groups: [string, ErrorItem[]][]; limit?: number; onPick?: (k: string) => void; picked?: string | null }) {
  const shown = groups.slice(0, limit);
  const max = Math.max(1, ...shown.map(([, l]) => l.length));
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="t-headline">薄弱知识点</span>
        <span className="t-foot c-sec">{groups.length} 个知识点{groups.length > limit ? ` · 显示前 ${limit}` : ""}</span>
      </div>
      <div className="kbars">
        {shown.map(([k, list], i) => {
          const c = subjectColors(list[0].subject);
          return (
            <button key={k} className={`kbar${picked === k ? " on" : ""}`} onClick={() => onPick?.(k)} aria-expanded={picked === k}>
              <span className="kbar__rank num">{i + 1}</span>
              <span className="kbar__main">
                <span className="kbar__name ellipsis">{k}</span>
                <span className="kbar__track"><span className="kbar__fill" style={{ width: `${(list.length / max) * 100}%`, background: c.color }} /></span>
              </span>
              <span className="kbar__count num">{list.length}</span>
              {onPick && <Icon name={picked === k ? "chevron-down" : "chevron-right"} size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 学科占比：一条分段条 + 图例（文字带数字，颜色只做辅助） */
export function SubjectSplit({ groups }: { groups: [Subject, ErrorItem[]][] }) {
  const total = groups.reduce((n, [, l]) => n + l.length, 0) || 1;
  return (
    <div className="chart">
      <div className="chart__head"><span className="t-headline">学科分布</span></div>
      <div className="split" role="img" aria-label={groups.map(([s, l]) => `${SUBJECT_LABEL[s]} ${l.length} 题`).join("，")}>
        {groups.map(([s, l]) => <span key={s} style={{ flex: l.length, background: subjectColors(s).color }} />)}
      </div>
      <div className="legend">
        {groups.map(([s, l]) => (
          <span key={s} className="legend__item">
            <span className="legend__dot" style={{ background: subjectColors(s).color }} />
            {SUBJECT_LABEL[s]} <span className="num c-sec">{l.length} · {Math.round((l.length / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
