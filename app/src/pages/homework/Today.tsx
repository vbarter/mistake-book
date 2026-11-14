import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Buddy } from "../../components/Illustration";
import { Button, InlineNav, Spinner } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import {
  act, clockOf, dayLabel, groupBySubject, hourMin, hwSubjectLabel, liveUsed, loadDay, nextTodo, orderOf, parseHomework, shiftDay, tileSubject, useHomework,
  type HwDay, type HwItem,
} from "../../lib/homework";
import { pickImages, takePhoto } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { RemindChip, useTick } from "./shared";

/** 今天作业计划：清单（没有事项时是录入页），底下一直有录入条 */
export default function Today() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const data = useHomework((s) => s.data);
  const fetchedAt = useHomework((s) => s.fetchedAt);
  const setDraft = useHomework((s) => s.setDraft);
  const day = params.get("day") || undefined;
  const [parsing, setParsing] = useState<{ photos: number; text: boolean } | null>(null);
  const [text, setText] = useState("");
  const shown = data && (!day || data.day === day) ? data : null;
  const running = shown?.items.some((it) => it.status === "running") ?? false;
  const now = useTick(running);

  useEffect(() => {
    loadDay(day).catch(toastError);
  }, [day]);
  // 停在这一页时，到下一项的提醒时间刷新一次（服务端那边就自动开始了）
  useEffect(() => {
    if (!shown?.summary.nextAt || shown.day !== shown.today) return;
    const t = setInterval(() => loadDay(day).catch(() => undefined), 30000);
    return () => clearInterval(t);
  }, [shown?.summary.nextAt, shown?.day, shown?.today, day]);

  const submit = async (images: string[]) => {
    const words = text.trim();
    if (!words && !images.length) return;
    setParsing({ photos: images.length, text: !!words });
    try {
      const res = await parseHomework(words, images, shown?.day);
      if (!res.items.length && !res.planDue.length) {
        toast(images.length ? "照片里没认出作业，换一张或者打字试试" : "没认出作业，换个说法试试");
        return;
      }
      setDraft(res.items, res.planDue);
      setText("");
      nav(`/homework/confirm${shown ? `?day=${shown.day}` : ""}`);
    } catch (e) {
      toastError(e);
    } finally {
      setParsing(null);
    }
  };
  const camera = async () => {
    try {
      const src = await takePhoto();
      if (src) await submit([src]);
    } catch (e) {
      toastError(e);
    }
  };
  const album = async () => {
    try {
      const list = await pickImages(6);
      if (list.length) await submit(list);
    } catch (e) {
      toastError(e);
    }
  };

  const input = (
    <div className="hw-dock">
      {!shown?.items.length && <span className="hw-dock__hint">打一句、拍一张，或者直接打字；粘贴一大段会自动拆成多项</span>}
      <form className="hw-input" onSubmit={(e) => { e.preventDefault(); void submit([]); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="添加一项，如「背 U6 单词」" enterKeyHint="send" aria-label="添加作业" />
        {text.trim() ? (
          <button type="submit" className="hw-ib hw-ib--send" aria-label="添加"><Icon name="check" size={20} stroke={2.6} /></button>
        ) : (
          <>
            <button type="button" className="hw-ib" aria-label="拍照" onClick={camera}><Icon name="camera" size={20} /></button>
            <button type="button" className="hw-ib" aria-label="从相册选" onClick={album}><Icon name="photo" size={20} /></button>
          </>
        )}
      </form>
    </div>
  );

  if (parsing) return <Parsing photos={parsing.photos} text={parsing.text} />;

  return (
    <div className="screen">
      <InlineNav title="今天作业计划" back backLabel="首页" onBack={() => nav("/home")} />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 4, gap: 4 }}>
        {!shown && <Spinner />}
        {shown && (
          <>
            <div className="hw-head">
              <div className="hw-day">
                <button aria-label="前一天" onClick={() => setParams({ day: shiftDay(shown.day, -1) }, { replace: true })}><Icon name="chevron-left" size={14} stroke={2.4} /></button>
                {dayLabel(shown.day)}
                {shown.day !== shown.today && (
                  <button aria-label="后一天" onClick={() => setParams(shiftDay(shown.day, 1) === shown.today ? {} : { day: shiftDay(shown.day, 1) }, { replace: true })}><Icon name="chevron-right" size={14} stroke={2.4} /></button>
                )}
              </div>
              {shown.items.length > 0 && <Headline data={shown} fetchedAt={fetchedAt} now={now} />}
            </div>
            {shown.items.length === 0 ? <EmptyDay /> : shown.summary.allDone ? <AllDone data={shown} /> : <ItemList data={shown} now={now} />}
          </>
        )}
        <div className="bottom-bar" style={{ flexDirection: "column" }}>
          {shown && <MainAction data={shown} />}
          {input}
        </div>
      </div>
    </div>
  );
}

