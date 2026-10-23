import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Overview, Subject, TodayResponse } from "../api/types";
import { Icon } from "../components/Icon";
import { MistakeRow } from "../components/MistakeRow";
import { Button, Empty, IconButton, LargeNav, Ring, Spinner, SubjectChip } from "../components/ui";
import { folderStatus, listFolders, validDigitized, type Folder } from "../lib/folders";
import { formatDate, todayLabel } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useCapture } from "../store/capture";

export default function Today() {
  const nav = useNavigate();
  const setReturnTo = useCapture((s) => s.setReturnTo);
  const { data, loading, error, reload } = useAsync(async () => {
    const [overview, today] = await Promise.all([api<Overview>("/api/stats/overview"), api<TodayResponse>("/api/review/today")]);
    return { overview, today };
  });

  const { setFolder, reset } = useCapture();
  const [folders, setFolders] = useState<Folder[]>([]);
  useEffect(() => {
    listFolders().then((list) => setFolders([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3))).catch(() => setFolders([]));
  }, []);

  // 录题只有一个入口：拍照直接起相机，相册直接起多选；进入后不再经过引导页
  const goCapture = (source: "camera" | "photos" = "camera") => {
    reset();
    setReturnTo("/today");
    nav("/capture", { state: { source } });
  };
  const openFolder = (f: Folder) => {
    const digitized = validDigitized(f.digitized);
    setFolder(f.id, f.name, f.pages.map((p) => ({ ...p, boxes: p.boxes ?? [] })), digitized);
    setReturnTo("/today");
    nav(digitized ? "/capture/paper" : "/capture");
  };

  const o = data?.overview;
  const t = data?.today;
  const done = t ? t.doneToday : 0;
  const totalToday = t ? t.total + t.doneToday : 0;
  const allDone = t ? t.total === 0 && t.doneToday > 0 : false;
  const nothing = t ? t.total === 0 && t.doneToday === 0 : false;
  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <div className="screen">
      <LargeNav title="今天" eyebrow={todayLabel()} actions={<IconButton name="camera" label="拍照录题" onClick={() => goCapture("camera")} />} />
      <div className="screen__content">
        {loading && !data && <Spinner />}
        {error && !data && (
          <Empty icon="warning" title="加载失败" text={error.message} action={<Button size="sm" variant="tinted" onClick={() => reload()}>重试</Button>} />
        )}
        {o && t && (
          <>
            {/* 主卡 · 今日复习 */}
            {o.total === 0 && folders.length === 0 ? (
              <div className="card" style={{ alignItems: "center", textAlign: "center", gap: 12, padding: 24 }}>
                <Icon name="camera" size={44} style={{ color: "var(--brand)" }} />
                <h2 className="t-title2">拍第一张试卷</h2>
                <p className="t-sub c-sec">AI 还原成电子版，找出错题，按知识点整理进每天的复习。</p>
                <div style={{ display: "flex", gap: 10, width: "100%" }}>
                  <Button icon="camera" onClick={() => goCapture("camera")} style={{ flex: 1 }}>拍照</Button>
                  <Button variant="tinted" icon="photo" onClick={() => goCapture("photos")} style={{ flex: 1 }}>从相册选</Button>
                </div>
              </div>
            ) : nothing ? (
              <div className="card" style={{ alignItems: "center", textAlign: "center", gap: 10, padding: 24 }}>
                <Icon name="seal" size={44} style={{ color: "var(--mastered)" }} />
                <h2 className="t-title2">今天没有要复习的题</h2>
                <p className="t-sub c-sec">{t.tomorrow > 0 ? `明天有 ${t.tomorrow} 题。` : ""}想加练？去练习薄弱点。</p>
                <Button variant="tinted" onClick={() => nav("/practice")} style={{ height: 44 }}>去练习</Button>
              </div>
            ) : (
              <div className="card" style={{ gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <Ring value={totalToday ? done / totalToday : 0} color={allDone ? "var(--mastered)" : "var(--brand)"}>
                    {allDone ? (
                      <Icon name="check" size={26} stroke={2.6} style={{ color: "var(--mastered)" }} />
                    ) : (
                      <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>
                        {done}
                        <span className="t-foot c-sec" style={{ fontWeight: 600 }}>/{totalToday}</span>
                      </span>
                    )}
                  </Ring>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <h2 className="t-title2">{allDone ? "今天的复习完成了" : `今日复习 ${t.total} 题`}</h2>
                    <p className="t-sub c-sec">{allDone ? (t.tomorrow > 0 ? `明天 ${t.tomorrow} 题` : "明天没有新的待复习") : `约 ${t.estimatedMinutes} 分钟 · 趁记忆还在，把它叫回来`}</p>
                  </div>
                </div>
                {!allDone && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(o.dueBySubject).map(([s, n]) => (
                      <SubjectChip key={s} subject={s as Subject} count={n} small />
                    ))}
                  </div>
                )}
                {t.overflow > 0 && <span className="t-foot c-sec">还有 {t.overflow} 题明天继续</span>}
                {allDone ? (
                  <Button variant="tinted" onClick={() => nav("/review")} style={{ height: 44 }}>再复习一遍</Button>
                ) : (
                  <Button onClick={() => nav("/review")}>{done > 0 ? "继续复习" : "开始复习"}</Button>
                )}
              </div>
            )}

            {/* 最近试卷：一眼看到录过的卷子，点一下直达电子版或继续扫描；录新的用右上角相机或试卷 Tab */}
            {folders.length > 0 && (
              <div className="card" style={{ padding: "12px 0 0", gap: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 6px" }}>
                  <h3 className="t-headline">最近试卷</h3>
                  <button className="t-sub" style={{ color: "var(--brand)", fontWeight: 500 }} onClick={() => nav("/papers")}>全部</button>
                </div>
                {folders.map((f) => {
                  const st = folderStatus(f);
                  return (
                    <button key={f.id} className="row" style={{ minHeight: 60, width: "100%", textAlign: "left" }} onClick={() => openFolder(f)}>
                      <img src={f.pages[0]?.src} alt="" style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 5, border: "1px solid var(--separator-light)" }} />
                      <span className="row__main">
                        <span className="row__title ellipsis">{f.name}</span>
                        <span className="row__sub">{f.pages.length} 页 · {formatDate(f.updatedAt)}</span>
                      </span>
                      <span className="chip chip--sm" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                      <Icon name="chevron-right" size={18} style={{ color: "var(--tertiary)" }} />
                    </button>
                  );
                })}
                <div style={{ display: "flex", gap: 10, padding: "10px 16px 14px" }}>
                  <Button variant="tinted" size="sm" icon="camera" onClick={() => goCapture("camera")} style={{ flex: 1 }}>拍新试卷</Button>
                  <Button variant="tinted" size="sm" icon="photo" onClick={() => goCapture("photos")} style={{ flex: 1 }}>从相册选</Button>
                </div>
              </div>
            )}

            {/* 本周 */}
            {o.total > 0 && (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 className="t-headline">本周</h3>
                  {o.streakDays > 0 && (
                    <span className="chip chip--sm" style={{ background: "var(--mastered-bg)", color: "var(--mastered)" }}>
                      <Icon name="check" size={13} stroke={2.4} />连续 {o.streakDays} 天
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {o.week.map((d, i) => (
                    <span
                      key={d.date}
                      className="num"
                      style={{
                        width: 30, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600,
                        background: d.done ? "var(--brand)" : d.isToday ? "transparent" : "var(--fill)",
                        color: d.done ? "#fff" : d.isToday ? "var(--brand)" : "var(--secondary)",
                        border: d.isToday && !d.done ? "2px solid var(--brand)" : "none",
                      }}
                      aria-label={`周${weekDays[i]}${d.done ? " 已复习" : ""}`}
                    >
                      {weekDays[i]}
                    </span>
                  ))}
                </div>
                <p className="t-foot c-sec">新增 {o.weekNew} 题 · 已掌握 +{o.weekMastered} · 掌握率 {Math.round(o.masteryRate * 100)}% · 周目标 {o.weekReviewed}/{o.weeklyGoal}</p>
              </div>
            )}

            {/* 最近录入 */}
            {o.recent.length > 0 && (
              <div className="card" style={{ padding: "12px 0 0", gap: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 6px" }}>
                  <h3 className="t-headline">最近录入</h3>
                  <button className="t-sub" style={{ color: "var(--brand)", fontWeight: 500 }} onClick={() => nav("/library")}>全部</button>
                </div>
                {o.recent.map((m) => (
                  <MistakeRow key={m.id} m={m} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
