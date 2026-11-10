import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { NameSheet, PageState, PlanTile } from "../../components/plan";
import { Button } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { LOGIN_CLOSED_EVENT, LOGIN_PAGE, isLoggedIn } from "../../lib/auth";
import { toast } from "../../lib/hooks";
import { PLAN_SUBJECT_LABEL, bumpPlans, joinPlan, startPlanSync, type AssignmentBrief, type PlanInfo, type PlanSubject } from "../../lib/plans";
import { useShare } from "../../lib/share";

interface Preview {
  plan: { id: string; name: string; subject: PlanSubject; teacher: string };
  assignment: AssignmentBrief | null;
}

/**
 * 点开微信里的卡片后落到这里（相当于 App 的落地页 + 加入页合成一步）：
 * 已经登录的直接自动加入、跳到这份作业；还没登录的看到是谁邀请、哪份作业，只有一个按钮「加入学习计划」，微信一键登录后自动加入。
 * 不用老师批准。刚注册的新用户先起名字；已经在用的直接用自己的名字加入。
 */
export default function PlanJoin() {
  useShare(); // 这一页转发出去只是首页：学生不能把老师的卡片再包一层发出去
  const { code = "", a = "" } = useRouter().params;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(isLoggedIn());
  const [naming, setNaming] = useState<PlanInfo | null>(null);
  const started = useRef(false);

  const enter = (plan: PlanInfo) => Taro.redirectTo({ url: a && plan.role === "member" ? `/pages/plan-task/index?id=${a}` : `/pages/plan/index?id=${plan.id}` });

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
      void enter(res.plan);
    } catch (e) {
      started.current = false;
      setJoining(false);
      setError(errorText(e) || "加入失败，请稍后再试");
    }
  };

  useEffect(() => {
    if (!code) return setError("这张卡片不完整，请让老师重新转发一次");
    if (isLoggedIn()) return void join();
    api<Preview>(`/api/plans/invite/${encodeURIComponent(code)}${a ? `?a=${encodeURIComponent(a)}` : ""}`, { auth: false })
      .then(setPreview)
      .catch((e) => setError(errorText(e) || "打不开这张卡片"));
  }, [code, a]);

  /** 没登录：打开登录页，登录成功回来就自动加入 */
  const loginThenJoin = () => {
    if (isLoggedIn()) return void join();
    const done = () => {
      Taro.eventCenter.off(LOGIN_CLOSED_EVENT, done);
      if (isLoggedIn()) void join();
    };
    Taro.eventCenter.on(LOGIN_CLOSED_EVENT, done);
    Taro.navigateTo({ url: LOGIN_PAGE }).catch(done);
  };

  const mine = (
    <Button size="sm" onClick={() => void Taro.redirectTo({ url: "/pages/plans/index" })}>
      看看我的学习计划
    </Button>
  );
  if (error) return <PageState error={error} action={isLoggedIn() ? mine : undefined} />;

  return (
    <View className="page center-page">
      {joining || !preview ? (
        <>
          <View className="spinner spinner--lg" />
          {joining && <Text className="t-sub c-sec">正在加入…</Text>}
        </>
      ) : (
        <>
          <View className="card plan-join" style={{ width: "100%", boxSizing: "border-box" }}>
            <PlanTile subject={preview.plan.subject} size="lg" />
            <Text className="t-foot c-sec" style={{ marginTop: "8px" }}>
              {preview.plan.teacher} 邀请你加入 · {PLAN_SUBJECT_LABEL[preview.plan.subject] ?? "综合"}
            </Text>
            <Text className="t-title2" style={{ fontWeight: 800 }}>
              {preview.plan.name}
            </Text>
            {preview.assignment && <Text className="t-sub c-sec">作业：{preview.assignment.title}</Text>}
          </View>
          <Button onClick={loginThenJoin} style={{ width: "100%" }}>
            加入学习计划
          </Button>
          <Text className="t-cap c-sec">用微信登录后自动加入，不用老师批准</Text>
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
          void enter(plan);
        }}
      />
    </View>
  );
}
