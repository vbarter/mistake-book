import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase, setApiBase } from "../api/client";
import type { Subject } from "../api/types";
import { Button, InlineNav, Row, Sheet } from "../components/ui";
import { SubjectTile, Tag } from "../components/v2";
import { GRADE_GROUPS, GRADE_LABEL, SUBJECTS, SUBJECT_GROUPS, SUBJECT_LABEL } from "../lib/format";
import { getCity, setCity } from "../lib/prefs";
import { clearAllFolders, listFolders } from "../lib/folders";
import { api } from "../api/client";
import type { User } from "../api/types";
import { PasswordInput, passwordProblem } from "../components/PasswordInput";
import { PhoneCode } from "../components/PhoneCode";
import { AppleLogo } from "../components/AppleLogo";
import { Icon } from "../components/Icon";
import "../styles/auth.css";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { isNative, isAndroid } from "../lib/native";

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
        {SUBJECT_GROUPS.map((g) => (
          <div className="group" key={g.label}>
            <div className="group__header"><span>学科 · {g.label}</span>{g.label === "基础" && <span style={{ fontWeight: 500 }}>至少保留一科</span>}</div>
            {g.subjects.map((s) => {
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
        ))}
        <p className="t-foot c-sec">这里勾选的学科只影响错题库的排序，扫描时会自动识别卷子是哪一科。</p>
        <div style={{ marginTop: "auto" }}><Button onClick={save} disabled={busy}>保存</Button></div>
      </div>
    </div>
  );
}

/* ---------- 账号与登录 ---------- */
const maskPhone = (p: string, sep = "") => `${p.slice(0, 3)}${sep}****${sep}${p.slice(-4)}`;

export function Account() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      await api("/api/auth/me", { method: "DELETE" });
      await logout();
      toast("账号已注销", "success");
      nav("/welcome", { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setDeleteBusy(false);
    }
  };
  const [server, setServer] = useState(getApiBase());
  const [serverSheet, setServerSheet] = useState(false);
  const [pwSheet, setPwSheet] = useState(false);
  const [pwCode, setPwCode] = useState("");
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const pwProblem = pw ? passwordProblem(pw) : null;
  const savePassword = async () => {
    setPwBusy(true);
    try {
      await api<{ user: User }>("/api/auth/password", { method: "POST", body: { password: pw, code: pwCode } });
      await useAuth.getState().refreshUser();
      setPwSheet(false);
      setPw("");
      setPwCode("");
      toast("登录密码已设置，下次可以用手机号 + 密码登录", "success");
    } catch (e) {
      toastError(e);
    } finally {
      setPwBusy(false);
    }
  };
  return (
    <div className="screen">
      <InlineNav title="账号与登录" back />
      <div className="screen__content screen__content--modal acct">
        <div className="card acct__hero">
          <span className="acct__avatar" aria-hidden="true">{user?.nickname.slice(-1)}</span>
          <span className="acct__id num">{user?.phone ? maskPhone(user.phone, " ") : user?.loginMethod === "apple" ? "Apple 账号" : "游客"}</span>
          {user?.loginMethod === "guest"
            ? <Tag kind="neutral" icon="info">仅保存在本机</Tag>
            : <Tag kind="correct" icon="checkcircle">{user?.loginMethod === "apple" ? "已用 Apple 注册" : "已用手机号注册"}</Tag>}
        </div>

        <section className="acct__section">
          <h2 className="acct__label">登录方式</h2>
          <div className="group">
            {user?.phone && (
              <div className="row acct__row">
                <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="bubble" size={18} stroke={2} /></span>
                <span className="row__main"><span className="row__title">验证码登录</span><span className="row__sub">手机号收短信验证码</span></span>
                <Tag kind="correct" icon="check">可用</Tag>
              </div>
            )}
            {user?.phone && (
              <button className="row acct__row" onClick={() => setPwSheet(true)}>
                <span className="row__icon" style={{ background: "var(--accent-on)" }}><Icon name="lock" size={18} stroke={2} /></span>
                <span className="row__main"><span className="row__title">密码登录</span><span className="row__sub">{user.hasPassword ? "手机号 + 密码" : "设置密码后可用"}</span></span>
                {user.hasPassword ? <Tag kind="info" icon="pencil">修改</Tag> : <Tag kind="info" icon="plus">去设置</Tag>}
              </button>
            )}
            {user?.loginMethod === "apple" && (
              <div className="row acct__row">
                <span className="row__icon" style={{ background: "var(--label)", color: "var(--card)" }}><AppleLogo size={18} /></span>
                <span className="row__main"><span className="row__title">Apple 登录</span><span className="row__sub">用这台设备的 Apple 账号</span></span>
                <Tag kind="correct" icon="check">可用</Tag>
              </div>
            )}
            {user?.loginMethod === "guest" && (
              <button className="row acct__row" onClick={() => nav("/login")}>
                <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="lock" size={18} stroke={2} /></span>
                <span className="row__main"><span className="row__title">{isAndroid ? "绑定手机号" : "绑定手机号或 Apple"}</span><span className="row__sub">绑定后换手机也能登录</span></span>
                <Tag kind="info" icon="plus">去绑定</Tag>
              </button>
            )}
          </div>
          <p className="acct__foot">登录后会一直保持，直到你在这里退出。</p>
        </section>

        {isNative && import.meta.env.DEV && (
          <section className="acct__section">
            <h2 className="acct__label">开发</h2>
            <div className="group">
              <Row icon="info" iconColor="var(--secondary)" title="服务器地址" value={server.replace(/^https?:\/\//, "")} onClick={() => setServerSheet(true)} />
            </div>
          </section>
        )}

        <section className="acct__section acct__section--end">
          <button className="acct__logout" onClick={() => setConfirm(true)}>退出登录</button>
          <p className="acct__foot acct__foot--center">{user?.loginMethod === "guest" ? "游客账号退出后本机数据无法再访问，建议先绑定。" : "退出后本机的试卷照片不会删除。"}</p>
          <button className="acct__delete" onClick={() => setDeleting(true)}>注销账号</button>
        </section>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="退出登录？">
        <Button variant="danger" onClick={async () => { await logout(); nav("/welcome", { replace: true }); }}>退出</Button>
        <Button variant="plain" onClick={() => setConfirm(false)}>取消</Button>
      </Sheet>
      <Sheet open={deleting} onClose={() => setDeleting(false)} title="注销账号？">
        <p className="t-sub c-sec">账号会被永久删除，服务器上和这个账号有关的记录也会一起删除，无法恢复。之后可以用同一个{user?.loginMethod === "apple" ? " Apple 账号" : user?.loginMethod === "wechat" ? "微信" : "手机号"}重新注册。</p>
        <p className="t-sub c-sec">这台设备上的试卷照片和电子版不会被删除，可以在「我的 → 隐私与权限」里清空。</p>
        <Button variant="danger" onClick={deleteAccount} disabled={deleteBusy}>{deleteBusy ? "正在注销…" : "确认注销"}</Button>
        <Button variant="plain" onClick={() => setDeleting(false)}>取消</Button>
      </Sheet>
      <Sheet open={pwSheet} onClose={() => setPwSheet(false)} title={user?.hasPassword ? "修改登录密码" : "设置登录密码"}>
        <p className="t-sub c-sec">验证码会发到 {user?.phone ? maskPhone(user.phone) : "绑定的手机号"}，设置后可以用密码登录。</p>
        <PhoneCode purpose="reset" fixedPhone phone={user?.phone ?? ""} setPhone={() => {}} code={pwCode} setCode={setPwCode} />
        <PasswordInput value={pw} onChange={setPw} placeholder="新密码，6 位以上含字母数字" autoComplete="new-password" />
        {pwProblem && <span className="auth__hint" style={{ color: "var(--wrong)" }}>{pwProblem}</span>}
        <Button onClick={savePassword} disabled={pwBusy || pwCode.length !== 6 || !pw || Boolean(pwProblem)}>{pwBusy ? "保存中…" : "保存"}</Button>
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
  const nav = useNavigate();
  const [counts, setCounts] = useState<{ folders: number; papers: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listFolders()
      .then((fs) => setCounts({ folders: fs.length, papers: fs.reduce((n, f) => n + f.papers.length, 0) }))
      .catch(() => setCounts({ folders: 0, papers: 0 }));
  }, []);

  const clearAll = async () => {
    setBusy(true);
    try {
      await clearAllFolders();
      setConfirm(false);
      toast("已清空", "success");
      nav("/home", { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav title="隐私与数据" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">我们收集什么</span>
          <p className="t-sub c-sec">账号只保存昵称、年级、学科设置和登录方式。试卷照片、电子版和错题只保存在这台设备上，不会上传备份。不收集姓名、学校、班级、位置。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">扫描时如何处理照片</span>
          <p className="t-sub c-sec">扫描时把试卷照片发到我们的服务器识别和批改，并要求 AI 忽略姓名、学校、班级等信息。服务器不保存照片；识别结果保留一天，方便切走 App 后取回，之后自动删除。导出的错题本 / 电子试卷 PDF 在服务器上保留 7 天，方便在「我的导出」里再次下载，可以随时删除，到期自动删除。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">第三方 SDK</span>
          <p className="t-sub c-sec">不接入任何广告或分析 SDK。</p>
        </div>
        <div className="card" style={{ gap: 8 }}>
          <span className="t-headline">你的权利</span>
          <p className="t-sub c-sec">随时可以在下面清空知错本保存在这台设备上的全部试卷和错题。清空后不能恢复，账号和学习设置不受影响。</p>
        </div>
        <div className="group">
          <Row icon="info" iconColor="var(--secondary)" title="隐私政策" onClick={() => nav("/legal/privacy")} />
          <Row icon="info" iconColor="var(--secondary)" title="用户协议" onClick={() => nav("/legal/terms")} />
        </div>
        <div className="group">
          <Row icon="trash" iconColor="var(--secondary)" title="清空本应用数据" value={counts ? `${counts.papers} 张试卷` : undefined} onClick={() => setConfirm(true)} />
        </div>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="清空本应用数据？">
        <p className="t-sub c-sec">会删掉知错本在这台设备上保存的 {counts?.folders ?? 0} 个文件夹、{counts?.papers ?? 0} 张试卷，以及它们的照片、电子版和错题，不能恢复。账号和学习设置不受影响。</p>
        <Button variant="danger" onClick={clearAll} disabled={busy}>{busy ? "正在清空…" : "清空"}</Button>
        <Button variant="plain" onClick={() => setConfirm(false)}>取消</Button>
      </Sheet>
    </div>
  );
}
