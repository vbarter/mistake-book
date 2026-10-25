import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { Icon } from "../components/Icon";
import { PasswordInput } from "../components/PasswordInput";
import { PhoneCode } from "../components/PhoneCode";
import { Button, InlineNav } from "../components/ui";
import { AppleAuthError, appleIdentity } from "../lib/appleAuth";
import { isAndroid } from "../lib/native";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import "../styles/auth.css";

type Mode = "code" | "password";

/** 登录：验证码登录 / 密码登录两个页签（密码在「账号与登录」里设置），iPhone 上还可以用 Apple。没注册的号码提示去注册。
 *  已经是游客账号时这一页用来绑定手机号 / Apple。 */
export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { token, setSession, refreshUser } = useAuth();
  const binding = Boolean(token);
  const state = (loc.state as { from?: string; phone?: string } | null) ?? {};
  const [mode, setMode] = useState<Mode>("code");
  const [phone, setPhone] = useState((state.phone ?? "").slice(0, 11));
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [unregistered, setUnregistered] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = () => nav(state.from || "/papers", { replace: true });
  const goRegister = () => nav("/register", { replace: true, state: { phone } });
  const changePhone = (v: string) => {
    setPhone(v);
    setUnregistered(false);
  };
  const onCodeError = (status: number) => {
    if (status === 404 && !binding) {
      setUnregistered(true);
      return true;
    }
    return false;
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (binding) {
        await api("/api/auth/bind", { method: "POST", body: { phone, code } });
        await refreshUser();
        toast("已绑定手机号", "success");
        nav(-1);
        return;
      }
      const res =
        mode === "password"
          ? await api<{ token: string; user: User }>("/api/auth/login/password", { method: "POST", auth: false, body: { phone, password } })
          : await api<{ token: string; user: User }>("/api/auth/login", { method: "POST", auth: false, body: { phone, code } });
      await setSession(res.token, res.user);
      done();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err.status === 404 && !binding) setUnregistered(true);
      else if (mode === "password" && /还没设置密码/.test(err.message ?? "")) {
        toast("这个账号还没设置密码，请用验证码登录，登录后可以在「账号与登录」里设置密码", "info");
        setMode("code");
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const apple = async () => {
    setBusy(true);
    try {
      const id = await appleIdentity();
      if (!id) return;
      if (binding) {
        await api("/api/auth/bind", { method: "POST", body: { identityToken: id.identityToken } });
        await refreshUser();
        nav(-1);
      } else {
        const res = await api<{ token: string; user: User }>("/api/auth/apple", { method: "POST", auth: false, body: { identityToken: id.identityToken, profile: id.nickname ? { nickname: id.nickname } : {} } });
        await setSession(res.token, res.user);
        done();
      }
    } catch (e) {
      if (e instanceof AppleAuthError) toast(e.message, "error");
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const usePassword = mode === "password" && !binding;
  const ready = phone.length === 11 && (usePassword ? password.length >= 6 : code.length === 6);

  return (
    <div className="screen screen--card screen--narrow">
      <InlineNav title="" back />
      <div className="screen__content screen__content--modal auth" style={{ paddingTop: 0 }}>
        <div className="auth__head">
          <h1 className="t-title1">{binding ? "绑定账号" : "登录"}</h1>
          <p className="t-sub c-sec">{binding ? "绑定后换手机也能用同一个账号登录。" : "登录后会一直保持，直到你在「账号与登录」里退出。"}</p>
        </div>

        {!binding && (
          <div className="auth__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "code"} className={`auth__tab${mode === "code" ? " on" : ""}`} onClick={() => setMode("code")}>验证码登录</button>
            <button type="button" role="tab" aria-selected={mode === "password"} className={`auth__tab${mode === "password" ? " on" : ""}`} onClick={() => setMode("password")}>密码登录</button>
          </div>
        )}

        <section className="auth__section">
          {usePassword ? (
            <>
              <label className="pc__field">
                <span className="pc__prefix">+86</span>
                <input className="pc__input" inputMode="numeric" autoComplete="tel" placeholder="请输入手机号" value={phone} maxLength={11} onChange={(e) => changePhone(e.target.value.replace(/\D/g, ""))} aria-label="手机号" />
              </label>
              <PasswordInput value={password} onChange={setPassword} />
              <button type="button" className="auth__forgot" onClick={() => nav("/reset-password", { state: { phone } })}>忘记密码？</button>
            </>
          ) : (
            <PhoneCode purpose={binding ? "bind" : "login"} phone={phone} setPhone={changePhone} code={code} setCode={setCode} onError={onCodeError} />
          )}
          {unregistered && (
            <div className="auth__notice">
              <Icon name="info" size={18} stroke={2.2} />
              <span>这个手机号还没注册</span>
              <button type="button" onClick={goRegister}>去注册</button>
            </div>
          )}
        </section>

        <Button onClick={submit} disabled={busy || !ready}>{busy ? "请稍候…" : binding ? "绑定" : "登录"}</Button>

        {!isAndroid && (
          <>
            <div className="auth__divider">或</div>
            <Button variant="black" onClick={apple} disabled={busy}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.4c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" /></svg>
              {binding ? "绑定 Apple 账号" : "通过 Apple 登录"}
            </Button>
          </>
        )}

        {!binding && (
          <p className="auth__switch" style={{ marginTop: "auto" }}>
            还没有账号？<button type="button" onClick={goRegister}>注册</button>
          </p>
        )}
      </div>
    </div>
  );
}
