import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ColorIcon } from "./ColorIcon";
import { act, alarmKey, hwSubjectLabel, liveUsed, loadDay, mmss, msUntil, orderOf, parseLocal, serverClockOffset, useHomework } from "../lib/homework";
import { haptic } from "../lib/native";
import { toastError } from "../store/banner";

const SNOOZE = 10;
/** 自动开始超过这么久才打开 App 的，不再弹全屏提醒（清单上照样在计时） */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * 09b 到点提醒：App 开着的时候，到了下一项的提醒时间拉一次清单（服务端那边就自动开始计时了），
 * 然后盖一层全屏提醒：「好的，开始做」进计时页，「晚 10 分钟再开始」停表、提醒时间往后挪。
 * 打开 App 时发现有项已经自动开始、还没看过提醒的，也弹一次。
 */
export function HomeworkAlarm() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const data = useHomework((s) => s.data);
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const acked = useHomework((s) => s.acked);
  const ack = useHomework((s) => s.ack);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  // 启动、回到前台时拉一次今天的清单
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") loadDay().catch(() => undefined);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const today = data && data.day === data.today ? data : null;
  // 到下一项的提醒时间再拉一次
  useEffect(() => {
    if (!today?.summary.nextAt) return;
    const wait = msUntil(today, fetchedAt, today.summary.nextAt) + 1500;
    if (wait > 6 * 60 * 60 * 1000) return;
    const t = setTimeout(() => loadDay().catch(() => undefined), Math.max(1000, wait));
    return () => clearTimeout(t);
  }, [today, fetchedAt]);

  const running = today?.items.find((it) => it.status === "running" && it.autoStarted) ?? null;
  const fresh = running && running.startedAt ? parseLocal(running.startedAt) > Date.now() + serverClockOffset(today!, fetchedAt) - STALE_MS : false;
  const show = !!running && fresh && !acked[alarmKey(running)] && !pathname.startsWith("/homework/focus");

  useEffect(() => {
    if (!show) return;
    void haptic.rigid();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [show]);

  if (!show || !running || !today) return null;
  const start = () => {
    ack(alarmKey(running));
    nav(`/homework/focus/${running.id}`);
  };
  const later = async () => {
    setBusy(true);
    try {
      await act(running.id, "snooze", { minutes: SNOOZE });
      ack(alarmKey(running));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hw-alarm" role="alertdialog" aria-label="作业提醒">
      <span className="hw-alarm__icon"><ColorIcon name="remind" size={92} /></span>
      <span className="hw-alarm__sub">{hwSubjectLabel(running.subject)} · 第 {orderOf(today.items, running.id)} 项 / 共 {today.items.length} 项</span>
      <span className="hw-alarm__time">{running.chain ? "接着做" : running.remindAt ?? running.startedAt?.slice(11, 16)}</span>
      <span className="hw-alarm__title">{running.title}</span>
      <span className="hw-alarm__run">已自动开始计时 {mmss(liveUsed(running, fetchedAt, now))}</span>
      <div className="hw-alarm__btns">
        <button className="hw-alarm__ok" onClick={start}>好的，开始做</button>
        <button className="hw-alarm__later" disabled={busy} onClick={later}>晚 {SNOOZE} 分钟再开始</button>
      </div>
    </div>
  );
}
