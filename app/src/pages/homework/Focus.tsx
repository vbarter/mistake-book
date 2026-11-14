import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, Sheet, Spinner } from "../../components/ui";
import { act, alarmKey, clockOf, hourMin, hwSubjectLabel, liveUsed, loadDay, minSec, mmss, nextTodo, orderOf, uploadPhotos, useHomework, type HwItem } from "../../lib/homework";
import { haptic, pickImages, takePhoto } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useTick } from "./shared";

const MORE_MINUTES = 10;

/** 10 计时中 · 11 做完了（停表、完成拍照）· 13 超时（卡住了怎么办） */
/** 换一项时整页重来（做完的弹窗、超时提醒都是这一项的） */
export default function FocusRoute() {
  const { id = "" } = useParams();
  return <Focus key={id} />;
}

function Focus() {
  const nav = useNavigate();
  const { id = "" } = useParams();
  const data = useHomework((s) => s.data);
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const ack = useHomework((s) => s.ack);
  const item = data?.items.find((it) => it.id === id) ?? null;
  const now = useTick(item?.status === "running");
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [finished, setFinished] = useState<HwItem | null>(null);
  /** 超时后「再做 10 分钟」：到这个已用秒数再提醒一次 */
  const remindAgainAt = useRef<number | null>(null);

  useEffect(() => {
    if (!item) loadDay().catch(toastError);
    else ack(alarmKey(item)); // 进了计时页，到点提醒就不用再弹了
  }, [item, ack]);

  const used = item ? liveUsed(item, fetchedAt, now) : 0;
  const estSec = (item?.est ?? 20) * 60;
  const over = used > estSec;
  // 第一次超时、或「再做 10 分钟」又到了：弹出「超过预计时间了」
  useEffect(() => {
    if (!item || item.status !== "running" || finished) return;
    const limit = remindAgainAt.current ?? estSec;
    if (used >= limit && used < limit + 2) {
      setStuck(true);
      void haptic.rigid();
    }
  }, [used, estSec, item, finished]);

  if (!data) return <div className="hw-focus"><Spinner /></div>;
  if (!item && !finished) {
    return (
      <div className="hw-focus">
        <div className="hw-focus__top"><button className="hw-focus__close" onClick={() => nav("/homework", { replace: true })}><Icon name="chevron-down" size={16} stroke={2.4} />收起</button></div>
        <div className="hw-focus__what"><span className="hw-focus__title">这一项不在了</span></div>
      </div>
    );
  }
  const cur = (item ?? finished)!;
  const idx = orderOf(data.items, cur.id);
  const doneCount = data.summary.done;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const close = () => nav("/homework", { replace: true });
  const finish = () =>
    run(async () => {
      const snap = { ...cur, used };
      await act(cur.id, "finish");
      void haptic.success();
      setFinished(snap);
    });
  const skip = () =>
    run(async () => {
      setStuck(false);
      const d = await act(cur.id, "skip");
      const next = nextTodo(d.items, cur.id);
      if (next) {
        await act(next.id, "start");
        nav(`/homework/focus/${next.id}`, { replace: true });
      } else close();
    });
  const ratio = Math.min(1, used / estSec);
  const R = 118;
  const C = 2 * Math.PI * R;
  const left = Math.ceil((estSec - used) / 60);

  return (
    <div className={`hw-focus${over && cur.status !== "done" ? " hw-focus--over" : ""}`}>
      <div className="hw-focus__top">
        <button className="hw-focus__close" onClick={close}><Icon name="chevron-down" size={16} stroke={2.4} />收起</button>
      </div>
      <div className="hw-focus__what">
        <span className="hw-focus__tag"><i>{hwSubjectLabel(cur.subject)}</i>第 {idx} 项 / 共 {data.items.length} 项</span>
        <span className="hw-focus__title">{cur.title}</span>
      </div>
      <div className="hw-ring">
        <svg width="260" height="260" viewBox="0 0 260 260">
          <circle cx="130" cy="130" r={R} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="12" />
          <circle cx="130" cy="130" r={R} fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div className="hw-ring__in">
          <span className="hw-ring__t">{mmss(used)}</span>
          {over ? (
            <span className="hw-ring__over"><Icon name="clock" size={12} stroke={2.6} />已超 {Math.floor((used - estSec) / 60)} 分钟</span>
          ) : (
            <span className="hw-ring__s">
              {cur.status === "paused" ? "已暂停" : cur.autoStarted && cur.startedAt ? `${clockOf(cur.firstStartedAt)} 自动开始` : "计时中"} · 还剩 {left} 分
            </span>
          )}
        </div>
      </div>
      <div className="hw-focus__note">预计 {cur.est} 分钟 · 今天已用 {hourMin(data.summary.used)} · 做完 {doneCount} 项</div>
      {cur.planAssignmentId && (
        <div className="hw-focus__links">
          <button onClick={() => nav(`/plans/a/${cur.planAssignmentId}`)}><Icon name="document" size={16} />看老师布置的作业</button>
        </div>
      )}
      <div className="hw-ctl">
        {cur.status === "paused" ? (
          <button disabled={busy} onClick={() => run(() => act(cur.id, "resume"))}><span className="hw-ctl__b"><Icon name="play" size={22} fill /></span>继续</button>
        ) : (
          <button disabled={busy || cur.status !== "running"} onClick={() => run(() => act(cur.id, "pause"))}><span className="hw-ctl__b"><Icon name="pause" size={22} stroke={2.6} /></span>暂停</button>
        )}
        <button disabled={busy || cur.status === "done"} onClick={finish}><span className="hw-ctl__main"><Icon name="check" size={38} stroke={3.2} /></span>做完了</button>
        <button disabled={busy} onClick={() => setStuck(true)}><span className="hw-ctl__b"><Icon name="help" size={24} stroke={2.2} /></span>卡住了</button>
      </div>

      <Sheet open={stuck} onClose={() => setStuck(false)} title={over ? "超过预计时间了" : "卡住了？"}>
        <span className="t-sub">预计 {cur.est} 分钟，已经做了 {Math.floor(used / 60)} 分钟。接下来怎么办？</span>
        <button className="hw-help" onClick={() => { remindAgainAt.current = used + MORE_MINUTES * 60; setStuck(false); toast(`好的，再做 ${MORE_MINUTES} 分钟，到点再提醒一次`); }}>
          <Icon name="timer" size={24} style={{ color: "var(--brand)" }} />
          <span><b>再做 {MORE_MINUTES} 分钟</b><span>继续计时，到点再提醒一次</span></span>
          <Icon name="chevron-right" size={14} stroke={2.4} />
        </button>
        {cur.status === "running" && (
          <button className="hw-help" onClick={() => { setStuck(false); void run(() => act(cur.id, "pause")); }}>
            <Icon name="pause" size={24} style={{ color: "var(--brand)" }} />
            <span><b>先停一下</b><span>暂停计时，歇一会再继续</span></span>
            <Icon name="chevron-right" size={14} stroke={2.4} />
          </button>
        )}
        <Button variant="plain" disabled={busy} onClick={skip}>先跳过，做下一项</Button>
      </Sheet>

      {finished && <FinishSheet item={finished} onDone={close} />}
    </div>
  );
}

