import { useEffect, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { Icon, type IconName } from "../../components/Icon";
import { LoginGate, PageState, PlanTile, ShareButton, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { Button, Segmented, Sheet, Stat, Tag, type TagKind } from "../../components/ui";
import { errorText } from "../../lib/api";
import { updateProfile } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { PLAN_SUBJECT_LABEL, STATUS_LABEL, bumpPlans, deletePlan, dueLabel, fetchPlan, isOverdue, memberName, removeMember, updatePlan, type MemberAssignment, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { C } from "../../lib/theme";

const STATUS_TAG: Record<MemberAssignment["status"], TagKind> = { todo: "pending", submitted: "info", reviewed: "correct", returned: "wrong" };
const leave = () => {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.redirectTo({ url: "/pages/plans/index" });
};

/**
 * 学习计划页（和 App 一致）。创建人：今日已交 / 待批阅、每份作业的进度、成员名单、转发、布置新作业。成员：只有自己的待交 / 已交和作业列表，
 * 看不到其他成员、人数和别人交没交。点计划名弹出面板：创建人改计划名、让旧卡片失效、解散；成员改老师看到的名字、退出。
 * 页面上只留内容，不放这些不常用的操作。页面上能用图标 + 数字说清的就不写字。
 */
export default function PlanDetail() {
  const id = useRouter().params.id || "";
  const [version] = usePlansVersion();
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">("tasks");
  const [panel, setPanel] = useState(false);
  const [name, setName] = useState("");
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

  const openPanel = () => {
    setName(owner ? plan.name : data.me?.defaultName ? "" : (data.me?.name ?? ""));
    setPanel(true);
  };
  const saveName = async () => {
    const value = name.trim();
    await act(async () => {
      if (owner) await updatePlan(plan.id, { name: value.slice(0, 60) });
      else await updateProfile({ nickname: value.slice(0, 16) });
      setPanel(false);
      await load();
    }, owner ? "已更新" : "已改名");
  };
  const resetInvite = async () => {
    setPanel(false);
    if (!(await confirm("让以前转发的卡片失效？", "之前发到微信里的卡片都不能再用来加入。之后要邀请新同学，需要重新转发一次。", "失效并换新的"))) return;
    await act(async () => {
      await updatePlan(plan.id, { resetInvite: true });
      await load();
    }, "旧卡片已失效");
  };
  const dissolve = async () => {
    setPanel(false);
    if (!(await confirm("解散这个学习计划？", "计划、作业和同学交上来的内容都会从服务器删除，不能恢复。同学自己试卷里存的那份不受影响。", "解散", true))) return;
    await act(async () => {
      await deletePlan(plan.id);
      bumpPlans();
      leave();
    }, "已解散");
  };
  const quit = async () => {
    setPanel(false);
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
      {/* 点计划名弹出面板：改名，下面是不常用的操作（和 iOS 的标题菜单一个意思） */}
      <View className="flex1 col minw0" onClick={openPanel}>
        <View className="row-center gap6">
          <Text className="t-headline ellipsis">{plan.name}</Text>
          <Icon name="chevron-down" size={14} color={C.tertiary} stroke={2.6} />
        </View>
        <Text className="t-foot c-sec ellipsis">{owner ? (PLAN_SUBJECT_LABEL[plan.subject] ?? "综合") : `${PLAN_SUBJECT_LABEL[plan.subject] ?? "综合"} · ${plan.teacher}`}</Text>
      </View>
      {owner && data.invite && <ShareButton pill>转发</ShareButton>}
    </View>
  );

  /** 图标 + 数字的一小格（进度、得分都用它，代替「已交 3」「没交 2」这类文字） */
  const count = (icon: IconName, color: string, n: number | string) => (
    <View className="plan-count">
      <Icon name={icon} size={14} color={color} stroke={2.4} />
      <Text className="num" style={{ color }}>
        {n}
      </Text>
    </View>
  );
  const due = (iso: string, late = false) => (
    <View className="plan-count">
      <Icon name="clock" size={14} color={late ? C.wrong : C.tertiary} stroke={2.2} />
      <Text style={{ color: late ? C.wrong : C.secondary }}>{dueLabel(iso)}</Text>
    </View>
  );

  const ownerBody = () => {
    const list = data.assignments as OwnerAssignment[];
    const members = data.members ?? [];
    return (
      <>
        <View className="stats">
          <Stat icon="checkcircle" label="今日已交" value={plan.submittedToday ?? 0} />
          <Stat icon="pencil" label="待批阅" value={plan.toReview ?? 0} color={(plan.toReview ?? 0) > 0 ? C.brand : undefined} />
          <Stat icon="family" label="成员" value={plan.members ?? 0} />
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
            {list.length === 0 && <Text className="plan-empty">还没有作业</Text>}
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
                        {a.toReview}
                      </Tag>
                    )}
                    <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
                  </View>
                  <View className="plan-bar">
                    <View className="plan-bar__seg" style={{ width: `${(a.submitted / total) * 100}%`, background: C.ok }} />
                    <View className="plan-bar__seg" style={{ width: `${((a.missing - a.unseen) / total) * 100}%`, background: C.accent }} />
                  </View>
                  {/* 绿勾 = 已交，橙色时钟 = 没交，灰色闭眼 = 没交的人里还没看过的 */}
                  <View className="plan-counts">
                    {count("checkcircle", C.ok, a.submitted)}
                    {count("clock", C.accentOn, a.missing)}
                    {count("eye-off", C.tertiary, a.unseen)}
                    <View className="flex1" />
                    {a.dueAt && due(a.dueAt)}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {tab === "members" && (
          <>
            <View className="group">
              {members.length === 0 && <Text className="plan-empty">还没有人加入</Text>}
              {members.map((m) => (
                <View key={m.userId} className="list-row" style={{ minHeight: "56px" }}>
                  <View className="plan-avatar">
                    <Text>{m.name.slice(-1)}</Text>
                  </View>
                  <Text className="row__title ellipsis flex1">{memberName(m)}</Text>
                  {count("checkcircle", m.submitted >= m.assignments && m.assignments > 0 ? C.ok : C.tertiary, `${m.submitted}/${m.assignments}`)}
                  <View className="plan-file__x" onClick={() => void kick(m)}>
                    <Icon name="xmark" size={16} color={C.tertiary} stroke={2.4} />
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
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
          <View className="plan-banner" onClick={openPanel}>
            <Icon name="person" size={18} color={C.accentOn} stroke={2.2} />
            <Text className="flex1">老师看到的名字是「{data.me.name}」</Text>
            <Text className="plan-banner__act">改名</Text>
          </View>
        )}
        <View className="stats">
          <Stat icon="clock" label="待交" value={todo} color={todo ? C.accentOn : undefined} />
          <Stat icon="checkcircle" label="已交" value={handed} />
        </View>
        <View className="group">
          {list.length === 0 && <Text className="plan-empty">还没有作业</Text>}
          {list.map((a) => {
            const open = a.status === "todo" || a.status === "returned";
            return (
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
                <View className="plan-counts">
                  {open ? (
                    a.dueAt && due(a.dueAt, isOverdue(a.dueAt))
                  ) : a.score ? (
                    <>
                      {count("checkcircle", C.ok, a.score.correct)}
                      {count("xcircle", C.wrong, a.score.wrong)}
                      {count("minus", C.tertiary, a.score.blank)}
                    </>
                  ) : (
                    <Text className="t-foot c-sec">批改中</Text>
                  )}
                  {!open && a.late && <Text className="t-foot c-sec">迟交</Text>}
                </View>
                {a.comment && (
                  <View className="plan-count" style={{ alignItems: "flex-start" }}>
                    <Icon name="bubble" size={14} color={a.status === "returned" ? C.wrong : C.tertiary} stroke={2.2} style={{ marginTop: "2px" }} />
                    <Text className="t-foot flex1" style={{ color: a.status === "returned" ? C.wrong : C.secondary }}>
                      {a.comment}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </>
    );
  };

  return (
    <View className="page">
      {head}
      {owner ? ownerBody() : memberBody()}

      <Sheet open={panel} onClose={() => setPanel(false)} title={owner ? "学习计划" : plan.name}>
        <View className="plan-field">
          <View className="plan-field__label">
            <Text>{owner ? "名称" : "老师看到的名字"}</Text>
          </View>
          <Input className="input" value={name} maxlength={owner ? 60 : 16} adjustPosition={false} confirmType="done" onInput={(e) => setName(e.detail.value)} />
        </View>
        <Button disabled={!name.trim() || name.trim() === (owner ? plan.name : data.me?.name)} onClick={() => void saveName()}>
          保存
        </Button>
        <View className="plan-quiet">
          {owner && (
            <Text className="plan-quiet__item" onClick={() => void resetInvite()}>
              让旧卡片失效
            </Text>
          )}
          <Text className="plan-quiet__item c-wrong" onClick={() => void (owner ? dissolve() : quit())}>
            {owner ? "解散学习计划" : "退出学习计划"}
          </Text>
        </View>
      </Sheet>
    </View>
  );
}
