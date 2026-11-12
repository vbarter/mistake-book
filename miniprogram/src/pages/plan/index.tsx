import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon, type IconName } from "../../components/Icon";
import { LoginGate, PageState, ScoreCounts, ShareButton, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { PlanMember } from "../../components/PlanMember";
import { Avatar, Button, Segmented, Sheet, Stat, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { bumpPlans, createdLabel, deletePlan, dueLabel, fetchPlan, fileBadge, memberName, memberState, openPlanFile, planGone, removeMember, revokeAssignment, sizeLabel, updatePlan, type MemberItem, type MemberState, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { C, useThemeClass } from "../../lib/theme";

const leave = () => {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.redirectTo({ url: "/pages/plans/index" });
};

type Filter = "all" | Exclude<MemberState, "none">;

/** 一个成员在一份作业上的状态：没看 / 未交 / 退回 / 待阅 / 已阅 */
const itemTag = (it: MemberItem) =>
  it.status === "submitted" ? (
    <Tag kind="info" icon="pencil">
      待阅
    </Tag>
  ) : it.status === "reviewed" ? (
    <Tag kind="correct">已阅</Tag>
  ) : it.status === "returned" ? (
    <Tag kind="wrong" icon="refresh">
      退回
    </Tag>
  ) : (
    <Tag kind="pending" icon={it.viewed ? "clock" : "eye-off"}>
      {it.viewed ? "未交" : "没看"}
    </Tag>
  );

/**
 * 学习计划页（和 App 一致）。创建人在这一页看完所有东西，不再有单独的「作业情况」页：顶部今日已交 / 未交 / 总成员；
 * 「作业」平铺每份作业的文件（点文件直接打开，点作业名：提醒没交的、撤回）；「成员」列头像 + 名字 + 已交 / 未交，可按状态筛选，
 * 点一个人看他每份作业的情况并进去批阅、移出。成员：只有自己的待交 / 已交和作业（见 components/PlanMember），
 * 看不到其他成员、人数和别人交没交。头部两边一样：创建人头像 + 名字 + 创建时间（计划名在顶部标题栏），右边一个圆图标按钮，
 * 创建人是「解散」（在转发左边），成员是「退出」，点了都先确认。计划名和成员的名字都不在这里改（名字在「我的」里改，会同步过来）。
 * 「让旧卡片失效」在「成员」页签最下面。页面上能用图标 + 数字说清的就不写字。
 */
export default function PlanDetail() {
  const tc = useThemeClass();
  const id = useRouter().params.id || "";
  const [version] = usePlansVersion();
  const [data, setData] = useState<PlanDetailRes | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tasks" | "members">("tasks");
  const [filter, setFilter] = useState<Filter>("all");
  const [member, setMember] = useState<PlanMemberRow | null>(null);
  const [task, setTask] = useState<OwnerAssignment | null>(null);
  const logged = loggedIn();
  const shown = useRef(false);

  const load = async () => {
    if (!loggedIn()) return;
    try {
      const r = await fetchPlan(id);
      shown.current = true;
      setData(r);
      setError("");
      void Taro.setNavigationBarTitle({ title: r.plan.name });
    } catch (e) {
      const gone = planGone(e);
      // 已经显示出来了，一次没拉到（没网）不换成报错页；但计划被解散 / 自己被移出了，就不能再留着旧内容
      if (shown.current && !gone) return;
      setError(errorText(e) || "打不开");
      if (shown.current) {
        shown.current = false;
        setData(null);
        void Taro.setNavigationBarTitle({ title: "学习计划" });
        bumpPlans(); // 首页和列表里也把它去掉
      }
    }
  };
  useEffect(() => {
    void load();
  }, [id, version]);
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  // 创建人转发：右上角的「转发」带上最近一份没撤回的作业，同学点开卡片加入后直接看到它；作业面板里的按钮转发那一份
  usePlanShare((_remind, aid) => {
    if (!data?.invite || data.plan.role !== "owner") return null;
    const live = data.assignments.filter((a) => !a.revoked);
    const a = live.find((x) => x.id === aid) ?? live[0];
    return { plan: data.plan, invite: data.invite, title: a?.title, assignmentId: a?.id };
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

  const resetInvite = async () => {
    if (!(await confirm("让以前转发的卡片失效？", "之前发到微信里的卡片都不能再用来加入。之后要邀请新同学，需要重新转发一次。", "失效并换新的"))) return;
    await act(async () => {
      await updatePlan(plan.id, { resetInvite: true });
      await load();
    }, "旧卡片已失效");
  };
  const dissolve = async () => {
    if (!(await confirm("解散这个学习计划？", "计划、作业和同学交上来的内容都会从服务器删除，不能恢复。同学自己试卷里存的那份不受影响。", "解散", true))) return;
    await act(async () => {
      await deletePlan(plan.id);
      bumpPlans();
      leave();
    }, "已解散");
  };
  const quit = async () => {
    if (!(await confirm("退出这个学习计划？", "退出后看不到这里的作业了。已经交过的作业老师还能看到。再点一次老师发的卡片可以重新加入。", "退出", true))) return;
    await act(async () => {
      await removeMember(plan.id, "me");
      bumpPlans();
      leave();
    }, "已退出");
  };
  const revoke = async (a: OwnerAssignment) => {
    setTask(null);
    if (!(await confirm("撤回这份作业？", "没交的同学不会再看到；交过的同学还能看到自己那份。", "撤回", true))) return;
    await act(async () => {
      await revokeAssignment(a.id);
      bumpPlans();
      await load();
    }, "已撤回");
  };
  const kick = async (m: PlanMemberRow) => {
    setMember(null);
    if (!(await confirm(`把「${memberName(m)}」移出学习计划？`, "移出后对方看不到这里的作业了，已经交过的你还能看到。", "移出", true))) return;
    await act(async () => {
      await removeMember(plan.id, m.userId);
      await load();
    }, "已移出");
  };

  const head = (
    <View className="plan-head">
      <Avatar name={plan.teacher} url={plan.teacherAvatar} size={42} />
      {/* 两边都是创建人的名字 + 创建时间；计划名在顶部标题栏 */}
      <View className="flex1 col minw0">
        <Text className="t-headline ellipsis">{plan.teacher}</Text>
        <Text className="t-foot c-sec ellipsis">{createdLabel(plan.createdAt)}</Text>
      </View>
      {/* 解散 / 退出：点了先确认 */}
      <View className="plan-iconbtn" hoverClass="plan-iconbtn--hover" onClick={() => void (owner ? dissolve() : quit())}>
        <ColorIcon name={owner ? "plan-dissolve" : "plan-quit"} size={22} />
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
    const rows = data.members ?? [];
    const active = rows.filter((m) => !m.left);
    const handed = active.filter((m) => memberState(m) === "submitted").length;
    const missing = plan.missing ?? active.filter((m) => memberState(m) === "missing").length;
    const shown = filter === "all" ? rows : active.filter((m) => memberState(m) === filter);
    const filters: { value: Filter; label: string; n: number }[] = [
      { value: "all", label: "全部", n: rows.length },
      { value: "submitted", label: "已交", n: handed },
      { value: "missing", label: "未交", n: missing },
    ];
    return (
      <>
        <View className="stats">
          <Stat icon="checkcircle" label="今日已交" value={plan.submittedToday ?? 0} />
          <Stat icon="clock" label="未交" value={missing} color={missing > 0 ? C.accentOn : undefined} />
          <Stat icon="family" label="总成员" value={plan.members ?? active.length} />
        </View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "tasks", label: `作业 ${list.length}` },
            { value: "members", label: `成员 ${active.length}` },
          ]}
        />
        {tab === "tasks" && list.length === 0 && (
          <View className="group">
            <Text className="plan-empty">还没有作业</Text>
          </View>
        )}
        {tab === "tasks" &&
          list.map((a) => {
            const files = a.files ?? [];
            return (
              <View key={a.id} className="group">
                {/* 不显示作业名（和成员那边一样），只留一行进度：绿勾 = 已交，橙色时钟 = 没交，灰色闭眼 = 没交的人里还没看过的。点这一行：提醒 / 撤回 */}
                <View className="plan-task" hoverClass="list-row--hover" onClick={() => setTask(a)}>
                  <View className="plan-task__head">
                    <View className="plan-counts flex1">
                      {count("checkcircle", C.ok, a.submitted)}
                      {count("clock", C.accentOn, a.missing)}
                      {count("eye-off", C.tertiary, a.unseen)}
                    </View>
                    {a.dueAt && due(a.dueAt)}
                    <Icon name="ellipsis" size={20} color={C.tertiary} stroke={2} />
                  </View>
                </View>
                {files.map((f) => (
                  <View key={f.id} className="list-row" hoverClass="list-row--hover" onClick={() => void openPlanFile(f, files)}>
                    <View className="plan-file__icon plan-file__icon--sm">
                      <Text>{fileBadge(f.mime)}</Text>
                    </View>
                    <View className="flex1 col gap2 minw0">
                      <Text className="row__title ellipsis">{f.name}</Text>
                      <Text className="row__sub">{sizeLabel(f.size)}</Text>
                    </View>
                    <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
                  </View>
                ))}
              </View>
            );
          })}
        {tab === "members" && (
          <>
            <View className="row-center gap8">
              {filters.map((f) => (
                <View key={f.value} className={`chip chip--card${filter === f.value ? " chip--on" : ""}`} onClick={() => setFilter(f.value)}>
                  <Text>{f.label}</Text>
                  <Text className="num">{f.n}</Text>
                </View>
              ))}
            </View>
            <View className="group">
              {shown.length === 0 && <Text className="plan-empty">{rows.length === 0 ? "还没有人加入" : filter === "missing" ? "都交了" : "还没有人交"}</Text>}
              {shown.map((m) => {
                const state = memberState(m);
                return (
                  <View key={m.userId} className="list-row" hoverClass="list-row--hover" style={{ minHeight: "56px" }} onClick={() => setMember(m)}>
                    <Avatar name={m.name} url={m.avatar} />
                    <Text className="row__title ellipsis flex1">
                      {memberName(m)}
                      {m.left ? "（已退出）" : ""}
                    </Text>
                    {(m.toReview ?? 0) > 0 && (
                      <Tag kind="info" icon="pencil">
                        待阅
                      </Tag>
                    )}
                    {state === "submitted" ? (
                      <Tag kind="correct">已交</Tag>
                    ) : state === "missing" ? (
                      <Tag kind="pending" icon="clock">
                        未交
                      </Tag>
                    ) : null}
                    <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
                  </View>
                );
              })}
            </View>
            <View className="plan-quiet plan-quiet--only">
              <Text className="plan-quiet__item" onClick={() => void resetInvite()}>
                让旧卡片失效
              </Text>
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

  return (
    <View className={"page" + tc}>
      {head}
      {owner ? ownerBody() : <PlanMember data={data} reload={load} />}

      {/* 点一个成员：他每份作业交没交，交了的点进去批阅；最下面是移出 */}
      <Sheet open={Boolean(member)} onClose={() => setMember(null)} title={member ? memberName(member) : ""}>
        {member && (member.items ?? []).length > 0 && (
          <View className="group group--fill">
            {(member.items ?? []).map((it) => (
              <View
                key={it.assignmentId}
                className="list-row"
                hoverClass={it.submissionId ? "list-row--hover" : "none"}
                onClick={() => {
                  if (!it.submissionId) return;
                  setMember(null);
                  void go(`/pages/plan-review/index?id=${it.submissionId}`);
                }}
              >
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">{data.assignments.find((a) => a.id === it.assignmentId)?.title ?? "作业"}</Text>
                  {(it.status === "submitted" || it.status === "reviewed") && (it.score ? <ScoreCounts score={it.score} /> : <Text className="row__sub">批改中</Text>)}
                </View>
                {it.late && (
                  <Tag kind="neutral" icon={null}>
                    迟交
                  </Tag>
                )}
                {itemTag(it)}
                {it.submissionId && <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />}
              </View>
            ))}
          </View>
        )}
        {member && !member.left && (
          <View className="plan-quiet plan-quiet--only">
            <Text className="plan-quiet__item c-wrong" onClick={() => void kick(member)}>
              移出学习计划
            </Text>
          </View>
        )}
      </Sheet>

      {/* 点作业名：这份作业的提醒、撤回 */}
      <Sheet open={Boolean(task)} onClose={() => setTask(null)} title={task?.title}>
        {task && (
          <>
            {task.missing > 0 && (
              <ShareButton variant="outline" icon="bell" remind assignmentId={task.id} onTap={() => setTask(null)}>
                提醒没交的同学
              </ShareButton>
            )}
            <View className="plan-quiet plan-quiet--only">
              <Text className="plan-quiet__item c-wrong" onClick={() => void revoke(task)}>
                撤回这份作业
              </Text>
            </View>
          </>
        )}
      </Sheet>
    </View>
  );
}
