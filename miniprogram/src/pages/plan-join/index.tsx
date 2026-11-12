import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { NameSheet, PageState, confirm } from "../../components/plan";
import { Avatar, Button } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { LOGIN_CLOSED_EVENT, LOGIN_PAGE, currentUser, isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { DEFAULT_NICKNAME, teacherLine, bumpPlans, joinPlan, joinedText, startPlanSync, type AssignmentBrief, type JoinedPreview, type PlanInfo, type PlanSubject } from "../../lib/plans";
import { useShare } from "../../lib/share";
import { C, useThemeClass } from "../../lib/theme";

interface Preview {
  plan: { id: string; name: string; subject: PlanSubject | null; teacher: string; teacherAvatar?: string | null };
  assignment: AssignmentBrief | null;
  /** 旧版本的服务器不给这一项 */
  members?: JoinedPreview;
  /** 登录后才有：owner = 自己建的，member = 已经在里面，null = 还没加入 */
  role: "owner" | "member" | null;
}

/**
 * 点开微信里的卡片后落到这里（相当于 App 的落地页 + 加入页合成一步）：
 * 先看到是谁建的（头像 + 称呼）、哪个计划、哪份作业、已经有谁加入了；点「加入学习计划」再确认一次才加入，没登录的确认后微信一键登录。
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

  return (
    <View className={"page center-page" + tc}>
      {joining || !preview ? (
        <>
          <View className="spinner spinner--lg" />
          {joining && <Text className="t-sub c-sec">正在加入…</Text>}
        </>
      ) : (
        <>
          <View className="card plan-join" style={{ width: "100%", boxSizing: "border-box" }}>
            <Avatar name={preview.plan.teacher} url={preview.plan.teacherAvatar} size={64} />
            <Text className="t-foot c-sec" style={{ marginTop: "8px" }}>
              {teacherLine(preview.plan.teacher, preview.plan.subject)}
            </Text>
            <Text className="t-title2" style={{ fontWeight: 800 }}>
              {preview.plan.name}
            </Text>
            {preview.assignment && (
              <View className="row-center gap4">
                <Icon name="document" size={14} color={C.secondary} stroke={2.2} />
                <Text className="t-sub c-sec">{preview.assignment.title}</Text>
              </View>
            )}
            {members && (
              <View className="plan-join__members">
                {members.count > 0 && (
                  <View className="avatar-stack">
                    {members.list.slice(0, 5).map((m, i) => (
                      <View key={i} className="avatar-stack__item">
                        <Avatar name={m.name} url={m.avatar} size={28} />
                      </View>
                    ))}
                  </View>
                )}
                <Text className="t-foot c-sec">{joinedText(members, owner)}</Text>
              </View>
            )}
          </View>
          {owner ? (
            <Button onClick={() => void enter({ id: preview.plan.id, role: "owner" })} style={{ width: "100%" }}>
              进入学习计划
            </Button>
          ) : (
            <Button onClick={() => void askJoin()} style={{ width: "100%" }}>
              加入学习计划
            </Button>
          )}
        </>
      )}
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
