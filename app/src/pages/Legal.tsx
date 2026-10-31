import { InlineNav } from "../components/ui";
import { LegalBody, PRIVACY_SECTIONS, TERMS_SECTIONS } from "../lib/legal";

/** 隐私政策 / 用户协议全文（不需要登录也能看） */
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <div className="screen">
      <InlineNav title={kind === "privacy" ? "隐私政策" : "用户协议"} back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <LegalBody sections={kind === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS} />
      </div>
    </div>
  );
}
