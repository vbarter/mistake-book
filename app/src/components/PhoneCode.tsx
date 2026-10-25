import { useEffect, useState } from "react";
import { api } from "../api/client";
import { toast, toastError } from "../store/banner";

export type CodePurpose = "register" | "login" | "bind";

/** 手机号 + 验证码：验证码输入框右边是「获取验证码」，发送后 60 秒倒计时。
 *  purpose 告诉服务端用途，注册时号码已注册、登录时号码没注册会直接提示，不白发短信。
 *  onError 把服务端的错误交给页面（比如「还没注册」时页面显示去注册的入口）。 */
export function PhoneCode({ purpose, phone, setPhone, code, setCode, onError }: { purpose: CodePurpose; phone: string; setPhone: (v: string) => void; code: string; setCode: (v: string) => void; onError?: (status: number, message: string) => boolean }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setSending(true);
    try {
      const res = await api<{ ok: boolean; devCode?: string }>("/api/auth/code", { method: "POST", auth: false, body: { phone, purpose } });
      setSent(true);
      setWait(60);
      setDevCode(res.devCode ?? null);
      toast("验证码已发送");
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (!onError?.(err.status ?? 0, err.message ?? "")) toastError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pc">
      <label className="pc__field">
        <span className="pc__prefix">+86</span>
        <input className="pc__input" inputMode="numeric" autoComplete="tel" placeholder="请输入手机号" value={phone} maxLength={11} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} aria-label="手机号" />
      </label>
      <div className="pc__row">
        <input className="pc__input pc__field" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="验证码" />
        <button type="button" className="pc__send" onClick={send} disabled={sending || wait > 0 || phone.length !== 11}>
          {sending ? "发送中…" : wait > 0 ? `${wait} 秒` : sent ? "重新获取" : "获取验证码"}
        </button>
      </div>
      {/* 只在本地开发时显示，正式包里永远不出现 */}
      {import.meta.env.DEV && devCode && <span className="t-foot c-sec">开发环境验证码：{devCode}</span>}
    </div>
  );
}
