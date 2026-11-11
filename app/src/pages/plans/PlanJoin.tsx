import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Spinner } from "../../components/ui";
import { Avatar } from "../../components/v2";
import { DEFAULT_NICKNAME, teacherLine, joinPlan, joinedText, rememberJoin, usePlans, type AssignmentBrief, type JoinedPreview, type PlanInfo, type PlanSubject } from "../../lib/plans";
import { useAuth } from "../../store/auth";
import { toast } from "../../store/banner";
import { ConfirmSheet, NameSheet } from "./shared";

interface Preview {
  plan: { id: string; name: string; subject: PlanSubject | null; teacher: string; teacherAvatar?: string | null };
  assignment: AssignmentBrief | null;
  /** 旧版本的服务器不给这一项 */
  members?: JoinedPreview;
  /** owner = 自己建的，member = 已经在里面，null = 还没加入 */
  role: "owner" | "member" | null;
}

/**
 * 点开微信里的卡片后落到这里（和小程序的加入页一致）：
 * 先看到是谁建的（头像 + 称呼）、哪个计划、哪份作业、已经有谁加入了；点「加入学习计划」再确认一次才加入，不用老师批准。
 * 加入后先到学习计划页（创建人、计划名、创建时间、全部作业）。已经在里面的同学不用再点，直接进到这份作业。创建人点开自己的卡片也停在这一页，只多一个「进入学习计划」。
 * 刚注册的新用户先起名字；已经在用上壹课的直接用 App 里的名字加入。
 */
export default function PlanJoin() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const a = params.get("a") ?? "";
  const nickname = useAuth((s) => s.user?.nickname) ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [naming, setNaming] = useState<{ plan: PlanInfo } | null>(null);
  const started = useRef(false);

  const enter = (plan: Pick<PlanInfo, "id" | "role">) => nav(`/plans/${plan.id}`, { replace: true });
  // 只把服务器给的中文提示显示出来；别的异常（比如浏览器内部报错）不直接给用户看
  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError && e.message ? e.message : fallback);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    rememberJoin(null);
    if (!code) return setError("这张卡片不完整，请让老师重新转发一次");
    api<Preview>(`/api/plans/invite/${encodeURIComponent(code)}${a ? `?a=${encodeURIComponent(a)}` : ""}`)
      .then((p) => {
        // 已经在里面的同学：不用再确认，直接进到这份作业
        if (p.role === "member") return enter({ id: p.plan.id, role: "member" });
        // 服务器还是旧版本时没有 members / role：不显示「已加入的人」那一行、按还没加入处理，不能让页面卡在转圈
        setPreview({ ...p, role: p.role ?? null });
      })
      .catch((e) => fail(e, "打不开这张卡片"));
  }, [code, a]);

  const join = () => {
    setAsking(false);
    setJoining(true);
    joinPlan(code)
      .then((res) => {
        usePlans.getState().bump();
        if (res.plan.role === "owner") return enter(res.plan);
        if (res.me.needsName) return setNaming({ plan: res.plan });
        if (res.joined) toast(`已用「${res.me.name}」加入「${res.plan.name}」`, "success");
        // 刚加入的先到学习计划页：是谁的计划、有哪些作业一眼看全；本来就在里面的直接进这份作业
        if (res.joined) nav(`/plans/${res.plan.id}`, { replace: true });
        else enter(res.plan);
      })
      .catch((e) => fail(e, "加入失败，请稍后再试"));
  };

  const owner = preview?.role === "owner";
  const members = preview?.members;
  const as = nickname && nickname !== DEFAULT_NICKNAME ? `你会用「${nickname}」加入，` : "加入后，";

  return (
    <div className="screen">
      <InlineNav title="加入学习计划" back onBack={() => nav("/plans", { replace: true })} />
      {error ? (
        <Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>看看我的学习计划</Button>} />
      ) : joining || !preview ? (
        <Spinner text={joining ? "正在加入…" : undefined} />
      ) : (
        <div className="screen__content screen__content--modal" style={{ paddingTop: 24, gap: 16 }}>
          <div className="card" style={{ alignItems: "center", textAlign: "center", gap: 6, padding: "28px 20px" }}>
            <Avatar name={preview.plan.teacher} url={preview.plan.teacherAvatar} size={64} />
            <span className="t-foot c-sec" style={{ marginTop: 8 }}>{teacherLine(preview.plan.teacher, preview.plan.subject)}</span>
            <span className="t-title2" style={{ fontWeight: 800 }}>{preview.plan.name}</span>
            {preview.assignment && (
              <span className="t-sub c-sec" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="document" size={14} stroke={2.2} />{preview.assignment.title}
              </span>
            )}
            {members && (
              <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--separator-light)" }}>
                {members.count > 0 && (
                  <span style={{ display: "flex", flexShrink: 0 }}>
                    {members.list.slice(0, 5).map((m, i) => (
                      <Avatar key={i} name={m.name} url={m.avatar} size={28} style={{ marginLeft: i ? -8 : 0, boxShadow: "0 0 0 2px var(--card)" }} />
                    ))}
                  </span>
                )}
                <span className="t-foot c-sec">{joinedText(members, owner)}</span>
              </div>
            )}
          </div>
          {owner ? <Button onClick={() => enter({ id: preview.plan.id, role: "owner" })}>进入学习计划</Button> : <Button onClick={() => setAsking(true)}>加入学习计划</Button>}
        </div>
      )}
      <ConfirmSheet open={asking} title={`加入「${preview?.plan.name ?? ""}」？`} text={`${as}${preview?.plan.teacher ?? "老师"}能看到你的名字和你交的作业。`} action="加入" onClose={() => setAsking(false)} onConfirm={join} />
      <NameSheet
        open={Boolean(naming)}
        required
        onClose={() => undefined}
        onDone={(name) => {
          const plan = naming!.plan;
          setNaming(null);
          toast(`已用「${name}」加入「${plan.name}」`, "success");
          nav(`/plans/${plan.id}`, { replace: true });
        }}
      />
    </div>
  );
}
