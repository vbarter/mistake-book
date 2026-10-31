import { useState } from "react";
import type { ErrorItem } from "../lib/errors";
import { SUBJECT_LABEL } from "../lib/format";
import { weeklyTrend, type SubjectKnowledge } from "../lib/insights";
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

/** 薄弱知识点（首页摘要）：按学科分组，每科列错得最多的几个知识点。条长 = 占这一科错题的比例，颜色 = 学科。
 *  各科分开排，免得一科的大知识点（如语文默写的每个空都算一题）把别的学科挤出前几名。 */
export function KnowledgeBars({ groups, perSubject = 2, maxSubjects = 4 }: { groups: SubjectKnowledge[]; perSubject?: number; maxSubjects?: number }) {
  const shown = groups.slice(0, maxSubjects);
  const kpTotal = groups.reduce((n, g) => n + g.knowledge.length, 0);
  let row = 0; // 动画错开用
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="t-headline">薄弱知识点</span>
        <span className="t-foot c-sec">{groups.length > 1 ? `${groups.length} 科 · ` : ""}{kpTotal} 个知识点{groups.length > maxSubjects ? ` · 显示前 ${maxSubjects} 科` : ""}</span>
      </div>
      {shown.map((g) => {
        const c = subjectColors(g.subject);
        return (
          <div key={g.subject} className="kgroup">
            <div className="kgroup__head">
              <span className="tag" style={{ background: c.bg, color: c.color, height: 22 }}>{SUBJECT_LABEL[g.subject]}</span>
              <span className="t-foot c-sec">{g.items.length} 题 · {g.knowledge.length} 个知识点{g.knowledge.length > perSubject ? ` · 前 ${perSubject}` : ""}</span>
            </div>
            <div className="kbars">
              {g.knowledge.slice(0, perSubject).map(([k, list], i) => (
                <div key={k} className="kbar" aria-label={`${SUBJECT_LABEL[g.subject]}「${k}」${list.length} 题，占本科 ${Math.round((list.length / g.items.length) * 100)}%`}>
                  <span className="kbar__rank num">{i + 1}</span>
                  <span className="kbar__main">
                    <span className="kbar__name ellipsis">{k}</span>
                    <span className="kbar__track"><span className="kbar__fill" style={{ width: `${(list.length / g.items.length) * 100}%`, background: c.color, ["--i" as string]: row++ }} /></span>
                  </span>
                  <span className="kbar__count num">{list.length}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
