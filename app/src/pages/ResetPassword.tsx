import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { PasswordInput, passwordProblem } from "../components/PasswordInput";
import { PhoneCode } from "../components/PhoneCode";
import { Button, InlineNav } from "../components/ui";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import "../styles/auth.css";

/** 忘记密码：手机号 + 验证码 + 新密码，重设后直接登录 */
export default function ResetPassword() {
  const nav = useNavigate();
  const loc = useLocation();
  const setSession = useAuth((s) => s.setSession);
  const [phone, setPhone] = useState((((loc.state as { phone?: string } | null)?.phone) ?? "").slice(0, 11));
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = password ? passwordProblem(password) : null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/password/reset", { method: "POST", auth: false, body: { phone, code, password } });
      await setSession(res.token, res.user);
      toast("密码已重设", "success");
      nav("/papers", { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--card screen--narrow">
      <InlineNav title="" back />
      <div className="screen__content screen__content--modal auth" style={{ paddingTop: 0 }}>
        <div className="auth__head">
          <h1 className="t-title1">重设密码</h1>
          <p className="t-sub c-sec">用注册时的手机号收验证码，设置新密码后直接登录。</p>
        </div>
        <section className="auth__section">
          <span className="auth__label">手机号</span>
          <PhoneCode purpose="reset" phone={phone} setPhone={setPhone} code={code} setCode={setCode} />
        </section>
        <section className="auth__section">
          <span className="auth__label">新密码</span>
          <PasswordInput value={password} onChange={setPassword} placeholder="新密码，6 位以上含字母数字" autoComplete="new-password" />
          {problem && <span className="auth__hint" style={{ color: "var(--wrong)" }}>{problem}</span>}
        </section>
        <Button onClick={submit} disabled={busy || phone.length !== 11 || code.length !== 6 || !password || Boolean(problem)}>{busy ? "请稍候…" : "重设并登录"}</Button>
      </div>
    </div>
  );
}
