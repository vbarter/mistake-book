import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Empty, InlineNav, Spinner } from "../../components/ui";
import { joinPlan, rememberJoin, usePlans, type PlanInfo } from "../../lib/plans";
import { toast } from "../../store/banner";
import { NameSheet } from "./shared";

/**
 * 点开微信里的卡片后落到这里：自动加入，不用老师批准。
 * 刚注册的新用户先起名字；已经在用上壹课的直接用 App 里的名字加入。
 */
export default function PlanJoin() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const a = params.get("a") ?? "";
  const [error, setError] = useState("");
  const [naming, setNaming] = useState<{ plan: PlanInfo } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    rememberJoin(null);
    if (!code) return setError("这张卡片不完整，请让老师重新转发一次");
    const enter = (plan: PlanInfo) => nav(a && plan.role === "member" ? `/plans/a/${a}` : `/plans/${plan.id}`, { replace: true });
    joinPlan(code)
      .then((res) => {
        usePlans.getState().bump();
        if (res.plan.role === "owner") return enter(res.plan);
        if (res.me.needsName) return setNaming({ plan: res.plan });
        if (res.joined) toast(`已用「${res.me.name}」加入「${res.plan.name}」`, "success");
        enter(res.plan);
      })
      .catch((e) => setError((e as Error).message || "加入失败，请稍后再试"));
  }, [code, a, nav]);

  return (
    <div className="screen">
      <InlineNav title="加入学习计划" back onBack={() => nav("/plans", { replace: true })} />
      {error ? <Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>看看我的学习计划</Button>} /> : <Spinner text="正在加入…" />}
      <NameSheet
        open={Boolean(naming)}
        required
        onClose={() => undefined}
        onDone={(name) => {
          const plan = naming!.plan;
          setNaming(null);
          toast(`已用「${name}」加入「${plan.name}」`, "success");
          nav(a ? `/plans/a/${a}` : `/plans/${plan.id}`, { replace: true });
        }}
      />
    </div>
  );
}
