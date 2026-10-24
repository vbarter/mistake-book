import { useMemo } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Row } from "../../components/ui";
import { currentUser, loginLabel, logout } from "../../lib/auth";

/** 账号与登录（和 App 的同名页面一致） */
export default function Account() {
  const user = useMemo(() => currentUser(), []);
  const doLogout = async () => {
    const m = await Taro.showModal({ title: "退出登录？", content: "本机的试卷和错题不会删除。", confirmText: "退出", confirmColor: "#d92d20" });
    if (m.confirm) logout();
  };
  return (
    <View className="page">
      <View className="group">
        <Row icon="person" iconBg="#1c1c1e" title="登录方式" value={loginLabel(user?.loginMethod)} chevron={false} />
      </View>
      <View className="group">
        <Row icon="xmark" iconBg="#b42323" title="退出登录" danger chevron={false} onClick={doLogout} />
      </View>
      {user?.loginMethod === "guest" && <Text className="group-note">游客账号退出后本机数据无法再访问。</Text>}
    </View>
  );
}
