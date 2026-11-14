import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { Button, InlineNav, Spinner } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { defaultStart, groupBySubject, hwSubjectLabel, loadDay, orderOf, schedule, tileSubject, useHomework, type HwItem } from "../../lib/homework";
import { toastError } from "../../store/banner";
import { RemindChip, RemindSheet, useTick } from "./shared";

/** 现在往后取整到 5 分钟，再加 5 分钟：给孩子一点准备时间 */

/** 06 设置提醒时间：一键从几点开始按预计用时排好；每一项也可以单独改 */
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
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (data && !from) setFrom(firstAt ?? defaultStart(data.now));
  }, [data, firstAt, from]);

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
            从
            <input type="time" value={from} onChange={(e) => { setFrom(e.target.value); if (auto && e.target.value) void run(e.target.value); }} aria-label="从几点开始" />
            开始，按用时排好
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
