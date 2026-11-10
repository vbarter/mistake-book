import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { LoginGate, MenuRow, NameSheet, PageState, PlanTile, ShareButton, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { Button, Segmented, Sheet, Tag, type TagKind } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { PLAN_SUBJECT_LABEL, STATUS_LABEL, bumpPlans, deletePlan, dueLabel, fetchPlan, isOverdue, memberName, removeMember, updatePlan, type MemberAssignment, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { C } from "../../lib/theme";

const STATUS_TAG: Record<MemberAssignment["status"], TagKind> = { todo: "pending", submitted: "info", reviewed: "correct", returned: "wrong" };
const leave = () => {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.redirectTo({ url: "/pages/plans/index" });
};

/**
 * 学习计划页（和 App 一致）。创建人：今天已交 / 等你批阅、每份作业的进度、成员名单、转发、布置新作业。
 * 成员：只有自己的待交 / 已交和作业列表，看不到其他成员、人数和别人交没交。
 */
export default function PlanDetail() {
  const id = useRouter().params.id || "";
  const [version, refresh] = usePlansVersion();
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">("tasks");
  const [menu, setMenu] = useState(false);
  const [naming, setNaming] = useState(false);
  const logged = loggedIn();

  const load = async () => {
    if (!loggedIn()) return;
    try {
      const r = await fetchPlan(id);
      setData(r);
      setError("");
      void Taro.setNavigationBarTitle({ title: r.plan.name });
    } catch (e) {
      if (!data) setError(errorText(e) || "打不开");
    }
  };
  useEffect(() => {
    void load();
  }, [id, version]);
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  // 创建人转发：带上最近一份没撤回的作业，同学点开卡片加入后直接看到它
  usePlanShare(() => {
    if (!data?.invite || data.plan.role !== "owner") return null;
    const first = data.assignments.find((a) => !a.revoked);
    return { plan: data.plan, invite: data.invite, title: first?.title, assignmentId: first?.id };
  });

  if (!logged) return <LoginGate />;
  if (error) return <PageState error={error} action={<Button size="sm" onClick={() => void Taro.redirectTo({ url: "/pages/plans/index" })}>回到学习计划</Button>} />;
  if (!data) return <PageState />;

  const { plan } = data;
  const owner = plan.role === "owner";
  const go = (url: string) => Taro.navigateTo({ url });
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, "success");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const rename = async () => {
    setMenu(false);
    const m = await Taro.showModal({ title: "改计划名称", editable: true, content: plan.name });
    const value = m.content?.trim().slice(0, 60);
    if (!m.confirm || !value) return;
    await act(async () => {
      await updatePlan(plan.id, { name: value });
      await load();
    }, "已更新");
  };
  const resetInvite = async () => {
    setMenu(false);
    if (!(await confirm("让以前转发的卡片失效？", "之前发到微信里的卡片都不能再用来加入。之后要邀请新同学，需要重新转发一次。", "失效并换新的"))) return;
    await act(async () => {
      await updatePlan(plan.id, { resetInvite: true });
      await load();
    }, "旧卡片已失效");
  };
  const dissolve = async () => {
    setMenu(false);
    if (!(await confirm("解散这个学习计划？", "计划、作业和同学交上来的内容都会从服务器删除，不能恢复。同学自己试卷里存的那份不受影响。", "解散", true))) return;
    await act(async () => {
      await deletePlan(plan.id);
      bumpPlans();
      leave();
    }, "已解散");
  };
  const quit = async () => {
    setMenu(false);
    if (!(await confirm("退出这个学习计划？", "退出后看不到这里的作业了。已经交过的作业老师还能看到。再点一次老师发的卡片可以重新加入。", "退出", true))) return;
    await act(async () => {
      await removeMember(plan.id, "me");
      bumpPlans();
      leave();
    }, "已退出");
  };
  const kick = async (m: PlanMemberRow) => {
    if (!(await confirm(`把「${memberName(m)}」移出学习计划？`, "移出后对方看不到这里的作业了，已经交过的你还能看到。", "移出", true))) return;
    await act(async () => {
      await removeMember(plan.id, m.userId);
      await load();
    }, "已移出");
  };

  const head = (
    <View className="plan-head">
      <PlanTile subject={plan.subject} size="sm" />
      <View className="flex1 col minw0">
        <Text className="t-headline ellipsis">{plan.name}</Text>
        <Text className="t-foot c-sec ellipsis">
          {PLAN_SUBJECT_LABEL[plan.subject] ?? "综合"} · {owner ? "我创建的" : plan.teacher}
        </Text>
      </View>
      {owner && data.invite && <ShareButton pill>转发</ShareButton>}
      <View className="plan-file__x" onClick={() => setMenu(true)}>
        <Icon name="ellipsis" size={24} color={C.brand} stroke={2} />
      </View>
    </View>
  );

  const ownerBody = () => {
    const list = data.assignments as OwnerAssignment[];
    const members = data.members ?? [];
    return (
      <>
        <View className="stats">
          <View className="stat">
            <Text className="stat__label">今天已交</Text>
            <Text className="stat__value num">{plan.submittedToday ?? 0}</Text>
          </View>
          <View className="stat">
            <Text className="stat__label">等你批阅</Text>
            <Text className="stat__value num" style={(plan.toReview ?? 0) > 0 ? { color: C.brand } : undefined}>
              {plan.toReview ?? 0}
            </Text>
          </View>
          <View className="stat">
            <Text className="stat__label">成员</Text>
            <Text className="stat__value num">{plan.members ?? 0}</Text>
          </View>
        </View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "tasks", label: `作业 ${list.length}` },
            { value: "members", label: `成员 ${members.length}` },
          ]}
        />
        {tab === "tasks" && (
          <View className="group">
            {list.length === 0 && <Text className="plan-empty">还没有作业，点下面「布置新作业」。</Text>}
            {list.map((a) => {
              const total = Math.max(1, a.members);
              return (
                <View key={a.id} className="plan-task" hoverClass="list-row--hover" onClick={() => go(`/pages/plan-task/index?id=${a.id}`)}>
                  <View className="plan-task__head">
                    <Text className="t-headline ellipsis flex1">{a.title}</Text>
                    {a.revoked && (
                      <Tag kind="neutral" icon={null}>
                        已撤回
                      </Tag>
                    )}
                    {a.toReview > 0 && (
                      <Tag kind="info" icon="pencil">
                        待阅 {a.toReview}
                      </Tag>
                    )}
                    <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
                  </View>
                  {a.dueAt && <Text className="t-foot c-sec">截止 {dueLabel(a.dueAt)}</Text>}
                  <View className="plan-bar">
                    <View className="plan-bar__seg" style={{ width: `${(a.submitted / total) * 100}%`, background: C.ok }} />
                    <View className="plan-bar__seg" style={{ width: `${((a.missing - a.unseen) / total) * 100}%`, background: C.accent }} />
                  </View>
                  <View className="plan-legend">
                    <View className="plan-legend__item">
                      <View className="plan-legend__dot" style={{ background: C.ok }} />
                      <Text>已交 {a.submitted}</Text>
                    </View>
                    <View className="plan-legend__item">
                      <View className="plan-legend__dot" style={{ background: C.accent }} />
                      <Text>没交 {a.missing}</Text>
                    </View>
                    <View className="plan-legend__item">
                      <View className="plan-legend__dot" style={{ background: C.separator }} />
                      <Text>其中没看 {a.unseen}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {tab === "members" && (
          <View className="group">
            {members.length === 0 && <Text className="plan-empty">还没有人加入。点右上角「转发」发到微信群，同学点开卡片就自动加入了。</Text>}
            {members.map((m) => (
              <View key={m.userId} className="list-row" style={{ minHeight: "56px" }}>
                <View className="plan-avatar">
                  <Text>{m.name.slice(-1)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">{memberName(m)}</Text>
                  <Text className="row__sub">
                    已交 {m.submitted}/{m.assignments} 份
                  </Text>
                </View>
                <View className="plan-file__x" onClick={() => void kick(m)}>
                  <Icon name="xmark" size={16} color={C.tertiary} stroke={2.4} />
                </View>
              </View>
            ))}
          </View>
        )}
        {tab === "members" && members.some((m) => m.tail) && <Text className="group-note">重名的同学后面带了手机尾号。他们改名后，这里会跟着变。</Text>}
        <View className="bottom-bar">
          <Button icon="plus" className="flex1" onClick={() => go(`/pages/plan-new/index?planId=${plan.id}`)}>
            布置新作业
          </Button>
        </View>
      </>
    );
  };

  const memberBody = () => {
    const list = data.assignments as MemberAssignment[];
    const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned")).length;
    const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
    return (
      <>
        {data.me?.defaultName && (
          <View className="plan-banner">
            <Icon name="info" size={18} color={C.accentOn} stroke={2.2} />
            <Text className="flex1">你的名字还是「{data.me.name}」，老师可能认不出你。</Text>
            <Text className="plan-banner__act" onClick={() => setNaming(true)}>
              去改名
            </Text>
          </View>
        )}
        <View className="stats">
          <View className="stat">
            <Text className="stat__label">待交</Text>
            <Text className="stat__value num" style={todo ? { color: C.accentOn } : undefined}>
              {todo}
            </Text>
          </View>
          <View className="stat">
            <Text className="stat__label">已交</Text>
            <Text className="stat__value num">{handed}</Text>
          </View>
        </View>
        <View className="group">
          <View className="group__header">
            <Text>作业</Text>
          </View>
          {list.length === 0 && <Text className="plan-empty">老师还没有布置作业。</Text>}
          {list.map((a) => (
            <View key={a.id} className="plan-task" hoverClass="list-row--hover" onClick={() => go(`/pages/plan-task/index?id=${a.id}`)}>
              <View className="plan-task__head">
                <Text className="t-headline ellipsis flex1">{a.title}</Text>
                {a.revoked ? (
                  <Tag kind="neutral" icon={null}>
                    已撤回
                  </Tag>
                ) : (
                  <Tag kind={STATUS_TAG[a.status]} icon={a.status === "todo" ? "clock" : a.status === "returned" ? "refresh" : a.status === "submitted" ? null : undefined}>
                    {STATUS_LABEL[a.status]}
                  </Tag>
                )}
                <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
              </View>
              <Text className="t-foot c-sec">
                {a.status === "todo" || a.status === "returned"
                  ? a.dueAt
                    ? `${isOverdue(a.dueAt) ? "已过截止时间 " : "截止 "}${dueLabel(a.dueAt)}`
                    : "没有截止时间"
                  : a.score
                    ? `对 ${a.score.correct} · 错 ${a.score.wrong} · 没做 ${a.score.blank}${a.late ? " · 迟交" : ""}`
                    : `批改中${a.late ? " · 迟交" : ""}`}
              </Text>
              {a.comment && (
                <Text className="t-foot" style={{ color: a.status === "returned" ? C.wrong : C.secondary }}>
                  老师：{a.comment}
                </Text>
              )}
            </View>
          ))}
        </View>
      </>
    );
  };

  return (
    <View className="page">
      {head}
      {owner ? ownerBody() : memberBody()}

      <Sheet open={menu} onClose={() => setMenu(false)} title={plan.name}>
        {owner ? (
          <View className="group group--fill">
            <MenuRow title="改计划名称" onClick={() => void rename()} />
            <MenuRow title="让以前转发的卡片失效" sub="卡片被转到别处时用。已经加入的同学不受影响" onClick={() => void resetInvite()} />
            <MenuRow title="解散学习计划" danger onClick={() => void dissolve()} />
          </View>
        ) : (
          <View className="group group--fill">
            <MenuRow
              title="改名字"
              sub={`老师看到的是「${data.me?.name ?? ""}」`}
              onClick={() => {
                setMenu(false);
                setNaming(true);
              }}
            />
            <MenuRow title="退出学习计划" danger onClick={() => void quit()} />
          </View>
        )}
      </Sheet>
      <NameSheet
        open={naming}
        onClose={() => setNaming(false)}
        onDone={(name) => {
          setNaming(false);
          toast(`已改成「${name}」，老师那边同步更新`);
          refresh();
        }}
      />
    </View>
  );
}
