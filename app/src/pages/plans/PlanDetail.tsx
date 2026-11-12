import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon, WechatIcon, type IconName } from "../../components/Icon";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Avatar, Stat, Tag } from "../../components/v2";
import { planSubjectText, deletePlan, dueLabel, fetchPlan, fileBadge, memberName, memberState, planGone, removeMember, revokeAssignment, shareInvite, sizeLabel, updatePlan, usePlans, type MemberItem, type MemberState, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { useAuth } from "../../store/auth";
import { openFile } from "./Assignment";
import { PlanMember } from "./PlanMember";
import { ConfirmSheet, PlanCreator, ScoreCounts } from "./shared";

type Filter = "all" | Exclude<MemberState, "none">;
/** 从批阅页回来还停在刚才的页签和筛选上 */
let remembered: { planId: string; tab: "tasks" | "members"; filter: Filter } | null = null;

/**
 * 学习计划页。创建人在这一页看完所有东西，不再有单独的「作业情况」页：
 * 顶部今日已交 / 未交 / 总成员；「作业」平铺每份作业的文件（点文件直接打开，点作业名：转发、提醒没交的、撤回）；
 * 「成员」列头像 + 名字 + 已交 / 未交，可按状态筛选，点一个人看他每份作业的情况并进去批阅、移出。
 * 点标题弹出面板：改名，下面是「让旧卡片失效」「解散」。
 * 成员点标题：改老师看到的名字、退出。页面上只留内容，不放这些不常用的操作。能用图标 + 数字说清的就不写字。
 * 成员：只有自己的待交 / 已交和作业（见 PlanMember），看不到其他成员、人数和别人交没交。
 */
/** 一个成员在一份作业上的状态：没看 / 未交 / 退回 / 待阅 / 已阅 */
const itemTag = (it: MemberItem) =>
  it.status === "submitted" ? <Tag kind="info" icon="pencil">待阅</Tag>
    : it.status === "reviewed" ? <Tag kind="correct">已阅</Tag>
      : it.status === "returned" ? <Tag kind="wrong" icon="refresh">退回</Tag>
        : <Tag kind="pending" icon={it.viewed ? "clock" : "eye-off"}>{it.viewed ? "未交" : "没看"}</Tag>;

export default function PlanDetail() {
  const nav = useNavigate();
  const { planId = "" } = useParams();
  const updateProfile = useAuth((st) => st.updateProfile);
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">(remembered?.planId === planId ? remembered.tab : "tasks");
  const [filter, setFilter] = useState<Filter>(remembered?.planId === planId ? remembered.filter : "all");
  const [member, setMember] = useState<PlanMemberRow | null>(null);
  const [task, setTask] = useState<OwnerAssignment | null>(null);
  const [revoking, setRevoking] = useState<OwnerAssignment | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [planName, setPlanName] = useState("");
  const [confirm, setConfirm] = useState<"dissolve" | "leave" | "reset" | null>(null);
  const [removing, setRemoving] = useState<PlanMemberRow | null>(null);
  const version = usePlans((s) => s.version);
  useEffect(() => { remembered = { planId, tab, filter }; }, [planId, tab, filter]);

  // 已经显示出来了，一次没拉到（没网）不换成报错页；但计划被解散 / 自己被移出了，就不能再留着旧内容
  const shown = useRef(false);
  const load = useCallback(() => fetchPlan(planId).then((r) => { shown.current = true; setData(r); setError(""); }).catch((e) => {
    if (shown.current && !planGone(e)) return;
    setError((e as Error).message || "打不开");
    if (shown.current) {
      shown.current = false;
      setData(null);
      usePlans.getState().bump(); // 首页和列表里也把它去掉
    }
  }), [planId]);
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
  const forward = (a: { id: string; title: string } | undefined = data.assignments.find((x) => !x.revoked), remind = false) =>
    act(() => shareInvite({ plan, invite: data.invite!, title: a?.title, assignmentId: a?.id, remind }));

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
  const subject = planSubjectText(plan.subject);

  return (
    <div className="screen">
      <InlineNav
        title={plan.name}
        subtitle={subject || undefined}
        back
        onBack={() => nav("/plans")}
        onTitle={openPanel}
        right={owner && data.invite ? <button className="plan-pill" onClick={() => forward()}><WechatIcon />转发</button> : undefined}
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        {owner ? (
          (() => {
            const tasks = data.assignments as OwnerAssignment[];
            const rows = data.members ?? [];
            const active = rows.filter((m) => !m.left);
            const handed = active.filter((m) => memberState(m) === "submitted").length;
            const missing = plan.missing ?? active.filter((m) => memberState(m) === "missing").length;
            const shown = filter === "all" ? rows : active.filter((m) => memberState(m) === filter);
            const filters: { value: Filter; label: string; n: number }[] = [{ value: "all", label: "全部", n: rows.length }, { value: "submitted", label: "已交", n: handed }, { value: "missing", label: "未交", n: missing }];
            return (
              <>
                <div className="plan-stats plan-stats--3">
                  <Stat icon="checkcircle" label="今日已交" value={plan.submittedToday ?? 0} />
                  <Stat icon="clock" label="未交" value={missing} color={missing > 0 ? "var(--due)" : undefined} />
                  <Stat icon="family" label="总成员" value={plan.members ?? active.length} />
                </div>
                <Segmented value={tab} options={[{ value: "tasks", label: `作业 ${tasks.length}` }, { value: "members", label: `成员 ${active.length}` }]} onChange={setTab} />
                {tab === "tasks" && tasks.length === 0 && <div className="group"><div className="plan-files__empty">还没有作业</div></div>}
                {tab === "tasks" && tasks.map((a) => (
                  <div key={a.id} className="group">
                    {/* 不显示作业名（和成员那边一样），只留一行进度：绿勾 = 已交，橙色时钟 = 没交，灰色闭眼 = 没交的人里还没看过的。点这一行：提醒 / 撤回 */}
                    <button className="plan-task" aria-label="这份作业的提醒、撤回" onClick={() => setTask(a)}>
                      <span className="plan-task__head">
                        <span className="plan-counts" style={{ flex: 1 }} aria-label={`已交 ${a.submitted}，没交 ${a.missing}，其中没看 ${a.unseen}`}>
                          {count("checkcircle", "var(--mastered)", a.submitted)}
                          {count("clock", "var(--accent-on, #8a4b00)", a.missing)}
                          {count("eye-off", "var(--tertiary)", a.unseen)}
                        </span>
                        {a.dueAt && due(a.dueAt)}
                        <Icon name="ellipsis" size={20} stroke={2} style={{ color: "var(--tertiary)", flexShrink: 0 }} />
                      </span>
                    </button>
                    {(a.files ?? []).map((f) => (
                      <button key={f.id} className="row" onClick={() => openFile(f)}>
                        <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
                        <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
                        <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </button>
                    ))}
                  </div>
                ))}
                {tab === "members" && (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      {filters.map((f) => (
                        <button key={f.value} className={`chip chip--filter${filter === f.value ? " on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label} <span className="num">{f.n}</span></button>
                      ))}
                    </div>
                    <div className="group">
                      {shown.length === 0 && <div className="plan-files__empty">{rows.length === 0 ? "还没有人加入" : filter === "missing" ? "都交了" : "还没有人交"}</div>}
                      {shown.map((m) => {
                        const state = memberState(m);
                        return (
                          <button key={m.userId} className="row" style={{ minHeight: 56 }} onClick={() => setMember(m)}>
                            <Avatar name={m.name} url={m.avatar} />
                            <span className="row__main"><span className="row__title ellipsis">{memberName(m)}{m.left ? "（已退出）" : ""}</span></span>
                            {(m.toReview ?? 0) > 0 && <Tag kind="info" icon="pencil">待阅</Tag>}
                            {state === "submitted" ? <Tag kind="correct">已交</Tag> : state === "missing" ? <Tag kind="pending" icon="clock">未交</Tag> : null}
                            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="bottom-bar" style={{ marginTop: "auto" }}>
                  <Button icon="plus" onClick={() => nav(`/plans/${plan.id}/new`)}>布置新作业</Button>
                </div>
              </>
            );
          })()
        ) : (
          <>
            <PlanCreator plan={plan} brief />
            <PlanMember data={data} reload={load} />
          </>
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
      {/* 点一个成员：他每份作业交没交，交了的点进去批阅；最下面是移出 */}
      <Sheet open={Boolean(member)} onClose={() => setMember(null)} title={member ? memberName(member) : ""}>
        {member && (member.items ?? []).length > 0 && (
          <div className="group" style={{ background: "var(--fill-light)" }}>
            {(member.items ?? []).map((it) => (
              <button key={it.assignmentId} className="row" disabled={!it.submissionId} onClick={() => { setMember(null); nav(`/plans/s/${it.submissionId}`); }}>
                <span className="row__main">
                  <span className="row__title ellipsis">{data.assignments.find((a) => a.id === it.assignmentId)?.title ?? "作业"}</span>
                  {(it.status === "submitted" || it.status === "reviewed") && (it.score ? <ScoreCounts score={it.score} /> : <span className="row__sub">批改中</span>)}
                </span>
                {it.late && <Tag kind="neutral">迟交</Tag>}
                {itemTag(it)}
                {it.submissionId && <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />}
              </button>
            ))}
          </div>
        )}
        {member && !member.left && (
          <div className="plan-quiet plan-quiet--only">
            <button className="plan-quiet__danger" onClick={() => { setRemoving(member); setMember(null); }}>移出学习计划</button>
          </div>
        )}
      </Sheet>
      {/* 点作业名：这份作业的提醒、撤回 */}
      <Sheet open={Boolean(task)} onClose={() => setTask(null)} title={task?.title}>
        <div className="plan-quiet plan-quiet--only">
          {task && task.missing > 0 && <button onClick={() => { const a = task; setTask(null); void forward(a, true); }}>提醒没交的同学</button>}
          <button className="plan-quiet__danger" onClick={() => { setRevoking(task); setTask(null); }}>撤回这份作业</button>
        </div>
      </Sheet>
      <ConfirmSheet open={Boolean(revoking)} danger title="撤回这份作业？" text="没交的同学不会再看到，交过的还能看到自己那份。" action="撤回" onClose={() => setRevoking(null)}
        onConfirm={() => act(async () => { await revokeAssignment(revoking!.id); setRevoking(null); usePlans.getState().bump(); await load(); }, "已撤回")} />
      <ConfirmSheet open={Boolean(removing)} danger title={`把「${removing ? memberName(removing) : ""}」移出学习计划？`} text="移出后对方看不到这里的作业了，已经交过的你还能看到。" action="移出" onClose={() => setRemoving(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, removing!.userId); setRemoving(null); await load(); }, "已移出")} />
    </div>
  );
}
