import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { Icon } from "../components/Icon";
import { PhoneCode } from "../components/PhoneCode";
import { Button, InlineNav } from "../components/ui";
import { AppleAuthError, appleIdentity } from "../lib/appleAuth";
import { AppleLogo } from "../components/AppleLogo";
import { isAndroid } from "../lib/native";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import "../styles/auth.css";

/** 注册：手机号 + 验证码（iPhone 上也可以用 Apple）。称呼、年级、学科之后在「我的」里设置；
 *  登录密码可以在「账号与登录」里另设。 */
export default function Register() {
  const nav = useNavigate();
  const loc = useLocation();
  const setSession = useAuth((s) => s.setSession);
  const [phone, setPhone] = useState(((loc.state as { phone?: string } | null)?.phone ?? "").slice(0, 11));
  const [code, setCode] = useState("");
  const [agree, setAgree] = useState(false);
  const [registered, setRegistered] = useState(false); // 号码已注册：提示去登录
  const [busy, setBusy] = useState(false);

  const goLogin = () => nav("/login", { replace: true, state: { phone } });

  const onCodeError = (status: number) => {
    if (status === 409) {
      setRegistered(true);
      return true;
    }
    return false;
  };

  const submit = async () => {
    if (!agree) return toast("请先阅读并同意用户协议和隐私政策");
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/register", { method: "POST", auth: false, body: { phone, code } });
      await setSession(res.token, res.user);
      toast("注册成功，下次用这个手机号登录", "success");
      nav("/home", { replace: true });
    } catch (e) {
      if ((e as { status?: number }).status === 409) setRegistered(true);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const apple = async () => {
    if (!agree) return toast("请先阅读并同意用户协议和隐私政策");
    setBusy(true);
    try {
      const id = await appleIdentity();
      if (!id) return;
      const res = await api<{ token: string; user: User }>("/api/auth/apple", { method: "POST", auth: false, body: { identityToken: id.identityToken, profile: id.nickname ? { nickname: id.nickname } : {} } });
      await setSession(res.token, res.user);
      nav("/home", { replace: true });
    } catch (e) {
      if (e instanceof AppleAuthError) toast(e.message, "error");
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = phone.length === 11 && code.length === 6 && agree;

  return (
    <div className="screen screen--card screen--narrow">
      <InlineNav title="" back />
      <div className="screen__content screen__content--modal auth" style={{ paddingTop: 0 }}>
        <div className="auth__head">
          <h1 className="t-title1">注册知错本</h1>
          <p className="t-sub c-sec">{isAndroid ? "用手机号和验证码注册。" : "用手机号和验证码，或 Apple 账号注册。"}</p>
        </div>

        <section className="auth__section">
          <span className="auth__label">手机号</span>
          <PhoneCode purpose="register" phone={phone} setPhone={(v) => { setPhone(v); setRegistered(false); }} code={code} setCode={setCode} onError={onCodeError} />
          {registered && (
            <div className="auth__notice">
              <Icon name="info" size={18} stroke={2.2} />
              <span>这个手机号已经注册过了</span>
              <button type="button" onClick={goLogin}>去登录</button>
            </div>
          )}
        </section>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <button type="button" className="agree" onClick={() => setAgree((v) => !v)} aria-pressed={agree}>
            <Icon name={agree ? "checkcircle" : "target"} size={20} stroke={agree ? 2.2 : 1.6} style={{ color: agree ? "var(--brand)" : "var(--tertiary)", flexShrink: 0 }} />
            <span>
              我已阅读并同意
              <b role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); nav("/legal/terms"); }}>《用户协议》</b>和
              <b role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); nav("/legal/privacy"); }}>《隐私政策》</b>，试卷照片和错题只保存在这台设备上。
            </span>
          </button>
          <Button onClick={submit} disabled={busy || !ready}>{busy ? "注册中…" : "注册"}</Button>
          {!isAndroid && (
            <>
              <div className="auth__divider">或</div>
              <Button variant="black" onClick={apple} disabled={busy}>
                <AppleLogo />
                通过 Apple 注册
              </Button>
            </>
          )}
          <p className="auth__switch">
            已有账号？<button type="button" onClick={goLogin}>去登录</button>
          </p>
        </div>
      </div>
    </div>
  );
}
