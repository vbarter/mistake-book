import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase, setApiBase } from "../api/client";
import type { Subject } from "../api/types";
import { Button, InlineNav, Row, Sheet } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { GRADE_GROUPS, GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { getCity, setCity } from "../lib/prefs";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { isNative } from "../lib/native";

/* ---------- 年级、城市与学科 ---------- */
export function Subjects() {
  const { user, updateProfile } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>(user?.subjects ?? SUBJECTS);
  const [grade, setGrade] = useState(user?.grade ?? "5");
  const [city, setCityDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    getCity().then(setCityDraft);
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await updateProfile({ subjects, grade });
      await setCity(city);
      toast("已保存", "success");
      nav(-1);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <InlineNav title="年级、城市与学科" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 14 }}>
        <div className="card" style={{ gap: 10 }}>
          <span className="t-headline">年级</span>
          {GRADE_GROUPS.map((g) => (
            <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="t-cap c-sec">{g.label}</span>
              <div className="seg" role="radiogroup" aria-label={g.label}>
                {g.grades.map((k) => (
                  <button key={k} role="radio" aria-checked={grade === k} className={`seg__item${grade === k ? " on" : ""}`} onClick={() => setGrade(k)}>{GRADE_LABEL[k].replace("年级", "")}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">所在城市</span>
          <input className="input" value={city} maxLength={20} placeholder="例如：上海" onChange={(e) => setCityDraft(e.target.value)} />
          <span className="t-foot c-sec">错题会按这个城市的考纲归类知识点；试卷上能看出地区的以试卷为准。</span>
        </div>
        <div className="group">
          <div className="group__header"><span>学科</span><span style={{ fontWeight: 500 }}>至少保留一科</span></div>
          {SUBJECTS.map((s) => {
            const on = subjects.includes(s);
            return (
              <label key={s} className="row" style={{ minHeight: 52 }}>
                <SubjectTile subject={s} size="sm" />
                <span className="row__main"><span className="row__title">{SUBJECT_LABEL[s]}</span></span>
                <input type="checkbox" checked={on} style={{ width: 24, height: 24 }} onChange={() => setSubjects((cur) => (on ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]))} />
              </label>
            );
          })}
        </div>
        <div style={{ marginTop: "auto" }}><Button onClick={save} disabled={busy}>保存</Button></div>
      </div>
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
