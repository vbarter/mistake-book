import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { RoleIcon } from "../../components/RoleIcon";
import { Button, Empty, Sheet, Spinner } from "../../components/ui";
import { act, alarmKey, CHALK, clockOf, focusRingSvg, groupBySubject, hwSubjectLabel, liveUsed, loadDay, minSec, mmss, nextTodo, orderOf, uploadPhotos, useHomework, type ChalkTone, type HwItem } from "../../lib/homework";
import { useTheme } from "../../lib/theme";
import { haptic, pickImages, takePhoto } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useTick } from "./shared";

const MORE_MINUTES = 10;

/** 烘好的粉笔数字（tools/chalk-digits.mjs）：<色>-<字>.png，冒号是 c */
const DIGITS = import.meta.glob<string>("../../assets/chalk/num/*.png", { eager: true, import: "default" });
const digit = (tone: ChalkTone, ch: string) => DIGITS[`../../assets/chalk/num/${tone}-${ch === ":" ? "c" : ch}.png`];

/** 黑板上的计时数字：一个字一张图，数字格子等宽，跳秒时不晃。超过一小时（1:05:32）整体缩小一号，还在圈里 */
function ChalkTime({ text, tone }: { text: string; tone: ChalkTone }) {
  return (
    <span className={`fb__t${text.length > 5 ? " fb__t--long" : ""}`} role="timer" aria-label={text} style={{ color: CHALK[tone] }}>
      {[...text].map((ch, i) => <img key={i} className={ch === ":" ? "fb__tc" : "fb__td"} src={digit(tone, ch)} alt="" />)}
    </span>
  );
}

const DOODLE = {
  sun: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>,
  star: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" /></svg>,
};

/** 10 计时中 · 11 做完了（停表、完成拍照）· 13 超时（卡住了怎么办）。整块计时区是一块黑板（和首页同一套），左下角是拿秒表的试卷小人 */
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
  const theme = useTheme((s) => s.theme);
  const dark = useTheme((s) => s.dark);
  // 圆环头上那颗点用领带色；SVG 属性里用不了 CSS 变量，换主题时取一次
  const tie = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue("--tie").trim() || "#a3303f", [theme, dark]); // eslint-disable-line react-hooks/exhaustive-deps
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

  if (!data) return <div className="fz"><Spinner /></div>;
  if (!item && !finished) {
    return (
      <div className="fz">
        <div className="fz__nav"><button className="fz__close" onClick={() => nav("/homework", { replace: true })}><Icon name="chevron-down" size={16} stroke={2.6} />收起</button></div>
        <Empty icon="document" title="这一项不在了" />
      </div>
    );
  }
  const cur = (item ?? finished)!;
  const idx = orderOf(data.items, cur.id);
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
  const left = Math.ceil((estSec - used) / 60);
  const paused = cur.status === "paused";
  const done = cur.status === "done" || !!finished;
  const diff = used - estSec;
  const tone: ChalkTone = done ? "g" : over ? "o" : "w";
  const flat = groupBySubject(data.items).flatMap((g) => g.items);
  const started = cur.firstStartedAt ? `${clockOf(cur.firstStartedAt)} ${cur.autoStarted ? "自动开始" : "开始"}` : "";

  return (
    <div className={`fz${done ? " fz--done" : over ? " fz--over" : paused ? " fz--paused" : ""}`}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="fz-chalk" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={2} seed={3} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.05" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </svg>
      <div className="fz__nav">
        <button className="fz__close" onClick={close}><Icon name="chevron-down" size={16} stroke={2.6} />收起</button>
      </div>

      <div className="fb">
        <div className="fb__face">
          <div className="fb__row">
            <span className="fb__tag">第<b>{idx}</b>项 / 共<b>{data.items.length}</b>项</span>
            <span className="fb__subj">{hwSubjectLabel(cur.subject)}</span>
          </div>
          <div className="fb__title">{cur.title}</div>
          <svg className="fb__line" width="120" height="8" viewBox="0 0 120 8" fill="none" aria-hidden="true"><path d="M2 6C30 2.5 76 1.5 118 3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
          <div className="fb__ring">
            <span className="fb__ringsvg" dangerouslySetInnerHTML={{ __html: focusRingSvg({ used, est: estSec, paused, done, tie, filter: "fz-chalk" }) }} />
            <div className="fb__in">
              <ChalkTime text={mmss(used)} tone={tone} />
              {done ? (
                <span className="fb__s">{diff > 0 ? `超了 ${minSec(diff)}` : `快了 ${minSec(-diff)}`}</span>
              ) : over ? (
                <span className="fb__badge">已超 <b>{Math.floor(diff / 60)}</b> 分钟</span>
              ) : (
                <span className="fb__s">{paused ? "已暂停" : "计时中"} · 还剩 <b>{left}</b> 分</span>
              )}
            </div>
          </div>
          <span className="fb__doodle fb__doodle--r" aria-hidden="true">{done ? DOODLE.star : DOODLE.sun}</span>
          <span className="fb__doodle fb__doodle--l" aria-hidden="true">{DOODLE.star}</span>
          <span className="fb__est">预计 <b>{cur.est}</b> 分钟{started && <><br />{started}</>}</span>
          {paused && <span className="fb__zz" aria-hidden="true">z z</span>}
          <RoleIcon name={done ? "done" : over ? "stuck" : "focus"} size={112} shadow={false} className="fb__buddy" />
        </div>
        <span className="fb__tray" aria-hidden="true"><i /><i /></span>
      </div>

      <div className="fs">
        <span className="fs__l"><small>今天做完</small><b><i>{data.summary.done}</i> / {data.items.length} 项</b></span>
        <span className="fs__dots">
          {flat.map((it, i) => (
            <span key={it.id} className={`fs__d${it.id === cur.id && !done ? " cur" : it.status === "done" ? " done" : ""}`}>
              <span className="fs__c">{it.status === "done" ? <Icon name="check" size={14} stroke={3} /> : i + 1}</span>
              {hwSubjectLabel(it.subject).slice(0, 1)}
            </span>
          ))}
        </span>
      </div>
      {cur.planAssignmentId && (
        <button className="fz__link" onClick={() => nav(`/plans/a/${cur.planAssignmentId}`)}><Icon name="document" size={15} stroke={2.2} />看老师布置的作业<Icon name="chevron-right" size={12} stroke={2.6} /></button>
      )}

      <div className="fc">
        {paused ? (
          <button className="fc__b" disabled={busy} onClick={() => run(() => act(cur.id, "resume"))}><span className="fc__box"><span className="fc__i"><Icon name="play" size={24} fill /></span></span>继续</button>
        ) : (
          <button className="fc__b" disabled={busy || cur.status !== "running"} onClick={() => run(() => act(cur.id, "pause"))}><span className="fc__box"><span className="fc__i"><Icon name="pause" size={24} stroke={3} /></span></span>暂停</button>
        )}
        <button className="fc__b fc__b--main" disabled={busy || cur.status === "done"} onClick={finish}><span className="fc__box"><span className="fc__main"><Icon name="check" size={40} stroke={3.2} /></span></span>做完了</button>
        <button className="fc__b" disabled={busy} onClick={() => setStuck(true)}><span className="fc__box"><span className="fc__i"><Icon name="help" size={26} stroke={2.2} /></span></span>卡住了</button>
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
