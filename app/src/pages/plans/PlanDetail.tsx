import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ColorIcon } from "../../components/ColorIcon";
import { SwipeRow } from "../../components/SwipeRow";
import { Icon, WechatIcon, type IconName } from "../../components/Icon";
import { Button, Empty, InlineNav, Segmented, Sheet, Spinner } from "../../components/ui";
import { Avatar, Stat, Tag } from "../../components/v2";
import { AI_GRADING, planSubjectText, createdLabel, deletePlan, dueLabel, fetchPlan, fileBadge, memberName, memberState, planGone, removeMember, revokeAssignment, shareInvite, sizeLabel, updatePlan, usePlans, type MemberItem, type MemberState, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { openFile } from "./Assignment";
import { PlanMember } from "./PlanMember";
import { ConfirmSheet, ScoreCounts, SubmitProgress } from "./shared";

const SWIPE_HINT = "zcb.plan.swipeHint";
function swipeHintPending(): boolean {
  try {
    return !localStorage.getItem(SWIPE_HINT);
  } catch {
    return false;
  }
}

type Filter = "all" | Exclude<MemberState, "none">;
/** 从批阅页回来还停在刚才的页签和筛选上 */
let remembered: { planId: string; tab: "tasks" | "members"; filter: Filter } | null = null;

/**
 * 学习计划页。创建人在这一页看完所有东西，不再有单独的「作业情况」页：
 * 顶部交齐 / 没交齐 / 总成员（都数人）；「作业」平铺每份作业的文件（点文件直接打开；把一份作业向左滑，露出「删除」）；
 * 「成员」列头像 + 名字 + 进度环（交了几份 / 共几份），可按交齐 / 没交齐筛选，点一个人看他每份作业的情况并进去批阅、移出。
 * 头部两边一样：创建人头像 + 名字 + 创建时间（计划名在导航栏），右边一个圆图标按钮，创建人是「解散」（在转发左边），成员是「退出」，点了都先确认。
 * 计划名和成员的名字都不在这里改（名字在「我的」里改，会同步过来）。「让旧卡片失效」在「成员」页签最下面。能用图标 + 数字说清的就不写字。
 * 成员：只有自己的待交 / 已交和作业（见 PlanMember），看不到其他成员、人数和别人交没交。
 */
/** 一个成员在一份作业上的状态：没看 / 未交 / 退回 / 待阅 / 已阅 */
const itemTag = (it: MemberItem) =>
  it.status === "submitted" ? <Tag kind="info" icon="pencil">待阅</Tag>
    : it.status === "reviewed" ? <Tag kind="correct">已阅</Tag>
      : it.status === "returned" ? <Tag kind="wrong" icon="refresh">退回</Tag>
        : <Tag kind="neutral" icon={it.viewed ? "clock" : "eye-off"}>{it.viewed ? "未交" : "没看"}</Tag>;

export default function PlanDetail() {
  const nav = useNavigate();
  const { planId = "" } = useParams();
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">(remembered?.planId === planId ? remembered.tab : "tasks");
  const [filter, setFilter] = useState<Filter>(remembered?.planId === planId ? remembered.filter : "all");
  const [member, setMember] = useState<PlanMemberRow | null>(null);
  const [swiped, setSwiped] = useState<string | null>(null); // 左滑开着的那份作业
  const [hint, setHint] = useState(swipeHintPending); // 第一次看到作业：第一张卡片自己滑出一小截，露一下「删除」
  const [revoking, setRevoking] = useState<OwnerAssignment | null>(null);
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
  const forward = (a: { id: string; title: string } | undefined = data.assignments.find((x) => !x.revoked)) =>
    act(() => shareInvite({ plan, invite: data.invite!, title: a?.title, assignmentId: a?.id }));

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
      />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 12 }}>
        <div className="plan-head">
          <Avatar name={plan.teacher} url={plan.teacherAvatar} size={42} />
          <span className="plan-head__main">
            <span className="t-headline ellipsis">{plan.teacher}</span>
            <span className="t-foot c-sec ellipsis">{createdLabel(plan.createdAt)}</span>
          </span>
          {/* 解散 / 退出：点了先确认 */}
          <button className="plan-iconbtn" aria-label={owner ? "解散学习计划" : "退出学习计划"} onClick={() => setConfirm(owner ? "dissolve" : "leave")}>
            <ColorIcon name={owner ? "plan-dissolve" : "plan-quit"} size={22} />
          </button>
          {owner && data.invite && <button className="plan-pill" onClick={() => forward()}><WechatIcon />转发</button>}
        </div>
        {owner ? (
          (() => {
            const tasks = data.assignments as OwnerAssignment[];
            const rows = data.members ?? [];
            const active = rows.filter((m) => !m.left);
            const handed = active.filter((m) => memberState(m) === "submitted").length;
            const missing = plan.missing ?? active.filter((m) => memberState(m) === "missing").length;
            const shown = filter === "all" ? rows : active.filter((m) => memberState(m) === filter);
            const filters: { value: Filter; label: string; n: number }[] = [{ value: "all", label: "全部", n: rows.length }, { value: "submitted", label: "交齐", n: handed }, { value: "missing", label: "没交齐", n: missing }];
            return (
              <>
                <div className="plan-stats plan-stats--3">
                  <Stat icon="checkcircle" label="交齐" value={handed} />
                  <Stat icon="clock" label="没交齐" value={missing} />
                  <Stat icon="family" label="总成员" value={plan.members ?? active.length} />
                </div>
                <Segmented value={tab} options={[{ value: "tasks", label: `作业 ${tasks.length}` }, { value: "members", label: `成员 ${active.length}` }]} onChange={setTab} />
                {tab === "tasks" && tasks.length === 0 && <div className="group"><div className="plan-files__empty">还没有作业</div></div>}
                {tab === "tasks" && tasks.map((a) => (
                  // 整张卡片（进度行 + 文件行）一起左滑，露出红色「删除」
                  <SwipeRow
                    key={a.id}
                    className="group"
                    open={swiped === a.id}
                    onOpenChange={(o) => setSwiped((cur) => (o ? a.id : cur === a.id ? null : cur))}
                    onDelete={() => { setSwiped(null); setRevoking(a); }}
                    hint={hint && a.id === tasks[0].id}
                    onHintDone={() => {
                      setHint(false);
                      try {
                        localStorage.setItem(SWIPE_HINT, "1");
                      } catch {
                        /* 存不下：下次再演示一遍 */
                      }
                    }}
                  >
                    {/* 不显示作业名（和成员那边一样），只留一行进度：绿勾 = 已交，灰色时钟 = 没交（不上色），灰色闭眼 = 没交的人里还没看过的 */}
                    <div className="plan-task plan-task--static">
                      <span className="plan-task__head">
                        <span className="plan-counts" style={{ flex: 1 }} aria-label={`已交 ${a.submitted}，没交 ${a.missing}，其中没看 ${a.unseen}`}>
                          {count("checkcircle", "var(--mastered)", a.submitted)}
                          {count("clock", "var(--secondary)", a.missing)}
                          {count("eye-off", "var(--tertiary)", a.unseen)}
                        </span>
                        {a.dueAt && due(a.dueAt)}
                      </span>
                    </div>
                    {(a.files ?? []).map((f) => (
                      <button key={f.id} className="row" onClick={() => openFile(f)}>
                        <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
                        <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
                        <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                      </button>
                    ))}
                  </SwipeRow>
                ))}
                {tab === "members" && (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      {filters.map((f) => (
                        <button key={f.value} className={`chip chip--filter${filter === f.value ? " on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label} <span className="num">{f.n}</span></button>
                      ))}
                    </div>
                    <div className="group">
                      {shown.length === 0 && <div className="plan-files__empty">{rows.length === 0 ? "还没有人加入" : filter === "missing" ? "都交齐了" : "还没有人交齐"}</div>}
                      {shown.map((m) => {
                        return (
                          <button key={m.userId} className="row" style={{ minHeight: 56 }} onClick={() => setMember(m)}>
                            <Avatar name={m.name} url={m.avatar} />
                            <span className="row__main"><span className="row__title ellipsis">{memberName(m)}{m.left ? "（已退出）" : ""}</span></span>
                            <SubmitProgress done={m.submitted} total={m.assignments} />
                            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="plan-quiet plan-quiet--only"><button onClick={() => setConfirm("reset")}>让旧卡片失效</button></div>
                  </>
                )}
                <div className="bottom-bar" style={{ marginTop: "auto" }}>
                  <Button icon="plus" onClick={() => nav(`/plans/${plan.id}/new`)}>布置新作业</Button>
                </div>
              </>
            );
          })()
        ) : (
          <PlanMember data={data} reload={load} />
        )}
      </div>

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
                  {AI_GRADING && (it.status === "submitted" || it.status === "reviewed") && (it.score ? <ScoreCounts score={it.score} /> : <span className="row__sub">批改中</span>)}
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
      <ConfirmSheet open={Boolean(revoking)} danger title="删除这份作业？" text="没交的同学不会再看到，交过的还能看到自己那份。" action="删除" onClose={() => setRevoking(null)}
        onConfirm={() => act(async () => { await revokeAssignment(revoking!.id); setRevoking(null); usePlans.getState().bump(); await load(); }, "已删除")} />
      <ConfirmSheet open={Boolean(removing)} danger title={`把「${removing ? memberName(removing) : ""}」移出学习计划？`} text="移出后对方看不到这里的作业了，已经交过的你还能看到。" action="移出" onClose={() => setRemoving(null)}
        onConfirm={() => act(async () => { await removeMember(plan.id, removing!.userId); setRemoving(null); await load(); }, "已移出")} />
    </div>
  );
}
