import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { Row } from "../../components/ui";
import { currentUser, loginLabel, logout } from "../../lib/auth";
import { SYNC_EVENT, syncNow, syncStatus } from "../../lib/sync";
import { toast } from "../../lib/hooks";
import { useShare } from "../../lib/share";
import { C, useThemeClass } from "../../lib/theme";

const maskPhone = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;

/** 账号与登录（和 App 的同名页面一致）：登录方式、绑定手机号、手动云同步 */
export default function Account() {
  const tc = useThemeClass();
  useShare();
  const [user, setUser] = useState(() => currentUser());
  const [, setTick] = useState(0);
  useDidShow(() => setUser(currentUser()));
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    const onAuth = () => setUser(currentUser());
    Taro.eventCenter.on(SYNC_EVENT, on);
    Taro.eventCenter.on("auth", onAuth);
    return () => {
      Taro.eventCenter.off(SYNC_EVENT, on);
      Taro.eventCenter.off("auth", onAuth);
    };
  }, []);
  const doLogout = async () => {
    const m = await Taro.showModal({ title: "退出登录？", content: "本机的试卷和错题不会删除，已同步的也保存在云端。", confirmText: "退出", confirmColor: "#b42323" });
    if (m.confirm) logout();
  };
  // 行上不显示同步状态，点一下才给结果提示
  const doSync = async () => {
    if (syncStatus().state === "running") return void toast("正在同步…");
    void toast("正在同步…");
    await syncNow().catch(() => undefined);
    const st = syncStatus().state;
    void toast(st === "error" ? "同步失败，请稍后再试" : st === "off" ? "云同步未开启" : "已同步", st === "idle" ? "success" : "none");
  };
  const err = syncStatus().state === "error" ? syncStatus().error : "";
  return (
    <View className={"page" + tc}>
      <View className="group">
        <Row icon="person" iconBg="#1c1c1e" title="登录方式" value={loginLabel(user?.loginMethod)} chevron={false} />
        {user?.phone ? (
          <Row icon="lock" iconBg="#34c759" title="手机号" value={maskPhone(user.phone)} chevron={false} />
        ) : (
          <Row icon="lock" iconBg="#34c759" title="绑定手机号" value="去绑定" onClick={() => Taro.navigateTo({ url: "/pages/bind-phone/index" })} />
        )}
        <Row icon="refresh" iconBg={C.brand} title="云同步" onClick={doSync} />
      </View>
      <Text className="group-note">同一个微信、或绑定的手机号登录，在别的手机、电脑上也能看到这些试卷和错题。{err ? `上次失败：${err}` : ""}</Text>
      <View className="group">
        <Row icon="xmark" iconBg="#b42323" title="退出登录" danger chevron={false} onClick={doLogout} />
      </View>
      {user?.loginMethod === "guest" && <Text className="group-note">游客账号换设备后找不回来，建议绑定手机号。</Text>}
    </View>
  );
}
