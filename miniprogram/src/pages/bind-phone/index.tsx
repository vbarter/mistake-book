import { useEffect, useState } from "react";
import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { ApiError, errorText } from "../../lib/api";
import { bindPhone, sendBindCode } from "../../lib/auth";
import { syncNow } from "../../lib/sync";
import "./index.scss";

const MERGE_TEXT = "这个手机号已经有账号了（比如在上壹课 App 里注册过）。合并后两边的试卷都会保留，以后用微信或这个手机号登录都能看到同样的内容。合并后不能拆开。";

/**
 * 绑定手机号：绑定后在 App 里用这个手机号登录就是同一个账号。
 * 两种验证：微信「手机号快速验证」一键授权（需要小程序是企业 / 个体户主体），或短信验证码。号码已有账号时确认后合并。
 */
export default function BindPhone() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const done = async () => {
    void syncNow();
    await Taro.showToast({ title: "已绑定", icon: "success" });
    setTimeout(() => void Taro.navigateBack(), 800);
  };

  /** 绑定；号码已有账号时问一次要不要合并 */
  const bind = async (body: { phone: string; code: string } | { wxCode: string }, knownTaken: boolean) => {
    let merge = false;
    if (knownTaken) {
      const m = await Taro.showModal({ title: "合并账号？", content: MERGE_TEXT, confirmText: "合并" });
      if (!m.confirm) return;
      merge = true;
    }
    setBusy(true);
    try {
      await bindPhone(body, merge);
      await done();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "phone_taken" && !merge) {
        setBusy(false);
        const m = await Taro.showModal({ title: "合并账号？", content: MERGE_TEXT, confirmText: "合并" });
        if (!m.confirm) return;
        if ("phone" in body) {
          void Taro.showModal({ title: "请重新获取验证码", content: "验证码已经用过了，重新获取后再点绑定。", showCancel: false });
          setRegistered(true);
          setCode("");
          return;
        }
        void Taro.showModal({ title: "请再点一次", content: "再点一次「微信手机号一键绑定」完成合并。", showCancel: false });
        setRegistered(true);
        return;
      }
      void Taro.showModal({ title: "绑定失败", content: errorText(e), showCancel: false });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (wait || busy) return;
    if (!/^1\d{10}$/.test(phone)) {
      void Taro.showToast({ title: "请输入 11 位手机号", icon: "none" });
      return;
    }
    try {
      const r = await sendBindCode(phone);
      setRegistered(r.registered);
      setWait(60);
      if (r.devCode) setCode(r.devCode);
      void Taro.showToast({ title: "验证码已发送", icon: "none" });
    } catch (e) {
      void Taro.showModal({ title: "发送失败", content: errorText(e), showCancel: false });
    }
  };

  const submit = () => {
    if (busy) return;
    if (!/^1\d{10}$/.test(phone) || !code.trim()) {
      void Taro.showToast({ title: "请填手机号和验证码", icon: "none" });
      return;
    }
    void bind({ phone, code: code.trim() }, registered);
  };

  const onWxPhone = (e: { detail: { code?: string; errMsg?: string } }) => {
    if (!e.detail.code) {
      if (!/deny|cancel/i.test(e.detail.errMsg || "")) void Taro.showToast({ title: "没拿到手机号，请用验证码绑定", icon: "none" });
      return;
    }
    void bind({ wxCode: e.detail.code }, registered);
  };

  return (
    <View className="page">
      <Text className="t-sub c-sec">绑定后，在上壹课 App 里用这个手机号登录，就能看到同样的试卷和错题。</Text>
      <Button className="btn btn--wx" openType="getPhoneNumber" onGetPhoneNumber={onWxPhone} disabled={busy}>
        微信手机号一键绑定
      </Button>
      <Text className="t-cap c-sec center">或者用短信验证码</Text>
      <View className="card">
        <Input className="input" type="number" maxlength={11} placeholder="手机号" value={phone} onInput={(e) => setPhone(e.detail.value)} />
        <View className="row-wrap" style={{ flexWrap: "nowrap", gap: "8px" }}>
          <Input className="input" style={{ flex: 1 }} type="number" maxlength={6} placeholder="验证码" value={code} onInput={(e) => setCode(e.detail.value)} />
          <View className={`btn btn--tinted${wait ? " btn--disabled" : ""}`} style={{ height: "44px" }} onClick={send}>
            {wait ? `${wait} 秒` : "获取验证码"}
          </View>
        </View>
      </View>
      <View className={`btn${busy ? " btn--disabled" : ""}`} onClick={submit}>
        {busy ? "绑定中…" : registered ? "合并并绑定" : "绑定"}
      </View>
    </View>
  );
}
