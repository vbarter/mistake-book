import { useState } from "react";
import { Icon } from "./Icon";

/** 密码输入框：右边一个小眼睛切换显示 / 隐藏 */
export function PasswordInput({ value, onChange, placeholder = "请输入密码", autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="pc__field">
      <input className="pc__input" type={show ? "text" : "password"} autoComplete={autoComplete} placeholder={placeholder} value={value} maxLength={32} onChange={(e) => onChange(e.target.value)} aria-label="密码" />
      <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏密码" : "显示密码"}>
        <Icon name={show ? "eye-off" : "eye"} size={18} stroke={2} />
      </button>
    </label>
  );
}

/** 和服务端同一条规则：6–32 位，同时有字母和数字 */
export function passwordProblem(p: string): string | null {
  if (p.length < 6 || p.length > 32) return "密码要 6–32 位";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "密码要同时包含字母和数字";
  return null;
}
