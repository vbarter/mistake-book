import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Tag } from "../../components/v2";
import { PLAN_SUBJECT_LABEL, STATUS_LABEL, deletePlan, dueLabel, fetchPlan, isOverdue, memberName, removeMember, shareInvite, updatePlan, usePlans, type MemberAssignment, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { ConfirmSheet, NameSheet, PlanTile } from "./shared";

const STATUS_TAG: Record<MemberAssignment["status"], "pending" | "info" | "correct" | "wrong"> = { todo: "pending", submitted: "info", reviewed: "correct", returned: "wrong" };

/**
 * 学习计划页。创建人：今天已交 / 等你批阅、每份作业的进度、成员名单、转发、布置新作业。
 * 成员：只有自己的待交 / 已交和作业列表，看不到其他成员、人数和别人交没交。
 */
export default function PlanDetail() {
  const nav = useNavigate();
  const { planId = "" } = useParams();
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">("tasks");
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [planName, setPlanName] = useState("");
  const [confirm, setConfirm] = useState<"dissolve" | "leave" | "reset" | null>(null);
  const [removing, setRemoving] = useState<PlanMemberRow | null>(null);
  const [naming, setNaming] = useState(false);
  const version = usePlans((s) => s.version);

  const load = useCallback(() => fetchPlan(planId).then(setData).catch((e) => setError((e as Error).message || "打不开")), [planId]);
  useEffect(() => { void load(); }, [load, version]);

  if (error) return <div className="screen"><InlineNav title="学习计划" back /><Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>回到学习计划</Button>} /></div>;
  if (!data) return <div className="screen"><InlineNav title="学习计划" back /><Spinner /></div>;

  const { plan } = data;
  const owner = plan.role === "owner";
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, "success");
    } catch (e) {
      toastError(e);
    }
  };
  const forward = () => act(async () => {
    const first = data.assignments.find((a) => !a.revoked);
    await shareInvite({ plan, invite: data.invite!, title: first?.title, assignmentId: first?.id });
  });

  const right = (
    <>
      {owner && data.invite && <button className="plan-pill" onClick={forward}><Icon name="export" size={15} stroke={2.2} />转发</button>}
      <button className="nav-btn" aria-label="更多" onClick={() => setMenu(true)}><Icon name="ellipsis" size={22} stroke={2.2} /></button>
    </>
  );

  return (
    <div className="screen">
      <InlineNav title={plan.name} subtitle={`${PLAN_SUBJECT_LABEL[plan.subject] ?? "综合"} · ${owner ? "我创建的" : plan.teacher}`} back onBack={() => nav("/plans")} right={right} />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        {owner ? (
          <>
            <div className="plan-stats plan-stats--3">
              <div className="stat"><span className="stat__label">今天已交</span><span className="stat__value num">{plan.submittedToday ?? 0}</span></div>
              <div className="stat"><span className="stat__label">等你批阅</span><span className="stat__value num" style={{ color: (plan.toReview ?? 0) > 0 ? "var(--brand)" : undefined }}>{plan.toReview ?? 0}</span></div>
              <div className="stat"><span className="stat__label">成员</span><span className="stat__value num">{plan.members ?? 0}</span></div>
            </div>
            <Segmented value={tab} options={[{ value: "tasks", label: `作业 ${data.assignments.length}` }, { value: "members", label: `成员 ${data.members?.length ?? 0}` }]} onChange={setTab} />
            {tab === "tasks" && (
              <div className="group">
                {data.assignments.length === 0 && <div className="plan-files__empty">还没有作业，点下面「布置新作业」。</div>}
                {(data.assignments as OwnerAssignment[]).map((a) => {
                  const total = Math.max(1, a.members);
                  return (
                    <button key={a.id} className="plan-task" onClick={() => nav(`/plans/a/${a.id}`)}>
                      <span className="plan-task__head">
                        <span className="t-headline ellipsis" style={{ flex: 1 }}>{a.title}</span>
                        {a.toReview > 0 && <Tag kind="info" icon="pencil">待阅 {a.toReview}</Tag>}
                        <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </span>
                      {a.dueAt && <span className="t-foot c-sec">截止 {dueLabel(a.dueAt)}</span>}
                      <span className="plan-bar" aria-hidden="true">
                        <span style={{ width: `${(a.submitted / total) * 100}%`, background: "var(--mastered)" }} />
                        <span style={{ width: `${((a.missing - a.unseen) / total) * 100}%`, background: "var(--accent, #e08a2c)" }} />
                      </span>
                      <span className="plan-legend">
                        <span><i style={{ background: "var(--mastered)" }} />已交 {a.submitted}</span>
                        <span><i style={{ background: "var(--accent, #e08a2c)" }} />没交 {a.missing}</span>
                        <span><i style={{ background: "var(--fill)" }} />其中没看 {a.unseen}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {tab === "members" && (
              <div className="group">
                {(data.members ?? []).length === 0 && <div className="plan-files__empty">还没有人加入。把作业转发到微信群，同学点开卡片就自动加入了。</div>}
                {(data.members ?? []).map((m) => (
                  <div key={m.userId} className="row" style={{ minHeight: 56 }}>
                    <span className="plan-avatar" aria-hidden="true">{m.name.slice(-1)}</span>
                    <span className="row__main">
                      <span className="row__title ellipsis">{memberName(m)}</span>
                      <span className="row__sub">已交 {m.submitted}/{m.assignments} 份</span>
                    </span>
                    <button className="plan-file__x" aria-label={`移除 ${m.name}`} onClick={() => setRemoving(m)}><Icon name="xmark" size={16} stroke={2.4} /></button>
                  </div>
                ))}
              </div>
            )}
            {tab === "members" && (data.members ?? []).some((m) => m.tail) && <p className="t-cap c-sec" style={{ padding: "0 12px" }}>重名的同学后面带了手机尾号。他们在 App 里改名后，这里会跟着变。</p>}
            <div className="bottom-bar" style={{ marginTop: "auto" }}>
              <Button icon="plus" onClick={() => nav(`/plans/${plan.id}/new`)}>布置新作业</Button>
            </div>
          </>
        ) : (
          <>
            {data.me?.defaultName && (
              <div className="plan-banner">
                <Icon name="info" size={18} stroke={2.2} />
                <span>你的名字还是「{data.me.name}」，老师可能认不出你。</span>
                <button onClick={() => setNaming(true)}>去改名</button>
              </div>
            )}
            {(() => {
              const list = data.assignments as MemberAssignment[];
              const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned")).length;
              const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
              return (
                <>
                  <div className="plan-stats">
                    <div className="stat"><span className="stat__label">待交</span><span className="stat__value num" style={{ color: todo ? "var(--due)" : undefined }}>{todo}</span></div>
                    <div className="stat"><span className="stat__label">已交</span><span className="stat__value num">{handed}</span></div>
                  </div>
                  <div className="group">
                    <div className="group__header"><span>作业</span></div>
                    {list.length === 0 && <div className="plan-files__empty">老师还没有布置作业。</div>}
                    {list.map((a) => (
                      <button key={a.id} className="plan-task" onClick={() => nav(`/plans/a/${a.id}`)}>
                        <span className="plan-task__head">
                          <span className="t-headline ellipsis" style={{ flex: 1 }}>{a.title}</span>
                          {a.revoked ? <Tag kind="neutral">已撤回</Tag> : <Tag kind={STATUS_TAG[a.status]} icon={a.status === "todo" ? "clock" : undefined}>{STATUS_LABEL[a.status]}</Tag>}
                          <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                        </span>
                        <span className="t-foot c-sec">
                          {a.status === "todo" || a.status === "returned"
                            ? a.dueAt ? `${isOverdue(a.dueAt) ? "已过截止时间 " : "截止 "}${dueLabel(a.dueAt)}` : "没有截止时间"
                            : a.score ? `对 ${a.score.correct} · 错 ${a.score.wrong} · 没做 ${a.score.blank}${a.late ? " · 迟交" : ""}` : `批改中${a.late ? " · 迟交" : ""}`}
                        </span>
                        {a.comment && <span className="t-foot" style={{ color: a.status === "returned" ? "var(--wrong)" : "var(--secondary)" }}>老师：{a.comment}</span>}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={plan.name}>
        {owner ? (
          <div className="group" style={{ background: "var(--fill-light)" }}>
            <button className="row" onClick={() => { setMenu(false); setPlanName(plan.name); setRenaming(true); }}><span className="row__main"><span className="row__title">改计划名称</span></span></button>
            <button className="row" onClick={() => { setMenu(false); setConfirm("reset"); }}><span className="row__main"><span className="row__title">让以前转发的卡片失效</span><span className="row__sub">卡片被转到别处时用。已经加入的同学不受影响</span></span></button>
            <button className="row" style={{ color: "var(--wrong)" }} onClick={() => { setMenu(false); setConfirm("dissolve"); }}><span className="row__main"><span className="row__title">解散学习计划</span></span></button>
          </div>
        ) : (
          <div className="group" style={{ background: "var(--fill-light)" }}>
            <button className="row" onClick={() => { setMenu(false); setNaming(true); }}><span className="row__main"><span className="row__title">改名字</span><span className="row__sub">老师看到的是「{data.me?.name}」</span></span></button>
            <button className="row" style={{ color: "var(--wrong)" }} onClick={() => { setMenu(false); setConfirm("leave"); }}><span className="row__main"><span className="row__title">退出学习计划</span></span></button>
          </div>
        )}
      </Sheet>

      <Sheet open={renaming} onClose={() => setRenaming(false)} title="改计划名称">
        <input className="input" value={planName} maxLength={60} autoFocus onChange={(e) => setPlanName(e.target.value)} />
        <Button disabled={!planName.trim()} onClick={() => act(async () => { await updatePlan(plan.id, { name: planName.trim() }); setRenaming(false); await load(); }, "已更新")}>保存</Button>
      </Sheet>
      <ConfirmSheet open={confirm === "reset"} title="让以前转发的卡片失效？" text="之前发到微信里的卡片和链接都不能再用来加入。之后要邀请新同学，需要重新转发一次。" action="失效并换新的" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await updatePlan(plan.id, { resetInvite: true }); setConfirm(null); await load(); }, "旧卡片已失效，重新转发即可")} />
      <ConfirmSheet open={confirm === "dissolve"} danger title="解散这个学习计划？" text="计划、作业和同学交上来的内容都会从服务器删除，不能恢复。同学自己试卷里存的那份不受影响。" action="解散" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await deletePlan(plan.id); usePlans.getState().bump(); nav("/plans", { replace: true }); }, "已解散")} />
      <ConfirmSheet open={confirm === "leave"} danger title="退出这个学习计划？" text="退出后看不到这里的作业了。已经交过的作业老师还能看到。再点一次老师发的卡片可以重新加入。" action="退出" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, "me"); usePlans.getState().bump(); nav("/plans", { replace: true }); }, "已退出")} />
      <ConfirmSheet open={Boolean(removing)} danger title={`把「${removing ? memberName(removing) : ""}」移出学习计划？`} text="移出后对方看不到这里的作业了，已经交过的你还能看到。" action="移出" onClose={() => setRemoving(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, removing!.userId); setRemoving(null); await load(); }, "已移出")} />
      <NameSheet open={naming} onClose={() => setNaming(false)} onDone={(name) => { setNaming(false); toast(`已改成「${name}」，老师那边同步更新`, "success"); void load(); }} />
    </div>
  );
}
