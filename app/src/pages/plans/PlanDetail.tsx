import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon, WechatIcon, type IconName } from "../../components/Icon";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Stat, Tag } from "../../components/v2";
import { PLAN_SUBJECT_LABEL, STATUS_LABEL, deletePlan, dueLabel, fetchPlan, isOverdue, memberName, removeMember, shareInvite, updatePlan, usePlans, type MemberAssignment, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { useAuth } from "../../store/auth";
import { ConfirmSheet } from "./shared";

const STATUS_TAG: Record<MemberAssignment["status"], "pending" | "info" | "correct" | "wrong"> = { todo: "pending", submitted: "info", reviewed: "correct", returned: "wrong" };

/**
 * 学习计划页。创建人：今日已交 / 待批阅、每份作业的进度、成员名单、转发、布置新作业；点标题弹出面板：改名，下面是「让旧卡片失效」「解散」。
 * 成员点标题：改老师看到的名字、退出。页面上只留内容，不放这些不常用的操作。能用图标 + 数字说清的就不写字。
 * 成员：只有自己的待交 / 已交和作业列表，看不到其他成员、人数和别人交没交。
 */
export default function PlanDetail() {
  const nav = useNavigate();
  const { planId = "" } = useParams();
  const updateProfile = useAuth((st) => st.updateProfile);
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">("tasks");
  const [renaming, setRenaming] = useState(false);
  const [planName, setPlanName] = useState("");
  const [confirm, setConfirm] = useState<"dissolve" | "leave" | "reset" | null>(null);
  const [removing, setRemoving] = useState<PlanMemberRow | null>(null);
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

  const openPanel = () => { setPlanName(owner ? plan.name : data.me?.defaultName ? "" : data.me?.name ?? ""); setRenaming(true); };
  const saveName = () => act(async () => {
    const value = planName.trim();
    if (owner) await updatePlan(plan.id, { name: value });
    else await updateProfile({ nickname: value });
    setRenaming(false);
    await load();
  }, owner ? "已更新" : "已改名，老师那边同步更新");

  const count = (icon: IconName, color: string, n: number | string) => (
    <span className="plan-count" style={{ color }}><Icon name={icon} size={14} stroke={2.4} /><span className="num">{n}</span></span>
  );
  const due = (iso: string, late = false) => (
    <span className="plan-count" style={{ color: late ? "var(--wrong)" : "var(--secondary)" }}><Icon name="clock" size={14} stroke={2.2} />{dueLabel(iso)}</span>
  );
  const subject = PLAN_SUBJECT_LABEL[plan.subject] ?? "综合";

  return (
    <div className="screen">
      <InlineNav
        title={plan.name}
        subtitle={owner ? subject : `${subject} · ${plan.teacher}`}
        back
        onBack={() => nav("/plans")}
        onTitle={openPanel}
        right={owner && data.invite ? <button className="plan-pill" onClick={forward}><WechatIcon />转发</button> : undefined}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        {owner ? (
          <>
            <div className="plan-stats plan-stats--3">
              <Stat icon="checkcircle" label="今日已交" value={plan.submittedToday ?? 0} />
              <Stat icon="pencil" label="待批阅" value={plan.toReview ?? 0} color={(plan.toReview ?? 0) > 0 ? "var(--brand)" : undefined} />
              <Stat icon="family" label="成员" value={plan.members ?? 0} />
            </div>
            <Segmented value={tab} options={[{ value: "tasks", label: `作业 ${data.assignments.length}` }, { value: "members", label: `成员 ${data.members?.length ?? 0}` }]} onChange={setTab} />
            {tab === "tasks" && (
              <div className="group">
                {data.assignments.length === 0 && <div className="plan-files__empty">还没有作业</div>}
                {(data.assignments as OwnerAssignment[]).map((a) => {
                  const total = Math.max(1, a.members);
                  return (
                    <button key={a.id} className="plan-task" onClick={() => nav(`/plans/a/${a.id}`)}>
                      <span className="plan-task__head">
                        <span className="t-headline ellipsis" style={{ flex: 1 }}>{a.title}</span>
                        {a.revoked && <Tag kind="neutral">已撤回</Tag>}
                        {a.toReview > 0 && <Tag kind="info" icon="pencil">{a.toReview}</Tag>}
                        <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </span>
                      <span className="plan-bar" aria-hidden="true">
                        <span style={{ width: `${(a.submitted / total) * 100}%`, background: "var(--mastered)" }} />
                        <span style={{ width: `${((a.missing - a.unseen) / total) * 100}%`, background: "var(--accent, #e08a2c)" }} />
                      </span>
                      {/* 绿勾 = 已交，橙色时钟 = 没交，灰色闭眼 = 没交的人里还没看过的 */}
                      <span className="plan-counts" aria-label={`已交 ${a.submitted}，没交 ${a.missing}，其中没看 ${a.unseen}`}>
                        {count("checkcircle", "var(--mastered)", a.submitted)}
                        {count("clock", "var(--accent-on, #8a4b00)", a.missing)}
                        {count("eye-off", "var(--tertiary)", a.unseen)}
                        <span style={{ flex: 1 }} />
                        {a.dueAt && due(a.dueAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {tab === "members" && (
              <>
                <div className="group">
                  {(data.members ?? []).length === 0 && <div className="plan-files__empty">还没有人加入</div>}
                  {(data.members ?? []).map((m) => (
                    <div key={m.userId} className="row" style={{ minHeight: 56 }}>
                      <span className="plan-avatar" aria-hidden="true">{m.name.slice(-1)}</span>
                      <span className="row__main"><span className="row__title ellipsis">{memberName(m)}</span></span>
                      {count("checkcircle", m.assignments > 0 && m.submitted >= m.assignments ? "var(--mastered)" : "var(--tertiary)", `${m.submitted}/${m.assignments}`)}
                      <button className="plan-file__x" aria-label={`移除 ${m.name}`} onClick={() => setRemoving(m)}><Icon name="xmark" size={16} stroke={2.4} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="bottom-bar" style={{ marginTop: "auto" }}>
              <Button icon="plus" onClick={() => nav(`/plans/${plan.id}/new`)}>布置新作业</Button>
            </div>
          </>
        ) : (
          (() => {
            const list = data.assignments as MemberAssignment[];
            const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned")).length;
            const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
            return (
              <>
                {data.me?.defaultName && (
                  <button className="plan-banner" onClick={openPanel}>
                    <Icon name="person" size={18} stroke={2.2} />
                    <span style={{ flex: 1, textAlign: "left" }}>老师看到的名字是「{data.me.name}」</span>
                    <b>改名</b>
                  </button>
                )}
                <div className="plan-stats">
                  <Stat icon="clock" label="待交" value={todo} color={todo ? "var(--due)" : undefined} />
                  <Stat icon="checkcircle" label="已交" value={handed} />
                </div>
                <div className="group">
                  {list.length === 0 && <div className="plan-files__empty">还没有作业</div>}
                  {list.map((a) => {
                    const open = a.status === "todo" || a.status === "returned";
                    return (
                      <button key={a.id} className="plan-task" onClick={() => nav(`/plans/a/${a.id}`)}>
                        <span className="plan-task__head">
                          <span className="t-headline ellipsis" style={{ flex: 1 }}>{a.title}</span>
                          {a.revoked ? <Tag kind="neutral">已撤回</Tag> : <Tag kind={STATUS_TAG[a.status]} icon={a.status === "todo" ? "clock" : undefined}>{STATUS_LABEL[a.status]}</Tag>}
                          <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                        </span>
                        <span className="plan-counts">
                          {open ? (a.dueAt && due(a.dueAt, isOverdue(a.dueAt))) : a.score ? (
                            <>
                              {count("checkcircle", "var(--mastered)", a.score.correct)}
                              {count("xcircle", "var(--wrong)", a.score.wrong)}
                              {count("minus", "var(--tertiary)", a.score.blank)}
                            </>
                          ) : <span className="t-foot c-sec">批改中</span>}
                          {!open && a.late && <span className="t-foot c-sec">迟交</span>}
                        </span>
                        {a.comment && (
                          <span className="plan-count" style={{ alignItems: "flex-start", fontWeight: 400, color: a.status === "returned" ? "var(--wrong)" : "var(--secondary)" }}>
                            <Icon name="bubble" size={14} stroke={2.2} style={{ marginTop: 2, flexShrink: 0 }} />
                            <span style={{ flex: 1, textAlign: "left" }}>{a.comment}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()
        )}
      </div>

      {/* 点标题弹出：改名在上面，不常用的操作安静地放在下面，页面上不再占地方 */}
      <Sheet open={renaming} onClose={() => setRenaming(false)} title={owner ? "学习计划" : plan.name}>
        <label className="plan-field">
          <span className="plan-field__label">{owner ? "名称" : "老师看到的名字"}</span>
          <input className="input" value={planName} maxLength={owner ? 60 : 16} onChange={(e) => setPlanName(e.target.value)} />
        </label>
        <Button disabled={!planName.trim() || planName.trim() === (owner ? plan.name : data.me?.name)} onClick={saveName}>保存</Button>
        <div className="plan-quiet">
          {owner && <button onClick={() => { setRenaming(false); setConfirm("reset"); }}>让旧卡片失效</button>}
          <button className="plan-quiet__danger" onClick={() => { setRenaming(false); setConfirm(owner ? "dissolve" : "leave"); }}>{owner ? "解散学习计划" : "退出学习计划"}</button>
        </div>
      </Sheet>
      <ConfirmSheet open={confirm === "reset"} title="让以前转发的卡片失效？" text="之前发到微信里的卡片和链接都不能再用来加入。之后要邀请新同学，需要重新转发一次。" action="失效并换新的" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await updatePlan(plan.id, { resetInvite: true }); setConfirm(null); await load(); }, "旧卡片已失效，重新转发即可")} />
      <ConfirmSheet open={confirm === "dissolve"} danger title="解散这个学习计划？" text="计划、作业和同学交上来的内容都会从服务器删除，不能恢复。同学自己试卷里存的那份不受影响。" action="解散" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await deletePlan(plan.id); usePlans.getState().bump(); nav("/plans", { replace: true }); }, "已解散")} />
      <ConfirmSheet open={confirm === "leave"} danger title="退出这个学习计划？" text="退出后看不到这里的作业了。已经交过的作业老师还能看到。再点一次老师发的卡片可以重新加入。" action="退出" onClose={() => setConfirm(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, "me"); usePlans.getState().bump(); nav("/plans", { replace: true }); }, "已退出")} />
      <ConfirmSheet open={Boolean(removing)} danger title={`把「${removing ? memberName(removing) : ""}」移出学习计划？`} text="移出后对方看不到这里的作业了，已经交过的你还能看到。" action="移出" onClose={() => setRemoving(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, removing!.userId); setRemoving(null); await load(); }, "已移出")} />
    </div>
  );
}
