import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { NameSheet, PageState, confirm } from "../../components/plan";
import { Avatar, Button, Tag } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { LOGIN_CLOSED_EVENT, LOGIN_PAGE, currentUser, isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { DEFAULT_NICKNAME, HW_PREVIEW, bumpPlans, dueLabel, fileBadge, hwMeta, joinPlan, joinedText, sizeLabel, startPlanSync, type AssignmentBrief, type JoinedPreview, type PlanInfo, type PlanSubject, type PreviewAssignment } from "../../lib/plans";
import { useShare } from "../../lib/share";
import { C, useThemeClass } from "../../lib/theme";

interface Preview {
  plan: { id: string; name: string; subject: PlanSubject | null; teacher: string; teacherAvatar?: string | null };
  /** 卡片指向的那份作业（没指定就是最新一份） */
  assignment: AssignmentBrief | null;
  /** 计划里的全部作业和各自的文件，新的在上；旧版本的服务器不给这一项 */
  assignments?: PreviewAssignment[];
  /** 旧版本的服务器不给这一项 */
  members?: JoinedPreview;
  /** 登录后才有：owner = 自己建的，member = 已经在里面，null = 还没加入 */
  role: "owner" | "member" | null;
}

/**
 * 点开微信里的卡片后落到这里（相当于 App 的落地页 + 加入页合成一步）：
 * 最上面一条是谁建的（头像 + 称呼）、哪个计划、已经有谁加入了；下面是作业清单，和计划页同一种卡片：先看到作业名，再看到这份作业下面的文件。
 * 卡片指向的那份标「这次布置」并展开，其余收成一行。还没加入时文件只看得到名字和大小，点文件和点按钮一样是加入。
 * 点「加入学习计划」再确认一次才加入，没登录的确认后微信一键登录。
 * 加入后先到学习计划页（创建人、计划名、创建时间、全部作业）。已经在里面的同学不用再点，直接进到这份作业。创建人点开自己的卡片也停在这一页，看到的和同学一样，只多一个「进入学习计划」。
 * 不用老师批准。刚注册的新用户先起名字；已经在用的直接用自己的名字加入。
 */
export default function PlanJoin() {
  const tc = useThemeClass();
  useShare(); // 这一页转发出去只是首页：学生不能把老师的卡片再包一层发出去
  const { code = "", a = "" } = useRouter().params;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [naming, setNaming] = useState<PlanInfo | null>(null);
  /** 作业卡片手动展开 / 收起过的（没动过的：卡片指向的那份展开）；full = 点过「其余 N 个文件」的 */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState<Record<string, boolean>>({});
  const started = useRef(false);

  const enter = (plan: Pick<PlanInfo, "id" | "role">) => Taro.redirectTo({ url: `/pages/plan/index?id=${plan.id}` });

  const toPlan = (plan: Pick<PlanInfo, "id">) => Taro.redirectTo({ url: `/pages/plan/index?id=${plan.id}` });

  const join = async () => {
    if (started.current) return;
    started.current = true;
    setJoining(true);
    try {
      const res = await joinPlan(code);
      startPlanSync();
      bumpPlans();
      if (res.plan.role !== "owner" && res.me.needsName) return setNaming(res.plan);
      if (res.joined) toast(`已用「${res.me.name}」加入「${res.plan.name}」`);
      // 刚加入的先到学习计划页：是谁的计划、有哪些作业一眼看全；本来就在里面的直接进这份作业
      void (res.joined ? toPlan(res.plan) : enter(res.plan));
    } catch (e) {
      started.current = false;
      setJoining(false);
      setError(errorText(e) || "加入失败，请稍后再试");
    }
  };

  useEffect(() => {
    if (!code) return setError("这张卡片不完整，请让老师重新转发一次");
    api<Preview>(`/api/plans/invite/${encodeURIComponent(code)}${a ? `?a=${encodeURIComponent(a)}` : ""}`, { auth: isLoggedIn() })
      .then((p) => {
        // 已经在里面的同学：不用再确认，直接进到这份作业
        if (p.role === "member") return void enter({ id: p.plan.id, role: "member" });
        // 服务器还是旧版本时没有 members / role：不显示「已加入的人」那一行、按还没加入处理，不能让页面卡在转圈
        setPreview({ ...p, role: p.role ?? null });
      })
      .catch((e) => setError(errorText(e) || "打不开这张卡片"));
  }, [code, a]);

  /** 没登录：打开登录页，登录成功回来就加入（已经确认过了，不再问第二遍） */
  const loginThenJoin = () => {
    if (isLoggedIn()) return void join();
    const done = () => {
      Taro.eventCenter.off(LOGIN_CLOSED_EVENT, done);
      if (isLoggedIn()) void join();
    };
    Taro.eventCenter.on(LOGIN_CLOSED_EVENT, done);
    Taro.navigateTo({ url: LOGIN_PAGE }).catch(done);
  };

  /** 点「加入学习计划」：先确认一次，免得手滑点开卡片就进了别人的计划 */
  const askJoin = async () => {
    if (!preview) return;
    const nick = currentUser()?.nickname ?? "";
    const as = isLoggedIn() && nick && nick !== DEFAULT_NICKNAME ? `你会用「${nick}」加入，` : "加入后，";
    if (await confirm(`加入「${preview.plan.name}」？`, `${as}${preview.plan.teacher}能看到你的名字和你交的作业。`, "加入")) loginThenJoin();
  };

  const mine = (
    <Button size="sm" onClick={() => void Taro.redirectTo({ url: "/pages/plans/index" })}>
      看看我的学习计划
    </Button>
  );
  const owner = preview?.role === "owner";
  const members = preview?.members;
  if (error) return <PageState error={error} action={isLoggedIn() ? mine : undefined} />;

  // 旧版本的服务器只给一份作业、不给文件：照样排成一张卡片，只是没有文件
  const legacy = Boolean(preview && !preview.assignments);
  const list: PreviewAssignment[] = preview?.assignments ?? (preview?.assignment ? [{ ...preview.assignment, files: [], shared: true }] : []);
  const solo = list.length === 1;
  /** 点文件：还没加入的去加入，创建人直接进计划 */
  const tapFile = () => (owner ? void enter({ id: preview!.plan.id, role: "owner" }) : void askJoin());

  if (joining || !preview)
    return (
      <View className={"page center-page" + tc}>
        <View className="spinner spinner--lg" />
        {joining && <Text className="t-sub c-sec">正在加入…</Text>}
      </View>
    );

  return (
    <View className={"page plan-join-page" + tc}>
      <View className="group plan-join">
        <View className="row-center" style={{ gap: "12px" }}>
          <Avatar name={preview.plan.teacher} url={preview.plan.teacherAvatar} size={46} />
          <View className="flex1 col minw0">
            <Text className="t-foot c-sec ellipsis">{owner ? "你建的学习计划" : `${preview.plan.teacher} 邀请你加入`}</Text>
            <Text className="plan-join__name">{preview.plan.name}</Text>
          </View>
        </View>
        {members && (
          <View className="plan-join__members">
            {members.count > 0 && (
              <View className="avatar-stack">
                {members.list.slice(0, 5).map((m, i) => (
                  <View key={i} className="avatar-stack__item">
                    <Avatar name={m.name} url={m.avatar} size={24} />
                  </View>
                ))}
              </View>
            )}
            <Text className="t-foot c-sec flex1 ellipsis">{joinedText(members, owner)}</Text>
          </View>
        )}
      </View>
      <Text className="plan-join__label">作业 {list.length}</Text>
      {list.length === 0 && (
        <View className="group">
          <View className="hw-empty">
            <Icon name="document" size={34} color={C.tertiary} stroke={1.6} />
            <Text className="hw-empty__title">{owner ? "还没有布置作业" : "老师还没有布置作业"}</Text>
            <Text className="hw-empty__sub">{owner ? "布置后同学点开卡片就能看到" : "可以先加入\n老师布置后会出现在计划里"}</Text>
          </View>
        </View>
      )}
      {list.map((a, i) => {
        // 只有一份时始终展开；多份时卡片指向的那份展开，其余收成一行，点头部展开 / 收起
        const open = solo || (opened[a.id] ?? a.shared);
        const shown = open ? (full[a.id] ? a.files : a.files.slice(0, HW_PREVIEW)) : [];
        const rest = a.files.length - HW_PREVIEW;
        return (
          <View key={a.id} className="hw group">
            <View className="hw-head" hoverClass={solo ? "none" : "list-row--hover"} onClick={solo ? undefined : () => setOpened((o) => ({ ...o, [a.id]: !open }))}>
              <View className="hw-no">
                <Text>{list.length - i}</Text>
              </View>
              <View className="flex1 col minw0">
                <Text className="hw-title ellipsis">{a.title}</Text>
                <View className="hw-sub">
                  <Text className="flex1 ellipsis">
                    {legacy ? hwMeta({ createdAt: a.createdAt }).split(" · ")[0] : hwMeta(a)}
                    {a.dueAt ? ` · ${dueLabel(a.dueAt)}截止` : ""}
                  </Text>
                </View>
              </View>
              {a.shared && !solo && (
                <Tag kind="info" icon={null}>
                  这次布置
                </Tag>
              )}
              {!solo && <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={C.tertiary} stroke={2.4} />}
            </View>
            {shown.map((f) => (
              <View key={f.id} className="list-row hw-file" hoverClass="list-row--hover" onClick={tapFile}>
                <View className="plan-file__icon plan-file__icon--sm">
                  <Text>{fileBadge(f.mime)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="hw-file__name ellipsis">{f.name}</Text>
                  <Text className="row__sub">{sizeLabel(f.size)}</Text>
                </View>
                {!owner && <Icon name="lock" size={14} color={C.tertiary} stroke={2} />}
              </View>
            ))}
            {open && rest > 0 && (
              <View className="hw-foot" hoverClass="list-row--hover" onClick={() => setFull((m) => ({ ...m, [a.id]: !m[a.id] }))}>
                <Text>{full[a.id] ? "收起" : `其余 ${rest} 个文件`}</Text>
                <Icon name={full[a.id] ? "chevron-up" : "chevron-down"} size={13} color={C.brand} stroke={2.4} />
              </View>
            )}
          </View>
        );
      })}
      <View className="bottom-bar bottom-bar--col">
        {owner ? (
          <Button onClick={() => void enter({ id: preview.plan.id, role: "owner" })} style={{ width: "100%" }}>
            进入学习计划
          </Button>
        ) : (
          <Button onClick={() => void askJoin()} style={{ width: "100%" }}>
            加入学习计划
          </Button>
        )}
        <View className="plan-join__tip">
          {!owner && list.length > 0 && <Icon name="lock" size={11} color={C.tertiary} stroke={2.2} />}
          <Text>{owner ? "这是同学点开卡片后看到的样子" : list.length ? "加入后可以打开文件、扫描交作业" : "不用老师批准，加入后老师布置的作业会出现在计划里"}</Text>
        </View>
      </View>
      <NameSheet
        open={Boolean(naming)}
        required
        onClose={() => undefined}
        onDone={(name) => {
          const plan = naming!;
          setNaming(null);
          toast(`已用「${name}」加入「${plan.name}」`);
          void toPlan(plan);
        }}
      />
    </View>
  );
}
