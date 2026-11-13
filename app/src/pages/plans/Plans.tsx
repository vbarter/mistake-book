import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, Spinner } from "../../components/ui";
import { Avatar, Tag } from "../../components/v2";
import { MARK_REVIEWED, teacherLine, byNewest, createdLabel, fetchPlans, usePlans, type PlanInfo } from "../../lib/plans";
import { toastError } from "../../store/banner";
import { Count } from "./shared";

/** 学习计划列表：我创建的、我加入的。加入只能靠点微信里的卡片，这里只有「新建」一个入口。 */
export default function Plans() {
  const nav = useNavigate();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const version = usePlans((s) => s.version);
  useEffect(() => {
    fetchPlans().then((r) => setPlans(r.plans)).catch((e) => { toastError(e); setPlans((p) => p ?? []); });
  }, [version]);

  // 每个分类里最新创建的排最上面
  const owned = byNewest(plans?.filter((p) => p.role === "owner") ?? []);
  const joined = byNewest(plans?.filter((p) => p.role === "member") ?? []);

  const card = (p: PlanInfo) => (
    <button key={p.id} className="card card--row press" onClick={() => nav(`/plans/${p.id}`)}>
      {/* 左边是创建人的头像（我创建的就是自己的），第二行是创建人的名字和学科 */}
      <Avatar name={p.teacher} url={p.teacherAvatar} size={52} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="t-headline ellipsis">{p.name}</span>
        <span className="plan-counts" style={{ gap: 10 }}>
          <span className="t-foot c-sec ellipsis">{teacherLine(p.teacher, p.subject)}</span>
          {p.role === "owner" && <Count icon="family" color="var(--tertiary)">{p.members ?? 0}</Count>}
          <Count icon="document" color="var(--tertiary)">{p.assignments ?? 0}</Count>
        </span>
        {createdLabel(p.createdAt) && <span className="t-cap" style={{ color: "var(--tertiary)" }}>{createdLabel(p.createdAt)}</span>}
      </span>
      {MARK_REVIEWED && p.role === "owner" && (p.toReview ?? 0) > 0 && <Tag kind="info" icon="pencil">{p.toReview}</Tag>}
      {p.role === "member" && (p.todo ?? 0) > 0 && <Tag kind="pending" icon="clock">{p.todo}</Tag>}
      <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
    </button>
  );

  return (
    <div className="screen">
      <InlineNav title="学习计划" back onBack={() => nav("/home")} />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 10 }}>
        {!plans && <Spinner />}
        {plans && plans.length === 0 && (
          <div className="empty">
            <Icon name="graduation" size={44} className="empty__icon" />
            <span className="empty__title">还没有学习计划</span>
            <span className="t-sub">新建一个，或点开老师发的卡片加入</span>
          </div>
        )}
        {owned.length > 0 && <div className="plan-field__label" style={{ paddingTop: 4 }}><span>我创建的</span></div>}
        {owned.map(card)}
        {joined.length > 0 && <div className="plan-field__label" style={{ paddingTop: 8 }}><span>我加入的</span></div>}
        {joined.map(card)}
        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          <Button icon="plus" onClick={() => nav("/plans/new")}>新建学习计划</Button>
        </div>
      </div>
    </div>
  );
}
