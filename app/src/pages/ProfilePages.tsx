import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiBase, setApiBase } from "../api/client";
import type { Overview, Subject } from "../api/types";
import { Button, InlineNav, Row, Sheet, SubjectChip } from "../components/ui";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { isNative } from "../lib/native";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";

/* ---------- 家长门：随机算术题 ---------- */
export function ParentGate({ open, onClose, onPass }: { open: boolean; onClose: () => void; onPass: () => void }) {
  const q = useMemo(() => {
    const a = 11 + Math.floor(Math.random() * 9);
    const b = 3 + Math.floor(Math.random() * 7);
    return { a, b, answer: a * b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [v, setV] = useState("");
  return (
    <Sheet open={open} onClose={() => { setV(""); onClose(); }} title="请家长完成验证">
      <p className="t-sub c-sec">这个区域由家长管理。请计算：</p>
      <p className="t-title1 num" style={{ textAlign: "center" }}>{q.a} × {q.b} = ?</p>
      <input className="input" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="输入结果" />
      <Button onClick={() => { if (Number(v) === q.answer) { setV(""); onPass(); } else { toast("结果不对，再试一次", "error"); setV(""); } }} disabled={!v}>确认</Button>
    </Sheet>
  );
}

/* ---------- 学科与年级 ---------- */
export function Subjects() {
  const { user, updateProfile } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>(user?.subjects ?? SUBJECTS);
  const [grade, setGrade] = useState(user?.grade ?? "5");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const save = async () => {
    setBusy(true);
    try {
      await updateProfile({ subjects, grade });
      toast("已保存", "success");
      nav(-1);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <InlineNav title="学科与年级" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 10 }}>
          <span className="t-headline">年级</span>
          <div className="seg" role="radiogroup">
            {Object.entries(GRADE_LABEL).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={grade === k} className={`seg__item${grade === k ? " on" : ""}`} onClick={() => setGrade(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="group">
          <div className="group__header"><span>开启的学科</span><span style={{ fontWeight: 500 }}>至少保留一科</span></div>
          {SUBJECTS.map((s) => {
            const on = subjects.includes(s);
            return (
              <label key={s} className="row" style={{ minHeight: 52 }}>
                <SubjectChip subject={s} />
                <span className="row__main"><span className="row__title">{SUBJECT_LABEL[s]}</span></span>
                <input type="checkbox" checked={on} style={{ width: 24, height: 24 }} onChange={() => setSubjects((cur) => (on ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]))} />
              </label>
            );
          })}
        </div>
        <p className="t-foot c-sec">关闭的学科不再出现在筛选和组卷里，已有错题会保留。</p>
        <div style={{ marginTop: "auto" }}><Button onClick={save} disabled={busy}>保存</Button></div>
      </div>
    </div>
  );
}

/* ---------- 学科分布 ---------- */
export function SubjectStats() {
  const nav = useNavigate();
  const { data } = useAsync(() => api<Overview>("/api/stats/overview"));
  const max = Math.max(1, ...(data?.subjects.map((s) => s.total) ?? [1]));
  return (
    <div className="screen">
      <InlineNav title="学科分布" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        {data && data.subjects.length === 0 && <p className="t-sub c-sec" style={{ textAlign: "center", padding: 32 }}>还没有错题</p>}
        {data?.subjects.map((s) => (
          <button key={s.subject} className="card" style={{ gap: 8, textAlign: "left" }} onClick={() => nav("/library")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <SubjectChip subject={s.subject} />
              <span className="t-sub c-sec num">{s.total} 题 · 掌握 {s.mastered} · 待复习 {s.due}</span>
            </div>
            <span className="bar" style={{ height: 10 }}>
              <span style={{ width: `${(s.mastered / max) * 100}%`, background: "var(--mastered)" }} />
              <span style={{ width: `${((s.total - s.mastered - s.due) / max) * 100}%`, background: "var(--brand)" }} />
              <span style={{ width: `${(s.due / max) * 100}%`, background: "var(--due)" }} />
            </span>
          </button>
        ))}
        {data && <p className="t-foot c-sec">绿色已掌握 · 蓝色巩固中 · 橙色待复习</p>}
      </div>
    </div>
  );
}

/* ---------- 本周目标 ---------- */
export function Goal() {
  const { user, updateProfile } = useAuth();
  const nav = useNavigate();
  const { data } = useAsync(() => api<Overview>("/api/stats/overview"));
  const [goal, setGoal] = useState<number>(user?.weeklyGoal ?? 5);
  const save = async () => {
    try { await updateProfile({ weeklyGoal: goal }); toast("已保存", "success"); nav(-1); } catch (e) { toastError(e); }
  };
  const done = data?.weekReviewed ?? 0;
  return (
    <div className="screen">
      <InlineNav title="本周目标" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 10 }}>
          <span className="t-headline">本周已复习 {done} / {goal} 题</span>
          <span className="bar" style={{ height: 8 }}><span style={{ width: `${Math.min(100, (done / goal) * 100)}%`, background: done >= goal ? "var(--mastered)" : "var(--brand)" }} /></span>
          <span className="t-foot c-sec">{done >= goal ? "本周目标已达成" : `再复习 ${goal - done} 题就能完成`}</span>
        </div>
        <div className="card" style={{ gap: 10 }}>
          <span className="t-headline">每周复习目标</span>
          <div className="seg" role="radiogroup">
            {[5, 10, 20].map((n) => (
              <button key={n} role="radio" aria-checked={goal === n} className={`seg__item${goal === n ? " on" : ""}`} onClick={() => setGoal(n)}>{n} 题</button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: "auto" }}><Button onClick={save}>保存</Button></div>
      </div>
    </div>
  );
}

/* ---------- 复习提醒 ---------- */
export function Reminder() {
  const { user, updateProfile } = useAuth();
  const nav = useNavigate();
  const [enabled, setEnabled] = useState(user?.reviewReminder.enabled ?? false);
  const [time, setTime] = useState(`${String(user?.reviewReminder.hour ?? 19).padStart(2, "0")}:${String(user?.reviewReminder.minute ?? 30).padStart(2, "0")}`);
  const save = async () => {
    const [h, m] = time.split(":").map(Number);
    try {
      await updateProfile({ reviewReminder: { enabled, hour: h, minute: m } });
      toast(enabled ? "提醒已开启（本地通知将在原生版本中推送）" : "提醒已关闭", "success");
      nav(-1);
    } catch (e) { toastError(e); }
  };
  return (
    <div className="screen">
      <InlineNav title="复习提醒" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="group">
          <label className="row" style={{ minHeight: 52 }}>
            <span className="row__main"><span className="row__title">每天提醒我复习</span><span className="row__sub">只在有待复习题时提醒</span></span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 24, height: 24 }} />
          </label>
          {enabled && (
            <label className="row" style={{ minHeight: 52 }}>
              <span className="row__main"><span className="row__title">提醒时间</span></span>
              <input type="time" className="input" style={{ width: 120, minHeight: 36, padding: "4px 8px" }} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
        </div>
        <p className="t-foot c-sec">复习按遗忘曲线安排：1 → 3 → 7 → 15 → 30 天。连续两次「记得」就算掌握。</p>
        <div style={{ marginTop: "auto" }}><Button onClick={save}>保存</Button></div>
      </div>
    </div>
  );
}

/* ---------- 家长查看 ---------- */
export function Parent() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { data } = useAsync(() => api<Overview>("/api/stats/overview"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api("/api/auth/me", { method: "DELETE" });
      await logout();
      nav("/welcome", { replace: true });
    } catch (e) { toastError(e); setBusy(false); }
  };
  const doneDays = data?.week.filter((d) => d.done).length ?? 0;
  return (
    <div className="screen">
      <InlineNav title="家长查看" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 6 }}>
          <span className="t-headline">{user?.nickname} 本周</span>
          <span className="t-sub c-sec">复习了 {doneDays} 天 · 共 {data?.weekReviewed ?? 0} 题 · 新增 {data?.weekNew ?? 0} 道错题 · 掌握率 {Math.round((data?.masteryRate ?? 0) * 100)}%</span>
        </div>
        <div className="group">
          <div className="group__header"><span>各科掌握率</span></div>
          {data?.subjects.map((s) => (
            <div key={s.subject} className="row">
              <SubjectChip subject={s.subject} />
              <span className="row__main"><span className="bar"><span style={{ width: `${(s.mastered / s.total) * 100}%`, background: "var(--mastered)" }} /></span></span>
              <span className="t-sub c-sec num">{Math.round((s.mastered / s.total) * 100)}%</span>
            </div>
          ))}
        </div>
        <div className="group">
          <Row icon="export" iconColor="var(--secondary)" title="导出错题 PDF" sub="含答案 / 不含答案（重练版）" onClick={() => toast("导出 PDF 将在下个版本提供")} />
          <Row icon="trash" iconColor="var(--wrong)" title="删除账号与全部数据" danger chevron={false} onClick={() => setConfirmDelete(true)} />
        </div>
      </div>
      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="删除账号？">
        <p className="t-sub c-sec">所有错题、截图和复习记录都会被永久删除，无法恢复。</p>
        <Button variant="danger" onClick={deleteAccount} disabled={busy}>永久删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(false)}>取消</Button>
      </Sheet>
    </div>
  );
}

