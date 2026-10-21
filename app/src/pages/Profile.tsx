import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Overview } from "../api/types";
import { Icon } from "../components/Icon";
import { Button, LargeNav, Row, Sheet } from "../components/ui";
import { GRADE_LABEL, SUBJECT_LABEL } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { ParentGate } from "./ProfilePages";

export default function Profile() {
  const nav = useNavigate();
  const { user, updateProfile } = useAuth();
  const { data } = useAsync(() => api<Overview>("/api/stats/overview"));
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.nickname ?? "");
  const [gate, setGate] = useState<null | (() => void)>(null);

  if (!user) return null;
  const topSubject = data?.subjects.length ? [...data.subjects].sort((a, b) => b.total - a.total)[0] : null;

  const saveName = async () => {
    try {
      await updateProfile({ nickname: name });
      setEditName(false);
      toast("已更新", "success");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="screen">
      <LargeNav title="我的" />
      <div className="screen__content" style={{ gap: 16, paddingTop: 6 }}>
        <div className="card" style={{ gap: 14 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left", width: "100%" }} onClick={() => { setName(user.nickname); setEditName(true); }}>
            <span style={{ width: 56, height: 56, borderRadius: 28, background: "var(--brand-tint)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, flexShrink: 0 }}>
              {user.nickname.slice(-1)}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <span className="t-title3 ellipsis">{user.nickname}</span>
              <span className="t-sub c-sec">{GRADE_LABEL[user.grade] ?? `${user.grade} 年级`}{data?.streakDays ? ` · 已连续学习 ${data.streakDays} 天` : ""}</span>
            </span>
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, textAlign: "center" }}>
            <button style={{ background: "var(--fill-light)", borderRadius: 10, padding: "10px 0", display: "flex", flexDirection: "column" }} onClick={() => nav("/library")}>
              <span className="num t-title2">{data?.total ?? "–"}</span><span className="t-foot c-sec">错题</span>
            </button>
            <button style={{ background: "var(--mastered-bg)", borderRadius: 10, padding: "10px 0", display: "flex", flexDirection: "column", color: "var(--mastered)" }} onClick={() => nav("/library")}>
              <span className="num t-title2">{data?.mastered ?? "–"}</span><span className="t-foot">已掌握</span>
            </button>
            <button style={{ background: "var(--due-bg)", borderRadius: 10, padding: "10px 0", display: "flex", flexDirection: "column", color: "var(--due)" }} onClick={() => nav("/today")}>
              <span className="num t-title2">{data?.due ?? "–"}</span><span className="t-foot">待复习</span>
            </button>
          </div>
        </div>

        <div>
          <div className="group__header" style={{ padding: "0 16px 6px" }}><span>学习</span></div>
          <div className="group">
            <Row icon="chart" iconColor="var(--brand)" title="学科分布" value={topSubject ? `${SUBJECT_LABEL[topSubject.subject]}最多` : "—"} onClick={() => nav("/profile/stats")} />
            <Row icon="target" iconColor="var(--mastered)" title="本周目标" value={`复习 ${user.weeklyGoal} 题 · ${data?.weekReviewed ?? 0}/${user.weeklyGoal}`} onClick={() => nav("/profile/goal")} />
            <Row icon="bell" iconColor="var(--due)" title="复习提醒" value={user.reviewReminder.enabled ? `每天 ${String(user.reviewReminder.hour).padStart(2, "0")}:${String(user.reviewReminder.minute).padStart(2, "0")}` : "关闭"} onClick={() => nav("/profile/reminder")} />
          </div>
        </div>

        <div>
          <div className="group__header" style={{ padding: "0 16px 6px" }}><span>设置</span></div>
          <div className="group">
            <Row icon="book" iconColor="#7a4dd8" title="学科与年级" value={`${user.subjects.length} 科 · ${GRADE_LABEL[user.grade] ?? ""}`} onClick={() => nav("/profile/subjects")} />
            <Row icon="family" iconColor="#0e8a8a" title="家长查看" value={<Icon name="lock" size={16} style={{ color: "var(--tertiary)" }} />} onClick={() => setGate(() => () => nav("/profile/parent"))} />
            <Row icon="export" iconColor="var(--secondary)" title="导出全部错题" onClick={() => setGate(() => () => toast("导出 PDF 将在下个版本提供"))} />
          </div>
        </div>

        <div>
          <div className="group__header" style={{ padding: "0 16px 6px" }}><span>账号</span></div>
          <div className="group">
            <Row icon="person" iconColor="var(--label)" title="账号与登录" value={user.loginMethod === "apple" ? "Apple" : user.loginMethod === "phone" ? "手机号" : "未登录"} onClick={() => nav("/profile/account")} />
            <Row icon="shield" iconColor="var(--brand)" title="隐私与数据" onClick={() => nav("/profile/privacy")} />
          </div>
        </div>
        <span className="t-foot c-sec" style={{ textAlign: "center" }}>知错本 1.0</span>
      </div>

      <Sheet open={editName} onClose={() => setEditName(false)} title="怎么称呼你">
        <input className="input" autoFocus value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        <Button onClick={saveName} disabled={!name.trim()}>保存</Button>
      </Sheet>
      <ParentGate open={Boolean(gate)} onClose={() => setGate(null)} onPass={() => { const fn = gate; setGate(null); fn?.(); }} />
    </div>
  );
}
