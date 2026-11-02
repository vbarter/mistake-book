import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Buddy } from "../../components/Buddy";
import { Icon } from "../../components/Icon";
import { TrendBars } from "../../components/Insights";
import { Empty, MathText, Segmented, SubjectTile, TopBar } from "../../components/ui";
import { allErrors } from "../../lib/errors";
import { SUBJECT_LABEL } from "../../lib/format";
import { useDataVersion, useTabBar } from "../../lib/hooks";
import { RANGE_LABEL, analyze, inRange, type Range } from "../../lib/insights";
import { BOARDS, rank, type Board } from "../../lib/ranks";
import { setRankView } from "../../lib/rankView";
import { listFolders } from "../../lib/store";
import { C } from "../../lib/theme";
import type { Subject } from "../../lib/types";

/**
 * 分析 = 错题榜（和 App 一致）。顶部时间范围，下面学科页签和四个榜单切换，再下面是带名次的列表；点卡片进详情页，左右滑切换。
 * 易错指数由错题数量、是否真错、跨几份试卷、离现在多近算出（lib/ranks.ts），扫描完自动更新。
 */
export default function Ranking() {
  useTabBar(2);
  const [version] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const [range, setRange] = useState<Range>("30d");
  const [board, setBoard] = useState<Board>("question");
  const [pickedSubject, setSubject] = useState<Subject | "all">("all");

  const errors = useMemo(() => allErrors(folders), [folders]);
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
    setRankView(listTitle, entries);
    Taro.navigateTo({ url: `/pages/rank-detail/index?index=${start}` });
  };

  return (
    <View className="page page--tab" style={{ gap: "14px", paddingTop: 0 }}>
      {/* 时间范围放在顶栏，和右上角胶囊按钮同一行（App 里是居中的一条） */}
      <TopBar>
        <View className="flex1">
          <Segmented value={range} onChange={setRange} options={(["7d", "30d", "all"] as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
        </View>
      </TopBar>

      {errors.length === 0 && <Empty art={<Buddy scene="chart" size={150} />} title="还没有错题榜" text="扫描试卷后，这里会按易错程度排出你的错题榜。" />}

      {errors.length > 0 && (
        <>
          <View className="rank-head rise">
            <View className="rank-head__text">
              <Text className="t-title1">错题榜</Text>
              <Text className="t-foot c-sec">
                {RANGE_LABEL[range]} {insight.total} 道错题
              </Text>
              <Text className="t-sub" style={{ marginTop: "2px" }}>
                {insight.summary}
              </Text>
            </View>
            <Buddy scene="chart" size={100} style={{ margin: "-6px -4px -10px 0" }} />
          </View>

          <View className="rank-panel rise rise--2">
            <ScrollView scrollX className="subject-tabs" enhanced showScrollbar={false}>
              <View className="subject-tabs__inner">
                {(["all", ...subjects] as (Subject | "all")[]).map((s) => (
                  <View key={s} className={`subject-tab${subject === s ? " subject-tab--on" : ""}`} onClick={() => setSubject(s)}>
                    <Text>{s === "all" ? "全部" : SUBJECT_LABEL[s]}</Text>
                    {subject === s && <View className="subject-tab__line" />}
                  </View>
                ))}
              </View>
            </ScrollView>
            <ScrollView scrollX className="rank-boards" enhanced showScrollbar={false}>
              <View className="rank-boards__inner">
                {BOARDS.map((b) => (
                  <View key={b.id} className={`chip${board === b.id ? " chip--on" : ""}`} onClick={() => setBoard(b.id)}>
                    {b.short}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text className="rank-hint t-foot c-sec" style={{ display: "block" }}>
              {boardInfo.hint}
            </Text>
            <View className="rank-list">
              {rows.length === 0 && (
                <View className="rank-empty">
                  <Icon name="seal" size={28} color={C.secondary} />
                  <Text>这个榜上还没有题{board === "repeat" ? "，同一个知识点在两份以上试卷里都错才会上榜" : ""}</Text>
                </View>
              )}
              {rows.slice(0, 20).map((r, i) => (
                <View key={r.key} className="rank-card" hoverClass="rank-card--hover" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} onClick={() => openDetail(i)}>
                  <Text className={`rank-badge num${i < 3 ? " rank-badge--top" : ""}`}>{i + 1}</Text>
                  <View className="rank-card__body">
                    <View className="rank-card__title">
                      {subject === "all" && <SubjectTile subject={r.subject} size="xs" />}
                      <MathText className="clamp2 flex1 minw0" text={r.title} />
                    </View>
                    <View className="rank-card__meta">
                      {r.meta.map((m, mi) => (
                        <Text key={m} className="ellipsis" style={mi === 0 ? { flexShrink: 0, maxWidth: "55%" } : { minWidth: 0 }}>
                          {m}
                        </Text>
                      ))}
                    </View>
                    <MathText className="rank-card__quote clamp2" text={r.quote} />
                  </View>
                  <View className="rank-index">
                    <Text className="rank-index__num num">{Math.round(r.score)}</Text>
                    <Text className="rank-index__label">易错指数</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View className="card rise rise--3">
            <TrendBars key={range} items={errors} />
          </View>
        </>
      )}
    </View>
  );
}
