import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { Row } from "../../components/ui";
import { currentUser, loginLabel, logout } from "../../lib/auth";
import { SYNC_EVENT, syncNow, syncStatus } from "../../lib/sync";
import { useShare } from "../../lib/share";
import { C, useThemeClass } from "../../lib/theme";

const maskPhone = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;

function syncLabel(): string {
  const s = syncStatus();
  if (s.state === "running") return s.pendingUploads ? `上传中，还剩 ${s.pendingUploads} 个` : s.pendingDownloads ? `下载中，还剩 ${s.pendingDownloads} 张` : "同步中…";
  if (s.state === "error") return "同步失败，点这里重试";
  if (s.state === "off") return "未开启";
  return s.lastAt ? "已同步" : "点这里同步";
}

/** 账号与登录（和 App 的同名页面一致）：登录方式、绑定手机号、云同步状态 */
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
  const err = syncStatus().state === "error" ? syncStatus().error : "";
  return (
    <View className={"page" + tc}>
      <View className="group">
        <Row icon="person" iconBg="#1c1c1e" title="登录方式" value={loginLabel(user?.loginMethod)} chevron={false} />
        {user?.phone ? (
          <Row icon="lock" iconBg="#34c759" title="手机号" value={maskPhone(user.phone)} chevron={false} />
        ) : (
          <Row icon="lock" iconBg="#34c759" title="绑定手机号" value="App 里用手机号登录看同样内容" onClick={() => Taro.navigateTo({ url: "/pages/bind-phone/index" })} />
        )}
        <Row icon="refresh" iconBg={C.brand} title="云同步" value={syncLabel()} onClick={() => void syncNow()} />
      </View>
      <Text className="group-note">同一个微信、或绑定的手机号登录，在别的手机、电脑上也能看到这些试卷和错题。{err ? `上次失败：${err}` : ""}</Text>
      <View className="group">
        <Row icon="xmark" iconBg="#b42323" title="退出登录" danger chevron={false} onClick={doLogout} />
      </View>
      {user?.loginMethod === "guest" && <Text className="group-note">游客账号换设备后找不回来，建议绑定手机号。</Text>}
    </View>
  );
}
