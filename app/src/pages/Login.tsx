import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { Button, InlineNav } from "../components/ui";
import { isNative } from "../lib/native";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { token, setSession, refreshUser } = useAuth();
  const binding = Boolean(token); // 已是游客账号 → 绑定而不是新登录
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = () => nav((loc.state as { from?: string } | null)?.from || "/today", { replace: true });

  const sendCode = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; devCode?: string }>("/api/auth/code", { method: "POST", auth: false, body: { phone } });
      setSent(true);
      setDevCode(res.devCode ?? null);
      toast("验证码已发送");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    try {
      if (binding) {
        await api("/api/auth/bind", { method: "POST", body: { phone, code } });
        await refreshUser();
        toast("已绑定手机号", "success");
        nav(-1);
      } else {
        const res = await api<{ token: string; user: User }>("/api/auth/login", { method: "POST", auth: false, body: { phone, code } });
        await setSession(res.token, res.user);
        done();
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const apple = async () => {
    if (!isNative) {
      toast("通过 Apple 登录需要在 iPhone 上使用");
      return;
    }
    // 原生 Apple 登录插件需在 Xcode 中开启 Sign in with Apple 能力后接入（见 README），
    // 接入后在此调用插件拿到 identityToken，再走 appleLogin()。
    toast("Apple 登录即将开放，请先用手机号登录");
  };

  // 预留：拿到 identityToken 后的服务端交换
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const appleLogin = async (identityToken: string, nickname?: string) => {
    if (binding) {
      await api("/api/auth/bind", { method: "POST", body: { identityToken } });
      await refreshUser();
      nav(-1);
    } else {
      const res = await api<{ token: string; user: User }>("/api/auth/apple", { method: "POST", auth: false, body: { identityToken, profile: { nickname } } });
      await setSession(res.token, res.user);
      done();
    }
  };

  return (
    <div className="screen screen--card">
      <InlineNav title={binding ? "绑定账号" : "登录"} back />
      <div className="screen__content screen__content--modal" style={{ gap: 20, paddingTop: 12 }}>
        <p className="t-sub c-sec">{binding ? "绑定后错题会备份到账号，换手机也不丢。" : "登录后可以同步错题、开启复习提醒。"}</p>
        <Button variant="black" onClick={apple} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.4c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" /></svg>
          通过 Apple 登录
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--tertiary)" }} className="t-foot">
          <span style={{ flex: 1, height: 1, background: "var(--separator-light)" }} />
          或用手机号
          <span style={{ flex: 1, height: 1, background: "var(--separator-light)" }} />
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="t-headline">手机号</span>
          <input className="input" inputMode="numeric" autoComplete="tel" placeholder="11 位手机号" value={phone} maxLength={11} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
        </label>
        {sent && (
          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="t-headline">验证码</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            {devCode && <span className="t-foot c-sec">开发环境验证码：{devCode}</span>}
          </label>
        )}
        {!sent ? (
          <Button onClick={sendCode} disabled={busy || phone.length !== 11}>获取验证码</Button>
        ) : (
          <Button onClick={login} disabled={busy || code.length !== 6}>{binding ? "绑定" : "登录"}</Button>
        )}
      </div>
    </div>
  );
}