/** 11 这一项做完了：用时、拍完成照片、下一项 */
function FinishSheet({ item, onDone }: { item: HwItem; onDone: () => void }) {
  const nav = useNavigate();
  const data = useHomework((s) => s.data);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const next = data ? nextTodo(data.items, item.id) : null;
  const diff = item.used - item.est * 60;

  const add = async (from: "camera" | "album") => {
    try {
      const got = from === "camera" ? [await takePhoto()].filter((x): x is string => !!x) : await pickImages(9 - photos.length);
      setPhotos((p) => [...p, ...got].slice(0, 9));
    } catch (e) {
      toastError(e);
    }
  };
  const go = async (withPhotos: boolean, startNext: boolean) => {
    setBusy(true);
    try {
      if (withPhotos && photos.length) await uploadPhotos(item.id, photos);
      if (startNext && next) {
        await act(next.id, "start");
        nav(`/homework/focus/${next.id}`, { replace: true });
      } else onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onDone} title="这一项做完了">
      <div className="hw-donebox">
        <i><Icon name="check" size={22} stroke={3} /></i>
        <span>
          <b>{minSec(item.used)}</b>
          <span>预计 {item.est} 分钟 · {diff > 0 ? `超了 ${minSec(diff)}` : `快了 ${minSec(-diff)}`}</span>
        </span>
      </div>
      <span className="t-foot c-sec">完成拍照 · 拍下做完的作业</span>
      <div className="hw-photos">
        {photos.map((src, i) => (
          <span key={i} className="hw-photo">
            <img src={src} alt="" />
            <button className="hw-x" aria-label="删掉这张" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}><Icon name="xmark" size={11} stroke={2.8} /></button>
          </span>
        ))}
        {photos.length < 9 && <button aria-label="拍照" onClick={() => add("camera")}><Icon name="camera" size={22} /></button>}
        {photos.length < 9 && <button aria-label="从相册选" onClick={() => add("album")}><Icon name="photo" size={22} /></button>}
      </div>
      <span className="t-cap c-sec">照片留作完成记录，点开这一项可以再看。{item.planAssignmentId ? "这是学习计划里的作业，记得去交给老师。" : ""}</span>
      {item.planAssignmentId && (
        <Button variant="tinted" icon="export" disabled={busy} onClick={async () => { if (photos.length) { setBusy(true); try { await uploadPhotos(item.id, photos); } catch (e) { toastError(e); } setBusy(false); } nav(`/plans/a/${item.planAssignmentId}`, { replace: true }); }}>去交给老师</Button>
      )}
      <Button disabled={busy} onClick={() => go(true, true)}>{next ? `完成，下一项：${next.title}` : "完成"}</Button>
      {photos.length === 0 ? (
        <Button variant="plain" disabled={busy} onClick={() => go(false, false)}>不拍照，回清单</Button>
      ) : (
        <Button variant="plain" disabled={busy} onClick={() => go(true, false)}>保存照片，回清单</Button>
      )}
    </Sheet>
  );
}
