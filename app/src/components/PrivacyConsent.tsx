import { useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { Button } from "./ui";
import { CONSENT_VERSION, LegalBody, PRIVACY_SECTIONS, TERMS_SECTIONS } from "../lib/legal";
import { isAndroid } from "../lib/native";

const KEY = "zcb.privacyConsent";

/** 是否已同意当前版本的隐私政策 */
export async function hasConsented(): Promise<boolean> {
  try {
    return (await Preferences.get({ key: KEY })).value === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/**
 * 首次启动的隐私政策弹窗（应用商店审核要求）：同意之前不联网、不申请任何权限。
 * 「不同意」先给一次说明，再不同意就退出（iOS 不允许主动退出，只停在说明页）。
 */
export function PrivacyConsent({ onAgree }: { onAgree: () => void }) {
  const [step, setStep] = useState<"ask" | "declined">("ask");
  const [reading, setReading] = useState<"privacy" | "terms" | null>(null);

  const agree = async () => {
    try { await Preferences.set({ key: KEY, value: CONSENT_VERSION }); } catch { /* 存不下也放行，下次再问 */ }
    onAgree();
  };
  const quit = async () => {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
  };

  if (reading) {
    return (
      <div className="consent consent--full" role="dialog" aria-modal="true" aria-label={reading === "privacy" ? "隐私政策" : "用户协议"}>
        <div className="consent__read">
          <h2 className="t-title3">{reading === "privacy" ? "隐私政策" : "用户协议"}</h2>
          <LegalBody sections={reading === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS} />
        </div>
        <div className="consent__actions">
          <Button onClick={() => setReading(null)}>返回</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="consent" role="dialog" aria-modal="true" aria-label="用户协议与隐私政策">
      <div className="consent__card">
        {step === "ask" ? (
          <>
            <h2 className="t-title3">用户协议与隐私政策</h2>
            <p className="t-sub c-sec">
              欢迎使用知错本。使用前请仔细阅读
              <button className="consent__link" onClick={() => setReading("terms")}>《用户协议》</button>和
              <button className="consent__link" onClick={() => setReading("privacy")}>《隐私政策》</button>。
            </p>
            <p className="t-sub c-sec">
              我们只收集登录需要的手机号和学习设置；试卷照片和错题只保存在你的设备上，扫描时照片会发到服务器识别，服务器不保存。相机、相册权限会在你拍照、选图时再申请。
            </p>
            <p className="t-sub c-sec">未满 14 周岁的同学请在家长陪同下阅读并由家长同意。</p>
            <Button onClick={agree}>同意并继续</Button>
            <Button variant="plain" onClick={() => setStep("declined")}>不同意</Button>
          </>
        ) : (
          <>
            <h2 className="t-title3">需要你的同意才能继续</h2>
            <p className="t-sub c-sec">知错本需要联网识别试卷，不同意《用户协议》和《隐私政策》就无法使用。你可以再看看，或者{isAndroid ? "退出应用" : "稍后再来"}。</p>
            <Button onClick={() => setStep("ask")}>再看看</Button>
            {isAndroid && <Button variant="plain" onClick={quit}>不同意并退出</Button>}
          </>
        )}
      </div>
    </div>
  );
}
