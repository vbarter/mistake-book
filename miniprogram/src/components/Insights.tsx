/** 错题图表（和 App 的 components/Insights.tsx 一致）：首页的薄弱知识点小条、错题榜的每周错题柱状图 */
import { useState } from "react";
import { Text, View } from "@tarojs/components";
import type { ErrorItem } from "../lib/errors";
import { SUBJECT_LABEL } from "../lib/format";
import { weeklyTrend, type SubjectKnowledge } from "../lib/insights";
import { subjectColors } from "./ui";

/** 每周错题数柱状图（单一系列，标题即图例）。点一根柱子显示那周的数字。 */
export function TrendBars({ items, weeks = 8 }: { items: ErrorItem[]; weeks?: number }) {
  const data = weeklyTrend(items, weeks);
  const max = Math.max(1, ...data.map((d) => d.count));
  const [active, setActive] = useState<number>(data.length - 1);
  const last = data[data.length - 1].count;
  const prev = data[data.length - 2]?.count ?? 0;
  const delta = last - prev;
  return (
    <View className="chart">
      <View className="chart__head">
        <Text className="t-headline">每周错题</Text>
        <Text className="t-foot c-sec">{delta === 0 ? "和上周持平" : delta > 0 ? `比上周多 ${delta} 题` : `比上周少 ${-delta} 题`}</Text>
      </View>
      <View className="trend">
        {data.map((d, i) => (
          <View key={d.start} className={`trend__col${i === active ? " trend__col--on" : ""}`} onClick={() => setActive(i)}>
            <Text className="trend__val num">{i === active ? d.count : ""}</Text>
            <View className="trend__area">
              <View className="trend__bar" style={{ height: d.count ? `${Math.max(6, (d.count / max) * 100)}%` : "2px", animationDelay: `${i * 50}ms` }} />
            </View>
            <Text className="trend__label">{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 薄弱知识点（首页摘要）：按学科分组，每科列错得最多的几个知识点。条长 = 占这一科错题的比例，颜色 = 学科。
 *  各科分开排，免得一科的大知识点（如语文默写的每个空都算一题）把别的学科挤出前几名。 */
export function KnowledgeBars({ groups, perSubject = 2, maxSubjects = 4 }: { groups: SubjectKnowledge[]; perSubject?: number; maxSubjects?: number }) {
  const shown = groups.slice(0, maxSubjects);
  const kpTotal = groups.reduce((n, g) => n + g.knowledge.length, 0);
  let row = 0; // 动画错开用
  return (
    <View className="chart">
      <View className="chart__head">
        <Text className="t-headline">薄弱知识点</Text>
        <Text className="t-foot c-sec">
          {groups.length > 1 ? `${groups.length} 科 · ` : ""}
          {kpTotal} 个知识点{groups.length > maxSubjects ? ` · 显示前 ${maxSubjects} 科` : ""}
        </Text>
      </View>
      {shown.map((g) => {
        const c = subjectColors(g.subject);
        return (
          <View key={g.subject} className="kgroup">
            <View className="kgroup__head">
              <Text className="tag" style={{ background: c.bg, color: c.color }}>
                {SUBJECT_LABEL[g.subject]}
              </Text>
              <Text className="t-foot c-sec">
                {g.items.length} 题 · {g.knowledge.length} 个知识点{g.knowledge.length > perSubject ? ` · 前 ${perSubject}` : ""}
              </Text>
            </View>
            <View className="kbars">
              {g.knowledge.slice(0, perSubject).map(([k, list], i) => (
                <View key={k} className="kbar">
                  <Text className="kbar__rank num">{i + 1}</Text>
                  <View className="kbar__main">
                    <Text className="kbar__name ellipsis">{k}</Text>
                    <View className="kbar__track">
                      <View className="kbar__fill" style={{ width: `${(list.length / g.items.length) * 100}%`, background: c.color, animationDelay: `${row++ * 80}ms` }} />
                    </View>
                  </View>
                  <Text className="kbar__count num">{list.length}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
