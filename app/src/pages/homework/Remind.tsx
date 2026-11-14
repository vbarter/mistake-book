import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, Spinner } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { defaultStart, groupBySubject, liveNow, hwSubjectLabel, loadDay, orderOf, schedule, tileSubject, useHomework, type HwItem } from "../../lib/homework";
import { toastError } from "../../store/banner";
import { RemindChip, RemindSheet, useTick } from "./shared";

/** 现在往后取整到 5 分钟，再加 5 分钟：给孩子一点准备时间 */

/** 06 提醒时间：顶部一个时钟定开始时间，一进来就按预计用时把每一项排好，改时钟立刻重排；每一项也可以单独改 */
export default function Remind() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const day = params.get("day") || undefined;
  const data = useHomework((s) => s.data);
  const [editing, setEditing] = useState<HwItem | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick();
  useEffect(() => {
    if (!data || (day && data.day !== day)) loadDay(day).catch(toastError);
  }, [day, data]);

  const todo = useMemo(() => data?.items.filter((it) => it.status === "todo") ?? [], [data]);
  const auto = todo.some((it) => it.remindAt || it.chain);
  const firstAt = todo.find((it) => it.remindAt)?.remindAt;
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (data && !from) setFrom(firstAt ?? (data.day === data.today ? defaultStart(liveNow(data.now, fetchedAt)) : "18:00"));
  }, [data, firstAt, from, fetchedAt]);
  // 一进来就按顶部的开始时间把每一项排好（一项都还没设提醒时）；不想要可以关掉开关，或单独改某一项
  const autoTried = useRef(false);
  useEffect(() => {
    if (!data || !from || autoTried.current || (day && data.day !== day)) return;
    autoTried.current = true;
    if (todo.length && !auto) void run(from);
  }, [data, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (start: string | null) => {
    setBusy(true);
    try {
      await schedule(start, data?.day);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="screen"><InlineNav title="提醒时间" back /><Spinner /></div>;
  const first = data.summary.nextId ? data.items.find((it) => it.id === data.summary.nextId) : null;
  const flat = groupBySubject(data.items).flatMap((g) => g.items);

  return (
    <div className="screen">
      <InlineNav title="提醒时间" back backLabel="返回" onBack={() => nav("/homework", { replace: true })} />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 4, gap: 4 }}>
        <div className="hw-auto">
          <div className="hw-auto__h">
            <ColorIcon name="remind" size={40} />
            <span>
              <b>到点提醒，自动开始计时</b>
              <span>到点弹出提醒；打开 App 时已经在计时了</span>
            </span>
          </div>
          <div className="hw-auto__row">
            <label className="hw-clock">
              <Icon name="clock" size={18} stroke={2.4} />
              <b>{from}</b>
              {/* 透明的系统时间选择盖在上面：显示统一是 24 小时制，不跟系统的上午 / 下午格式走 */}
              <input type="time" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value) void run(e.target.value); }} aria-label="开始时间" />
            </label>
            <span className="hw-auto__txt"><b>开始</b>每一项按预计用时自动排好</span>
            <button className={`hw-switch${auto ? " hw-switch--on" : ""}`} role="switch" aria-checked={auto} aria-label="自动排时间" disabled={busy || !todo.length} onClick={() => run(auto ? null : from)} />
          </div>
        </div>
        {groupBySubject(data.items).map((g) => (
          <section key={g.subject}>
            <div className="hw-sech">
              <SubjectTile subject={tileSubject(g.subject)} size="xs" />
              {hwSubjectLabel(g.subject)}
              <em>{g.items.length} 项</em>
            </div>
            <div className="hw-list">
              {g.items.map((it) => (
                <button key={it.id} className={`hw-row${it.status === "done" ? " hw-row--done" : ""}`} disabled={it.status !== "todo"} onClick={() => setEditing(it)}>
                  <span className="hw-main">
                    <span className="hw-title ellipsis">{it.title}</span>
                    <span className="hw-sub">预计 {it.est} 分钟</span>
                  </span>
                  <RemindChip item={it} now={now} action={it.status === "todo"} />
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className="bottom-bar">
          <Button style={{ flex: 1 }} onClick={() => nav("/homework", { replace: true })}>
            {first && data.summary.nextAt ? `保存 · ${data.summary.nextAt} 自动开始第 ${orderOf(data.items, first.id)} 项` : "保存"}
          </Button>
        </div>
      </div>
      <RemindSheet item={editing} first={!!editing && flat[0]?.id === editing.id} onClose={() => setEditing(null)} />
    </div>
  );
}
