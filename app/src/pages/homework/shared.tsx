import { useEffect, useState } from "react";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, Sheet } from "../../components/ui";
import { liveNow, liveUsed, mmss, suggestRemind, updateItem, useHomework, type HwItem } from "../../lib/homework";
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
 * action：在「提醒时间」页，点它就是去设提醒，没设的写「设提醒」；别的页面只说状态「未设提醒」 */
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
