import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, Sheet, Spinner } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { act, clockOf, deleteItem, groupBySubject, HW_SUBJECTS, hwSubjectLabel, loadDay, minSec, orderOf, tileSubject, updateItem, useHomework } from "../../lib/homework";
import { toastError } from "../../store/banner";
import { RemindSheet } from "./shared";

/** 08 点开一项：开始前看一眼、改提醒时间、改字 / 学科、删除；做完的看用时和完成照片 */
export default function Item() {
  const nav = useNavigate();
  const { id = "" } = useParams();
  const data = useHomework((s) => s.data);
  const item = data?.items.find((it) => it.id === id) ?? null;
  const [remind, setRemind] = useState(false);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item) loadDay().catch(toastError);
  }, [item]);

  if (!data) return <div className="screen"><InlineNav title="" back /><Spinner /></div>;
  if (!item) {
    return (
      <div className="screen">
        <InlineNav title="" back backLabel="首页" onBack={() => nav("/home", { replace: true })} />
        <div className="empty"><span className="empty__title">这一项不在了</span></div>
      </div>
    );
  }
  const flat = groupBySubject(data.items).flatMap((g) => g.items);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const start = () => run(() => act(item.id, "start"), () => nav(`/homework/focus/${item.id}`, { replace: true }));

  return (
    <div className="screen">
      <InlineNav
        title={`第 ${orderOf(data.items, item.id)} 项 / 共 ${data.items.length} 项`}
        back
        backLabel="首页"
        onBack={() => nav("/home", { replace: true })}
        right={<button className="nav-btn" onClick={() => { setTitle(item.title); setEdit(true); }}>修改</button>}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        <div className="hw-detail">
          <div className="hw-detail__top">
            <SubjectTile subject={tileSubject(item.subject)} size="xs" />
            {hwSubjectLabel(item.subject)}
            <em><Icon name="clock" size={13} stroke={2.2} />预计 {item.est} 分钟</em>
          </div>
          <h1>{item.title}</h1>
          {item.planAssignmentId && (
            <button className="hw-teacher t-cap" style={{ alignSelf: "flex-start" }} onClick={() => nav(`/plans/a/${item.planAssignmentId}`)}>
              <Icon name="graduation" size={12} stroke={2.4} />学习计划里老师布置的作业 · 做完可以直接交 ›
            </button>
          )}
        </div>

        {item.status === "done" ? (
          <div className="hw-detail">
            <div className="hw-donebox">
              <i><Icon name="check" size={22} stroke={3} /></i>
              <span>
                <b>用了 {minSec(item.used)}</b>
                <span>{clockOf(item.firstStartedAt)} 开始 · {clockOf(item.finishedAt)} 做完 · 预计 {item.est} 分钟</span>
              </span>
            </div>
            {item.photos.length > 0 && (
              <>
                <span className="t-cap c-sec">完成照片</span>
                <div className="hw-photos">{item.photos.map((p) => <img key={p.id} src={p.url} alt="完成照片" />)}</div>
              </>
            )}
          </div>
        ) : (
          <button className="hw-remind-card" disabled={item.status !== "todo"} onClick={() => setRemind(true)}>
            <ColorIcon name="remind" size={40} />
            <span>
              <b>提醒时间</b>
              <span>{item.chain ? "上一项做完就自动开始计时" : item.remindAt ? "到点提醒，并自动开始计时" : "还没设提醒，点这里设一个"}</span>
            </span>
            <strong>{item.chain ? "接着上一项" : item.remindAt ?? "去设置"}</strong>
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        )}
        {item.status === "todo" && item.used > 0 && <span className="t-cap c-sec" style={{ padding: "0 4px" }}>之前做过 {minSec(item.used)}，开始后接着计。</span>}
        {item.status === "todo" && <span className="t-cap c-sec" style={{ padding: "0 4px" }}>不想等到提醒时间，可以现在就开始。</span>}

        <div className="bottom-bar" style={{ flexDirection: "column" }}>
          {item.status === "done" ? (
            <Button variant="tinted" icon="undo" disabled={busy} onClick={() => run(() => act(item.id, "undo"))}>改回没做完</Button>
          ) : item.status === "todo" ? (
            <Button icon="play" disabled={busy} onClick={start}>现在开始</Button>
          ) : (
            <Button icon="timer" onClick={() => nav(`/homework/focus/${item.id}`, { replace: true })}>回到计时</Button>
          )}
        </div>
      </div>

      <RemindSheet item={remind ? item : null} first={flat[0]?.id === item.id} onClose={() => setRemind(false)} />
      <Sheet open={edit} onClose={() => setEdit(false)} title="修改这一项">
        <div className="hw-edit" style={{ border: 0, padding: 0 }}>
          <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} aria-label="作业内容" />
          <div className="hw-chips">
            {HW_SUBJECTS.map((s) => (
              <button key={s} className={`hw-chip${item.subject === s ? " hw-chip--on" : ""}`} onClick={() => run(() => updateItem(item.id, { subject: s }))}>{hwSubjectLabel(s)}</button>
            ))}
          </div>
          <Button disabled={busy || !title.trim()} onClick={() => run(() => updateItem(item.id, { title: title.trim() }), () => setEdit(false))}>保存</Button>
          <Button variant="plain" disabled={busy} onClick={() => run(() => deleteItem(item.id), () => nav("/homework", { replace: true }))}>
            <span style={{ color: "var(--wrong)" }}>删除这一项</span>
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