/* ---------- 账号与登录 ---------- */
export function Account() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [server, setServer] = useState(getApiBase());
  const [serverSheet, setServerSheet] = useState(false);
  return (
    <div className="screen">
      <InlineNav title="账号与登录" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="group">
          <Row icon="person" iconColor="var(--label)" title="登录方式" chevron={false} value={user?.loginMethod === "apple" ? "Apple" : user?.loginMethod === "phone" ? `手机 ${user.phone?.slice(0, 3)}****${user.phone?.slice(-4)}` : "游客（仅本机）"} />
          {user?.loginMethod === "guest" && <Row icon="lock" iconColor="var(--brand)" title="绑定手机号或 Apple" sub="绑定后错题会备份到账号" onClick={() => nav("/login")} />}
        </div>
        {isNative && (
          <div className="group">
            <Row icon="info" iconColor="var(--secondary)" title="服务器地址" value={server.replace(/^https?:\/\//, "")} onClick={() => setServerSheet(true)} />
          </div>
        )}
        <div className="group">
          <Row icon="xmark" iconColor="var(--wrong)" title="退出登录" danger chevron={false} onClick={() => setConfirm(true)} />
        </div>
        {user?.loginMethod === "guest" && <p className="t-foot c-sec">游客账号退出后本机数据无法再访问，建议先绑定。</p>}
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="退出登录？">
        <Button variant="danger" onClick={async () => { await logout(); nav("/welcome", { replace: true }); }}>退出</Button>
        <Button variant="plain" onClick={() => setConfirm(false)}>取消</Button>
      </Sheet>
      <Sheet open={serverSheet} onClose={() => setServerSheet(false)} title="服务器地址">
        <input className="input" value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://192.168.1.10:5001" />
        <Button onClick={async () => { await setApiBase(server); setServerSheet(false); toast("已保存，重新打开 App 生效", "success"); }}>保存</Button>
      </Sheet>
    </div>
  );
}

/* ---------- 隐私与数据 ---------- */
export function Privacy() {
  return (
    <div className="screen">
      <InlineNav title="隐私与数据" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">我们收集什么</span>
          <p className="t-sub c-sec">只收集昵称、年级、学科设置、错题内容与复习记录。不收集姓名、学校、班级、位置。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">AI 识别如何处理图片</span>
          <p className="t-sub c-sec">只上传你框选的题目截图；自动分段会跳过卷头区域，并要求 AI 忽略姓名、学校等信息。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">第三方 SDK</span>
          <p className="t-sub c-sec">不接入任何广告或分析 SDK。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">你的权利</span>
          <p className="t-sub c-sec">可在「家长查看」中导出或永久删除全部数据。</p>
        </div>
      </div>
    </div>
  );
}
