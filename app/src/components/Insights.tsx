import { useState } from "react";
import type { ErrorItem } from "../lib/errors";
import { weeklyTrend } from "../lib/insights";
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
          <button key={d.start} className={`trend__col${i === active ? " on" : ""}`} style={{ ["--d" as string]: i * 50 }} onClick={() => setActive(i)} aria-label={`${d.label} ${d.count} 题`}>
            <span className="trend__val num">{i === active ? d.count : ""}</span>
            <span className="trend__area"><span className="trend__bar" style={{ height: d.count ? `${Math.max(6, (d.count / max) * 100)}%` : 2 }} /></span>
            <span className="trend__label">{d.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 薄弱知识点排行（首页摘要）：横向条，长度 = 题数，颜色 = 学科 */
export function KnowledgeBars({ groups, limit = 6 }: { groups: [string, ErrorItem[]][]; limit?: number }) {
  const shown = groups.slice(0, limit);
  const max = Math.max(1, ...shown.map(([, l]) => l.length));
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="t-headline">薄弱知识点</span>
        <span className="t-foot c-sec">{groups.length} 个知识点{groups.length > limit ? ` · 显示前 ${limit}` : ""}</span>
      </div>
      <div className="kbars">
        {shown.map(([k, list], i) => (
          <div key={k} className="kbar">
            <span className="kbar__rank num">{i + 1}</span>
            <span className="kbar__main">
              <span className="kbar__name ellipsis">{k}</span>
              <span className="kbar__track"><span className="kbar__fill" style={{ width: `${(list.length / max) * 100}%`, background: subjectColors(list[0].subject).color, ["--i" as string]: i }} /></span>
            </span>
            <span className="kbar__count num">{list.length}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
