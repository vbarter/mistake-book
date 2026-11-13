import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Spinner } from "../../components/ui";
import { Avatar, Tag } from "../../components/v2";
import { DEFAULT_NICKNAME, HW_PREVIEW, dueLabel, fileBadge, hwMeta, joinPlan, joinedText, rememberJoin, sizeLabel, usePlans, type AssignmentBrief, type JoinedPreview, type PlanInfo, type PlanSubject, type PreviewAssignment } from "../../lib/plans";
import { useAuth } from "../../store/auth";
import { toast } from "../../store/banner";
import { ConfirmSheet, NameSheet } from "./shared";

interface Preview {
  plan: { id: string; name: string; subject: PlanSubject | null; teacher: string; teacherAvatar?: string | null };
  /** 卡片指向的那份作业（没指定就是最新一份） */
  assignment: AssignmentBrief | null;
  /** 计划里的全部作业和各自的文件，新的在上；旧版本的服务器不给这一项 */
  assignments?: PreviewAssignment[];
  /** 旧版本的服务器不给这一项 */
  members?: JoinedPreview;
  /** owner = 自己建的，member = 已经在里面，null = 还没加入 */
  role: "owner" | "member" | null;
}

/**
 * 点开微信里的卡片后落到这里（和小程序的加入页一致）：
 * 最上面一条是谁建的（头像 + 称呼）、哪个计划、已经有谁加入了；下面是作业清单，和计划页同一种卡片：先看到作业名，再看到这份作业下面的文件。
 * 卡片指向的那份标「这次布置」并展开，其余收成一行。还没加入时文件只看得到名字和大小，点文件和点按钮一样是加入。
 * 点「加入学习计划」再确认一次才加入，不用老师批准。
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
  /** 作业卡片手动展开 / 收起过的（没动过的：卡片指向的那份展开）；full = 点过「其余 N 个文件」的 */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState<Record<string, boolean>>({});
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
  // 旧版本的服务器只给一份作业、不给文件：照样排成一张卡片，只是没有文件
  const legacy = Boolean(preview && !preview.assignments);
  const list: PreviewAssignment[] = preview?.assignments ?? (preview?.assignment ? [{ ...preview.assignment, files: [], shared: true }] : []);
  const solo = list.length === 1;
  const enterOwn = () => preview && enter({ id: preview.plan.id, role: "owner" });
  const as = nickname && nickname !== DEFAULT_NICKNAME ? `你会用「${nickname}」加入，` : "加入后，";

  return (
    <div className="screen">
      <InlineNav title="加入学习计划" back onBack={() => nav("/plans", { replace: true })} />
      {error ? (
        <Empty icon="warning" title={error} action={<Button size="sm" onClick={() => nav("/plans", { replace: true })}>看看我的学习计划</Button>} />
      ) : joining || !preview ? (
        <Spinner text={joining ? "正在加入…" : undefined} />
      ) : (
        <div className="screen__content" style={{ paddingTop: 12, gap: 12, paddingBottom: 0 }}>
          <div className="group plan-join">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={preview.plan.teacher} url={preview.plan.teacherAvatar} size={46} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="t-foot c-sec ellipsis">{owner ? "你建的学习计划" : `${preview.plan.teacher} 邀请你加入`}</span>
                <span className="plan-join__name">{preview.plan.name}</span>
              </span>
            </div>
            {members && (
              <div className="plan-join__members">
                {members.count > 0 && (
                  <span style={{ display: "flex", flexShrink: 0 }}>
                    {members.list.slice(0, 5).map((m, i) => (
                      <Avatar key={i} name={m.name} url={m.avatar} size={24} style={{ marginLeft: i ? -7 : 0, boxShadow: "0 0 0 2px var(--card)" }} />
                    ))}
                  </span>
                )}
                <span className="t-foot c-sec ellipsis" style={{ flex: 1 }}>{joinedText(members, owner)}</span>
              </div>
            )}
          </div>
          <span className="plan-join__label">作业 {list.length}</span>
          {list.length === 0 && (
            <div className="group">
              <div className="hw-empty">
                <Icon name="document" size={34} stroke={1.6} style={{ color: "var(--tertiary)" }} />
                <b>{owner ? "还没有布置作业" : "老师还没有布置作业"}</b>
                {owner ? "布置后同学点开卡片就能看到" : <>可以先加入<br />老师布置后会出现在计划里</>}
              </div>
            </div>
          )}
          {list.map((a, i) => {
            // 只有一份时始终展开；多份时卡片指向的那份展开，其余收成一行，点头部展开 / 收起
            const open = solo || (opened[a.id] ?? a.shared);
            const shown = open ? (full[a.id] ? a.files : a.files.slice(0, HW_PREVIEW)) : [];
            const rest = a.files.length - HW_PREVIEW;
            return (
              <div key={a.id} className="group hw">
                <div className="hw-head" style={solo ? { cursor: "default", background: "none" } : undefined} onClick={solo ? undefined : () => setOpened((o) => ({ ...o, [a.id]: !open }))}>
                  <span className="hw-no">{list.length - i}</span>
                  <span className="hw-main">
                    <span className="hw-title ellipsis">{a.title}</span>
                    <span className="hw-sub">
                      <span className="ellipsis" style={{ flex: 1 }}>{legacy ? hwMeta({ createdAt: a.createdAt }).split(" · ")[0] : hwMeta(a)}{a.dueAt ? ` · ${dueLabel(a.dueAt)}截止` : ""}</span>
                    </span>
                  </span>
                  {a.shared && !solo && <Tag kind="info">这次布置</Tag>}
                  {!solo && <Icon name={open ? "chevron-up" : "chevron-down"} size={16} stroke={2.4} style={{ color: "var(--tertiary)", flexShrink: 0 }} />}
                </div>
                {shown.map((f) => (
                  <button key={f.id} className="row hw-file" onClick={() => (owner ? enterOwn() : setAsking(true))}>
                    <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
                    <span className="row__main"><span className="hw-file__name ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
                    {!owner && <Icon name="lock" size={14} stroke={2} style={{ color: "var(--tertiary)" }} />}
                  </button>
                ))}
                {open && rest > 0 && (
                  <button className="hw-foot" onClick={() => setFull((m) => ({ ...m, [a.id]: !m[a.id] }))}>
                    {full[a.id] ? "收起" : `其余 ${rest} 个文件`}<Icon name={full[a.id] ? "chevron-up" : "chevron-down"} size={13} stroke={2.4} />
                  </button>
                )}
              </div>
            );
          })}
          <div className="bottom-bar plan-join__bar">
            {owner ? <Button onClick={() => enterOwn()}>进入学习计划</Button> : <Button onClick={() => setAsking(true)}>加入学习计划</Button>}
            <span className="plan-join__tip">
              {!owner && list.length > 0 && <Icon name="lock" size={11} stroke={2.2} />}
              {owner ? "这是同学点开卡片后看到的样子" : list.length ? "加入后可以打开文件、扫描交作业" : "不用老师批准，加入后老师布置的作业会出现在计划里"}
            </span>
          </div>
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
