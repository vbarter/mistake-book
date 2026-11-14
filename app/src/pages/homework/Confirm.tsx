import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, InlineNav } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { addItems, groupBySubject, HW_SUBJECTS, hwSubjectLabel, newKey, tileSubject, useHomework, type DraftItem } from "../../lib/homework";
import { toast, toastError } from "../../store/banner";

/** 05 识别结果：确认和修改。点一项可以改字、换学科；× 删除；学习计划里还没对上的作业可以勾上一起加 */
export default function Confirm() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const day = params.get("day") || undefined;
  const draft = useHomework((s) => s.draft);
  const planDue = useHomework((s) => s.planDue);
  const setDraft = useHomework((s) => s.setDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  /** 已经存好、正在离开这一页：清草稿时不要再跳回清单 */
  const leaving = useRef(false);

  // 刷新页面后草稿没了：回清单
  useEffect(() => {
    if (!leaving.current && !draft.length && !planDue.length) nav("/homework", { replace: true });
  }, [draft.length, planDue.length, nav]);

  const change = (key: string, patch: Partial<DraftItem>) => setDraft(draft.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => {
    setDraft(draft.filter((d) => d.key !== key));
    if (editing === key) setEditing(null);
  };
  const extra: DraftItem[] = planDue
    .filter((p) => picked[p.assignmentId])
    .map((p) => ({ key: newKey(), title: p.title, subject: p.subject ?? "other", est: 25, source: "plan", planAssignmentId: p.assignmentId, teacher: p.teacher }));
  const total = draft.filter((d) => d.title.trim()).length + extra.length;
  /** 按页面上看到的顺序（按学科分好）存，排时间、「接着上一项」都按这个顺序 */
  const toSave = () => groupBySubject([...draft.filter((d) => d.title.trim()), ...extra]).flatMap((g) => g.items).map(({ key: _key, teacher: _t, ...rest }) => rest);

  // 不管从哪儿离开（返回首页、系统返回键），已经录入的先存进清单，不丢
  const pending = useRef(toSave);
  pending.current = toSave;
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // 等一拍再存：开发模式下 StrictMode 会先卸载再装回来，装回来了就不是真的离开
      setTimeout(() => {
        if (alive.current || leaving.current) return;
        const items = pending.current();
        setDraft([], []);
        if (items.length) addItems(items, day).then(() => toast(`已存进清单，${items.length} 项`)).catch(toastError);
      }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const next = async () => {
    setBusy(true);
    try {
      await addItems(toSave(), day);
      leaving.current = true;
      setDraft([], []);
      nav(`/homework/remind${day ? `?day=${day}` : ""}`, { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav title="确认清单" back backLabel="首页" onBack={() => nav("/home", { replace: true })} />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 4, gap: 4 }}>
        <div className="hw-banner">
          <ColorIcon name="todo" size={40} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b>识别出 {draft.length} 项，已按学科分好</b>
            <span>点一项可以改字、换学科；点 × 删掉</span>
          </span>
        </div>
        {groupBySubject(draft).map((g) => (
          <section key={g.subject}>
            <div className="hw-sech">
              <SubjectTile subject={tileSubject(g.subject)} size="xs" />
              {hwSubjectLabel(g.subject)}
              <em>{g.items.length} 项</em>
            </div>
            <div className="hw-list">
              {g.items.map((d) =>
                editing === d.key ? (
                  <div key={d.key} className="hw-edit">
                    <input autoFocus value={d.title} maxLength={60} onChange={(e) => change(d.key, { title: e.target.value })} aria-label="作业内容" />
                    <div className="hw-chips">
                      <span className="t-cap c-sec">学科</span>
                      {HW_SUBJECTS.map((s) => (
                        <button key={s} className={`hw-chip${d.subject === s ? " hw-chip--on" : ""}`} onClick={() => change(d.key, { subject: s })}>{hwSubjectLabel(s)}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <button className="t-foot" style={{ color: "var(--wrong)", display: "inline-flex", gap: 4, alignItems: "center" }} onClick={() => remove(d.key)}><Icon name="trash" size={14} />删除</button>
                      <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 700 }} onClick={() => setEditing(null)}>完成</button>
                    </div>
                  </div>
                ) : (
                  <div key={d.key} className="hw-row">
                    <button className="hw-main" style={{ textAlign: "left" }} onClick={() => setEditing(d.key)}>
                      <span className="hw-title ellipsis">{d.title || "（空）"}</span>
                      {d.planAssignmentId && <span className="hw-sub"><span className="hw-teacher"><Icon name="graduation" size={11} stroke={2.4} />对上了{d.teacher || "老师"}布置的作业</span></span>}
                    </button>
                    <button className="hw-x" aria-label="删除" onClick={() => remove(d.key)}><Icon name="xmark" size={13} stroke={2.6} /></button>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
        {planDue.length > 0 && (
          <div className="hw-plan" style={{ marginTop: 10 }}>
            <span className="hw-plan__h"><Icon name="graduation" size={13} stroke={2.4} />学习计划里今天还有 {planDue.length} 份作业</span>
            {planDue.map((p) => (
              <label key={p.assignmentId}>
                <input type="checkbox" checked={!!picked[p.assignmentId]} onChange={(e) => setPicked({ ...picked, [p.assignmentId]: e.target.checked })} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="hw-title ellipsis">{p.title}</span>
                  <span className="t-cap c-sec ellipsis">{p.planName} · {p.teacher}{p.dueAt ? ` · ${dueText(p.dueAt)} 截止` : ""}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="bottom-bar">
          <Button disabled={busy || total === 0} style={{ flex: 1 }} onClick={next}>下一步：设置提醒时间 · {total} 项</Button>
        </div>
      </div>
    </div>
  );
}

function dueText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