function Headline({ data, fetchedAt, now }: { data: HwDay; fetchedAt: number; now: number }) {
  const s = data.summary;
  const used = data.items.reduce((n, it) => n + liveUsed(it, fetchedAt, now), 0);
  const nextIdx = s.nextId ? orderOf(data.items, s.nextId) : 0;
  const started = s.done > 0 || s.currentId || s.startedAt;
  return (
    <>
      {s.allDone ? null : started ? (
        <div className="hw-big">还剩 {s.left} 项<small>做完 {s.done} 项</small></div>
      ) : (
        <div className="hw-big">共 {s.total} 项<small>还没开始</small></div>
      )}
      {started && !s.allDone && <div className="hw-bar"><i style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} /></div>}
      <div className="hw-meta">
        {started && !s.allDone && <span><Icon name="clock" size={13} stroke={2.2} />已用 <b>{hourMin(used)}</b></span>}
        {s.nextAt && <span><ColorIcon name="remind" size={16} />{s.nextAt} 自动开始第 {nextIdx} 项</span>}
      </div>
    </>
  );
}

function EmptyDay() {
  return (
    <>
      <div className="hw-empty">
        <Buddy scene="empty" size={120} />
        <b>今天要做什么？</b>
        <span className="t-sub">在下面打一句、拍一张，或者直接打字。</span>
      </div>
      <div className="hw-ways">
        <div><Icon name="pencil" size={18} />「写周记，再做练习部分第 13 课」</div>
        <div><Icon name="camera" size={18} />拍黑板、家校本，自动拆成一项一项</div>
        <div><Icon name="photo" size={18} />群里老师发的作业截图</div>
        <div><Icon name="document" size={18} />粘贴老师的消息，一段话也能拆开</div>
      </div>
    </>
  );
}

function ItemList({ data, now }: { data: HwDay; now: number }) {
  const nav = useNavigate();
  const toggle = async (it: HwItem) => {
    try {
      await act(it.id, it.status === "done" ? "undo" : "finish");
    } catch (e) {
      toastError(e);
    }
  };
  const groups = groupBySubject(data.items);
  return (
    <>
      {groups.map((g) => (
        <section key={g.subject}>
          <div className="hw-sech">
            <SubjectTile subject={tileSubject(g.subject)} size="xs" />
            {hwSubjectLabel(g.subject)}
            <em>{g.items.every((it) => it.status === "done") ? "做完了" : `${g.items.filter((it) => it.status !== "done").length} 项`}</em>
          </div>
          <div className="hw-list">
            {g.items.map((it) => (
              <div key={it.id} className={`hw-row${it.status === "done" ? " hw-row--done" : ""}${it.status === "running" || it.status === "paused" ? " hw-row--current" : ""}`}>
                <button
                  className={`hw-check${it.status === "done" ? " hw-check--done" : it.status === "running" || it.status === "paused" ? " hw-check--run" : ""}`}
                  aria-label={it.status === "done" ? "改回没做完" : "做完了"}
                  onClick={() => toggle(it)}
                >
                  {it.status === "done" && <Icon name="check" size={14} stroke={3} />}
                </button>
                <button className="hw-main" style={{ textAlign: "left" }} onClick={() => nav(it.status === "running" || it.status === "paused" ? `/homework/focus/${it.id}` : `/homework/${it.id}`)}>
                  <span className="hw-title ellipsis">{it.title}</span>
                  {(it.planAssignmentId || (it.status === "done" && it.used > it.est * 60)) && (
                    <span className="hw-sub">
                      {it.planAssignmentId && <span className="hw-teacher"><Icon name="graduation" size={11} stroke={2.4} />学习计划</span>}
                      {it.status === "done" && it.used > it.est * 60 && <span className="hw-over">超 {Math.round(it.used / 60 - it.est)} 分</span>}
                    </span>
                  )}
                </button>
                <RemindChip item={it} now={now} />
              </div>
            ))}
          </div>
        </section>
      ))}
      <span className="t-cap c-sec" style={{ padding: "8px 4px" }}>点右边的时间可以改；不想等可以直接开始。</span>
    </>
  );
}

