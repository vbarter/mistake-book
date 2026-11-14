import { useEffect, useRef, useState } from "react";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, Sheet } from "../../components/ui";
import { defaultStart, liveNow, liveUsed, mmss, schedule, suggestRemind, updateItem, useHomework, type HwDay, type HwItem } from "../../lib/homework";
import { toastError } from "../../store/banner";

/** 每秒刷新一次（秒表用） */
export function useTick(active = true, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** 清单右边那颗：提醒时间 / 接着上一项 / 已过 / 计时中 / 做完的用时。
 * action：点它就是去改这一项的时间，没设的写「设提醒」；只看不能改的地方说状态「未设提醒」 */
export function RemindChip({ item, now, action }: { item: HwItem; now: number; action?: boolean }) {
  const fetchedAt = useHomework((s) => s.fetchedAt);
  if (item.status === "done") {
    return (
      <span className="hw-used">
        {item.photoCount > 0 && <Icon name="camera" size={12} stroke={2.2} />}
        {Math.max(1, Math.round(item.used / 60))} 分
      </span>
    );
  }
  if (item.status === "running" || item.status === "paused") {
    return (
      <span className="hw-rmd hw-rmd--run">
        <Icon name={item.status === "running" ? "timer" : "pause"} size={13} stroke={2.4} />
        {mmss(liveUsed(item, fetchedAt, now))}
      </span>
    );
  }
  if (item.chain) return <span className="hw-rmd hw-rmd--off">接着上一项</span>;
  if (!item.remindAt) {
    return action ? (
      <span className="hw-rmd hw-rmd--set"><Icon name="plus" size={12} stroke={2.8} />设提醒</span>
    ) : (
      <span className="hw-rmd hw-rmd--off">未设提醒</span>
    );
  }
  return (
    <span className={`hw-rmd${item.late ? " hw-rmd--late" : ""}`}>
      <ColorIcon name="remind" size={18} />
      {item.remindAt}
      {item.late && " 已过"}
    </span>
  );
}

/** 给一项设提醒时间：几点（先填好一个合适的时间）、接着上一项；设过的可以取消提醒 */
export function RemindSheet({ item, first, onClose }: { item: HwItem | null; first?: boolean; onClose: () => void }) {
  const data = useHomework((s) => s.data);
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item && data) setTime(suggestRemind(data.items, item, liveNow(data.now, fetchedAt), data.day === data.today));
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch: { remindAt?: string | null; chain?: boolean }) => {
    if (!item) return;
    setBusy(true);
    try {
      await updateItem(item.id, patch);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const set = !!item && (!!item.remindAt || item.chain);
  return (
    <Sheet open={!!item} onClose={onClose} title="提醒时间">
      {item && (
        <div className="hw-time">
          <span className="t-sub ellipsis">{item.title}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="提醒时间" />
          <span className="t-cap c-sec">到点提醒，并自动开始计时</span>
          <Button disabled={busy || !time} onClick={() => save({ remindAt: time })}>
            {time ? `${time} 提醒我` : "选一个时间"}
          </Button>
          {(!first || set) && (
            <div style={{ display: "flex", gap: 10 }}>
              {!first && (
                <Button variant="tinted" disabled={busy} style={{ flex: 1 }} onClick={() => save({ chain: true })}>
                  接着上一项
                </Button>
              )}
              {set && (
                <Button variant="plain" disabled={busy} style={{ flex: 1 }} onClick={() => save({ remindAt: null, chain: false })}>
                  取消提醒
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** 这一天关掉了「自动排时间」：记在本机，下次进清单不再自动排 */
const offKey = (day: string) => `zcb.hw.autoOff.${day}`;
function autoOff(day: string): boolean {
  try {
    return localStorage.getItem(offKey(day)) === "1";
  } catch {
    return false;
  }
}
function setAutoOff(day: string, off: boolean) {
  try {
    if (off) localStorage.setItem(offKey(day), "1");
    else localStorage.removeItem(offKey(day));
  } catch {
    /* 存不了就算了，只影响下次进来会不会自动排 */
  }
}

/** 清单顶部的开始时间：一个时钟定几点开始，每一项按预计用时自动排好，改时钟立刻重排；开关可以整体关掉。
 * 一项都还没排、也还没开始做时，进来就自动排一次 */
export function StartClock({ data }: { data: HwDay }) {
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const todo = data.items.filter((it) => it.status === "todo");
  const auto = todo.some((it) => it.remindAt || it.chain);
  const firstAt = todo.find((it) => it.remindAt)?.remindAt;
  const fallback = () => (data.day === data.today ? defaultStart(liveNow(data.now, fetchedAt)) : "18:00");
  const [from, setFrom] = useState(firstAt ?? fallback());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (firstAt) setFrom(firstAt);
  }, [firstAt]);
  const run = async (start: string | null) => {
    setBusy(true);
    try {
      await schedule(start, data.day);
      setAutoOff(data.day, !start);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const tried = useRef("");
  const s = data.summary;
  useEffect(() => {
    if (tried.current === data.day) return;
    tried.current = data.day;
    if (todo.length && !auto && !s.done && !s.currentId && !s.startedAt && !autoOff(data.day)) void run(from);
  }, [data.day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!todo.length) return null;
  return (
    <div className="hw-auto hw-auto--list">
      <div className="hw-auto__row">
        <label className="hw-clock">
          <Icon name="clock" size={18} stroke={2.4} />
          <b>{from}</b>
          {/* 透明的系统时间选择盖在上面：显示统一是 24 小时制，不跟系统的上午 / 下午格式走 */}
          <input type="time" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value) void run(e.target.value); }} aria-label="开始时间" />
        </label>
        <span className="hw-auto__txt"><b>开始</b>{auto ? "每一项按预计用时排好，到点自动计时" : "关着：不提醒，自己点开始"}</span>
        <button className={`hw-switch${auto ? " hw-switch--on" : ""}`} role="switch" aria-checked={auto} aria-label="自动排时间" disabled={busy} onClick={() => run(auto ? null : from)} />
      </div>
    </div>
  );
}
