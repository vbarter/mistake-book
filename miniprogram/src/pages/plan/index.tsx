import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePageScroll, usePullDownRefresh, useRouter } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon, type IconName } from "../../components/Icon";
import { LoginGate, PageState, ScoreCounts, ShareButton, SubmitProgress, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { PlanMember } from "../../components/PlanMember";
import { Avatar, Button, IconSegmented, Sheet, Stat, Tag } from "../../components/ui";
import { SwipeRow, swipeGuard } from "../../components/SwipeRow";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { AI_GRADING, HW_PREVIEW, RETURN_REDO, bumpPlans, createdLabel, deletePlan, dueLabel, fetchPlan, fileBadge, hwMeta, memberName, memberState, openPlanFile, planGone, removeMember, revokeAssignment, sizeLabel, updatePlan, type MemberItem, type MemberState, type OwnerAssignment, type PlanDetailRes, type PlanMemberRow } from "../../lib/plans";
import { C, useThemeClass } from "../../lib/theme";

const leave = () => {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.redirectTo({ url: "/pages/plans/index" });
};

const SWIPE_HINT = "zcb.plan.swipeHint";
function swipeHintPending(): boolean {
  try {
    return !Taro.getStorageSync(SWIPE_HINT);
  } catch {
    return false;
  }
}

type Filter = "all" | Exclude<MemberState, "none">;

/** 一个成员在一份作业上的状态：没看 / 未交 / 退回 / 待阅 / 已阅 */
const itemTag = (it: MemberItem) =>
  it.status === "submitted" ? (
    <Tag kind="info" icon="pencil">
      待阅
    </Tag>
  ) : it.status === "reviewed" ? (
    <Tag kind="correct">已阅</Tag>
  ) : RETURN_REDO && it.status === "returned" ? (
    <Tag kind="wrong" icon="refresh">
      退回
    </Tag>
  ) : (
    <Tag kind="neutral" icon={it.viewed ? "clock" : "eye-off"}>
      {it.viewed ? "未交" : "没看"}
    </Tag>
  );

/**
 * 学习计划页（和 App 一致）。创建人在这一页看完所有东西，不再有单独的「作业情况」页：顶部交齐 / 没交齐 / 总成员（都数人）；
 * 「作业」一份作业一张卡片：头部是序号 + 作业名 + 布置日期和文件数 + 已交 / 没交 / 没看三个数，文件缩进排在下面（点文件直接打开）。
 * 最新一份默认展开，其余收成一行，点头部展开 / 收起；文件多于 3 个先显示 3 个，「其余 N 个文件」点开看全部；展开的卡片最下面是「添加文件」（进布置页的加文件模式）。
 * 点头部那三个数看这份作业的名单（谁交了、谁没交、谁还没看）。创建人把一份作业整张向左滑，露出「删除」；「成员情况」列头像 + 名字 + 进度环（交了几份 / 共几份），可按交齐 / 没交齐筛选，
 * 点一个人看他每份作业的情况并进去批阅、移出。成员：只有自己的待交 / 已交和作业（见 components/PlanMember），
 * 看不到其他成员、人数和别人交没交。头部两边一样：创建人头像 + 名字 + 创建时间（计划名在顶部标题栏），右边一个圆图标按钮，
 * 创建人是「解散」（在转发左边），成员是「退出」，点了都先确认。计划名和成员的名字都不在这里改（名字在「我的」里改，会同步过来）。
 * 「让旧卡片失效」在「成员情况」页签最下面。页面上能用图标 + 数字说清的就不写字。
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
  const [swiped, setSwiped] = useState<string | null>(null); // 创建人左滑开着的那份作业
  const [opened, setOpened] = useState<Record<string, boolean>>({}); // 手动展开 / 收起过的作业（没动过的：最新一份展开，其余收起）
  const [full, setFull] = useState<Record<string, boolean>>({}); // 文件全部展开了的作业
  const [board, setBoard] = useState<string | null>(null); // 正在看名单的那份作业
  const [boardFilter, setBoardFilter] = useState<"all" | "done" | "missing">("all");
  const [hint, setHint] = useState(swipeHintPending); // 第一次看到作业：第一张卡片自己滑出一小截，露一下「删除」
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
  usePageScroll(() => {
    if (swiped) setSwiped(null);
  });
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
    setSwiped(null);
    const n = (a.files ?? []).length;
    if (!(await confirm("删除这份作业？", `${n > 1 ? `作业里的 ${n} 个文件会一起删除。` : ""}没交的同学不会再看到，交过的还能看到自己那份。`, "删除", true))) return;
    await act(async () => {
      await revokeAssignment(a.id);
      bumpPlans();
      await load();
    }, "已删除");
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
  const ownerBody = () => {
    const list = data.assignments as OwnerAssignment[];
    const rows = data.members ?? [];
    const active = rows.filter((m) => !m.left);
    const handed = active.filter((m) => memberState(m) === "submitted").length;
    const missing = plan.missing ?? active.filter((m) => memberState(m) === "missing").length;
    const shown = filter === "all" ? rows : active.filter((m) => memberState(m) === filter);
    const filters: { value: Filter; label: string; n: number }[] = [
      { value: "all", label: "全部", n: rows.length },
      { value: "submitted", label: "交齐", n: handed },
      { value: "missing", label: "没交齐", n: missing },
    ];
    return (
      <>
        <View className="stats">
          <Stat icon="checkcircle" label="交齐" value={handed} />
          <Stat icon="clock" label="没交齐" value={missing} />
          <Stat icon="family" label="总成员" value={plan.members ?? active.length} />
        </View>
        <IconSegmented
          value={tab}
          onChange={(t) => { setSwiped(null); setTab(t); }}
          options={[
            { value: "tasks", label: `作业 ${list.length}`, icon: "pencil" },
            { value: "members", label: `成员情况 ${active.length}`, icon: "chart" },
          ]}
        />
        {tab === "tasks" && list.length === 0 && (
          <View className="group">
            <View className="hw-empty">
              <Icon name="document" size={34} color={C.tertiary} stroke={1.6} />
              <Text className="hw-empty__title">还没有作业</Text>
              <Text className="hw-empty__sub">点下面的「布置新作业」，扫描或上传文件{"\n"}一次布置的所有文件算一份作业</Text>
            </View>
          </View>
        )}
        {tab === "tasks" &&
          list.map((a, i) => {
            const files = a.files ?? [];
            const open = opened[a.id] ?? i === 0;
            const shownFiles = open ? (full[a.id] ? files : files.slice(0, HW_PREVIEW)) : [];
            const rest = files.length - HW_PREVIEW;
            const tap = (fn: () => void) => (e?: { stopPropagation?: () => void }) => {
              e?.stopPropagation?.();
              if (swipeGuard.moved) return;
              if (swiped) return setSwiped(null);
              fn();
            };
            // 头部：序号（第几次布置）+ 作业名 + 「11月12日 · 5 个文件」+ 三个数（绿勾 = 已交，灰色时钟 = 没交，灰色闭眼 = 没交的人里还没看过的），点三个数看名单
            const head = (
              <View className="hw-head" hoverClass="list-row--hover" onClick={tap(() => setOpened((o) => ({ ...o, [a.id]: !open })))}>
                <View className="hw-no">
                  <Text>{list.length - i}</Text>
                </View>
                <View className="flex1 col minw0">
                  <Text className="hw-title ellipsis">{a.title}</Text>
                  <View className="hw-sub">
                    <Text className="flex1 ellipsis">
                      {hwMeta(a)}
                      {a.dueAt ? ` · ${dueLabel(a.dueAt)}截止` : ""}
                    </Text>
                    <View className="plan-counts hw-counts" onClick={tap(() => { setBoardFilter("all"); setBoard(a.id); })}>
                      {count("checkcircle", C.ok, a.submitted)}
                      {count("clock", C.secondary, a.missing)}
                      {count("eye-off", C.tertiary, a.unseen)}
                    </View>
                  </View>
                </View>
                <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={C.tertiary} stroke={2.4} />
              </View>
            );
            const rows = shownFiles.map((f) => (
              <View key={f.id} className="list-row hw-file" hoverClass="list-row--hover" onClick={tap(() => void openPlanFile(f, files))}>
                <View className="plan-file__icon plan-file__icon--sm">
                  <Text>{fileBadge(f.mime)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="hw-file__name ellipsis">{f.name}</Text>
                  <Text className="row__sub">{sizeLabel(f.size)}</Text>
                </View>
                <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
              </View>
            ));
            const foot = open && (
              <>
                {rest > 0 && (
                  <View className="hw-foot" hoverClass="list-row--hover" onClick={tap(() => setFull((m) => ({ ...m, [a.id]: !m[a.id] })))}>
                    <Text>{full[a.id] ? "收起" : `其余 ${rest} 个文件`}</Text>
                    <Icon name={full[a.id] ? "chevron-up" : "chevron-down"} size={13} color={C.brand} stroke={2.4} />
                  </View>
                )}
                <View
                  className="hw-foot"
                  hoverClass="list-row--hover"
                  onClick={tap(() =>
                    void go(`/pages/plan-new/index?planId=${plan.id}&assignmentId=${a.id}&title=${encodeURIComponent(a.title)}&count=${files.length}&scans=${files.filter((f) => f.kind === "scan").length}`),
                  )}
                >
                  <Icon name="plus" size={14} color={C.brand} stroke={2.6} />
                  <Text>添加文件</Text>
                </View>
              </>
            );
            // 创建人：整张卡片（头部 + 文件）一起左滑，露出红色「删除」
            return owner ? (
              <SwipeRow
                key={a.id}
                open={swiped === a.id}
                onOpenChange={(o) => setSwiped(o ? a.id : null)}
                onDelete={() => void revoke(a)}
                hint={hint && a.id === list[0].id}
                onHintDone={() => {
                  setHint(false);
                  try {
                    Taro.setStorageSync(SWIPE_HINT, "1");
                  } catch {
                    /* 存不下：下次再演示一遍 */
                  }
                }}
              >
                {head}
                {rows}
                {foot}
              </SwipeRow>
            ) : (
              <View key={a.id} className="group">
                {head}
                {rows}
                {foot}
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
              {shown.length === 0 && <Text className="plan-empty">{rows.length === 0 ? "还没有人加入" : filter === "missing" ? "都交齐了" : "还没有人交齐"}</Text>}
              {shown.map((m) => {
                return (
                  <View key={m.userId} className="list-row" hoverClass="list-row--hover" style={{ minHeight: "56px" }} onClick={() => setMember(m)}>
                    <Avatar name={m.name} url={m.avatar} />
                    <Text className="row__title ellipsis flex1">
                      {memberName(m)}
                      {m.left ? "（已退出）" : ""}
                    </Text>
                    <SubmitProgress done={m.submitted} total={m.assignments} />
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

      {/* 点一份作业头部的三个数：这份作业的名单（按作业看；「成员情况」页签是按人看） */}
      {(() => {
        const a = board ? (data.assignments as OwnerAssignment[]).find((x) => x.id === board) : null;
        if (!a) return null;
        const people = (data.members ?? [])
          .map((m) => ({ m, it: (m.items ?? []).find((x) => x.assignmentId === a.id) }))
          .filter((x): x is { m: PlanMemberRow; it: MemberItem } => Boolean(x.it) && (!x.m.left || Boolean(x.it?.submissionId)));
        const handedIn = (it: MemberItem) => it.status === "submitted" || it.status === "reviewed";
        const done = people.filter((x) => handedIn(x.it));
        const missing = people.filter((x) => !handedIn(x.it));
        const shownPeople = boardFilter === "done" ? done : boardFilter === "missing" ? missing : [...done, ...missing];
        const chips = [
          { value: "all" as const, label: "全部", n: people.length },
          { value: "done" as const, label: "已交", n: done.length },
          { value: "missing" as const, label: "未交", n: missing.length },
        ];
        return (
          <Sheet open onClose={() => setBoard(null)} title={a.title}>
            <View className="row-center gap8">
              {chips.map((f) => (
                <View key={f.value} className={`chip${boardFilter === f.value ? " chip--on" : ""}`} onClick={() => setBoardFilter(f.value)}>
                  <Text>{f.label}</Text>
                  <Text className="num">{f.n}</Text>
                </View>
              ))}
            </View>
            <View className="group group--fill">
              {shownPeople.length === 0 && <Text className="plan-empty">{people.length === 0 ? "还没有人加入" : boardFilter === "done" ? "还没有人交" : "都交了"}</Text>}
              {shownPeople.map(({ m, it }) => (
                <View
                  key={m.userId}
                  className="list-row"
                  hoverClass={it.submissionId ? "list-row--hover" : "none"}
                  onClick={() => {
                    if (!it.submissionId) return;
                    setBoard(null);
                    void go(`/pages/plan-review/index?id=${it.submissionId}`);
                  }}
                >
                  <Avatar name={m.name} url={m.avatar} />
                  <Text className="row__title ellipsis flex1">
                    {memberName(m)}
                    {m.left ? "（已退出）" : ""}
                  </Text>
                  {itemTag(it)}
                  {it.submissionId && <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />}
                </View>
              ))}
            </View>
          </Sheet>
        );
      })()}

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
                  {AI_GRADING && (it.status === "submitted" || it.status === "reviewed") && (it.score ? <ScoreCounts score={it.score} /> : <Text className="row__sub">批改中</Text>)}
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

    </View>
  );
}