function MainAction({ data }: { data: HwDay }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const s = data.summary;
  if (!data.items.length || data.day !== data.today) return null;
  if (s.allDone) return null;
  if (s.currentId) {
    const cur = data.items.find((it) => it.id === s.currentId)!;
    return <Button icon="timer" onClick={() => nav(`/homework/focus/${cur.id}`)}>{cur.status === "paused" ? "继续" : "回到计时"}：{cur.title}</Button>;
  }
  const next = nextTodo(data.items);
  if (!next) return null;
  const start = async () => {
    setBusy(true);
    try {
      await act(next.id, "start");
      nav(`/homework/focus/${next.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const waiting = !!s.nextAt;
  const idx = orderOf(data.items, next.id);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button icon="play" disabled={busy} style={{ flex: 1 }} onClick={start}>
        {waiting ? "不等了，现在开始" : "现在就开始"}{s.left === 1 ? "最后一项" : `第 ${idx} 项`}
      </Button>
      <Button variant="tinted" ariaLabel="设置提醒时间" onClick={() => nav(`/homework/remind?day=${data.day}`)} style={{ flex: "0 0 52px", padding: 0 }}>
        <ColorIcon name="remind" size={26} />
      </Button>
    </div>
  );
}

/** 全部做完：总用时、每项用时（竖线是预计用时） */
function AllDone({ data }: { data: HwDay }) {
  const nav = useNavigate();
  const s = data.summary;
  const max = Math.max(...data.items.map((it) => Math.max(it.used, it.est * 60)), 60);
  const photos = data.items.reduce((n, it) => n + it.photoCount, 0);
  return (
    <>
      <div className="hw-alldone">
        <ColorIcon name="done" size={72} />
        <b>作业全做完了</b>
        <span>{clockOf(s.startedAt)} 开始，{clockOf(s.finishedAt)} 做完，计时已结束。</span>
      </div>
      <div className="hw-stats">
        <div><b>{hourMin(s.used)}</b><span>实际用时</span></div>
        <div><b>{s.total}<small> 项</small></b><span>全部完成</span></div>
        <div><b>{hourMin(s.est * 60)}</b><span>预计用时</span></div>
      </div>
      <div className="hw-bars">
        <div className="hw-bars__h">每项用时<span>竖线是预计用时</span></div>
        {groupBySubject(data.items).flatMap((g) => g.items).map((it) => (
          <div key={it.id} className="hw-bars__r">
            <span className="ellipsis">{it.title}</span>
            <span className="hw-bars__t">
              <i className={it.used > it.est * 60 ? "hw-bars--over" : ""} style={{ width: `${(it.used / max) * 100}%` }} />
              <b style={{ left: `${((it.est * 60) / max) * 100}%` }} />
            </span>
            <em>{Math.max(1, Math.round(it.used / 60))} 分</em>
          </div>
        ))}
      </div>
      {photos > 0 && <span className="t-cap c-sec" style={{ padding: "4px", textAlign: "center" }}>拍了 {photos} 张完成照片，点开每一项可以看</span>}
      <Button variant="plain" onClick={() => nav("/home")}>好的</Button>
    </>
  );
}

/** 04 正在生成清单 */
function Parsing({ photos, text }: { photos: number; text: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setStep(1), 1800), setTimeout(() => setStep(2), 4500)];
    return () => t.forEach(clearTimeout);
  }, []);
  const what = [photos ? `${photos} 张照片` : "", text ? "1 段文字" : ""].filter(Boolean).join(" · ");
  const dot = (i: number) => <span className={`hw-dot ${step > i ? "hw-dot--ok" : step === i ? "hw-dot--run" : "hw-dot--wait"}`}>{step > i && <Icon name="check" size={13} stroke={3} />}</span>;
  return (
    <div className="screen">
      <InlineNav title="今天作业计划" />
      <div className="screen__content screen__content--modal" style={{ gap: 16 }}>
        <div className="hw-empty">
          <Buddy scene="scan" size={120} />
          <b>{photos ? "正在把照片拆成事项" : "正在拆成一项一项"}</b>
          <span className="t-sub">大约 10 秒，好了就自动打开清单。</span>
        </div>
        <div className="hw-steps">
          <div>{dot(0)}{photos ? "看懂照片和文字" : "看懂这段话"}<span className="t-cap c-sec" style={{ marginLeft: "auto" }}>{what}</span></div>
          <div>{dot(1)}拆成一项一项</div>
          <div>{dot(2)}按学科分好</div>
          <div className={step < 2 ? "hw-off" : ""}>{dot(3)}对一下学习计划里的作业</div>
        </div>
      </div>
    </div>
  );
}
