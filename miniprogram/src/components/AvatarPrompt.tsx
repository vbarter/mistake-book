import { useEffect, useState } from "react";
import { Button as NativeButton, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { errorText } from "../lib/api";
import { currentUser, uploadAvatar } from "../lib/auth";
import { toast } from "../lib/hooks";
import { WechatIcon } from "./Icon";
import { Avatar, Button, Sheet } from "./ui";

const KEY = "syk.avatarPrompt";

function asked(userId: string): boolean {
  try {
    return ((Taro.getStorageSync(KEY) || {}) as Record<string, number>)[userId] > 0;
  } catch {
    return true; // 读不了本机记录就不弹，免得每次都打扰
  }
}

function markAsked(userId: string) {
  try {
    Taro.setStorageSync(KEY, { ...((Taro.getStorageSync(KEY) || {}) as Record<string, number>), [userId]: Date.now() });
  } catch {
    /* 存不上就算了 */
  }
}

/**
 * 登录后发现账号还没有头像：弹一次，点一下就用微信头像。
 * 微信不让小程序自己读头像，只能用户亲手点这个原生按钮（弹出的面板第一项就是「用微信头像」），所以做不到完全自动。
 * 每个账号只问一次：换好了、点了「以后再说」或关掉面板都不再弹，之后在「我的」里点头像照样能换。
 */
export function AvatarPrompt({ version }: { version: number }) {
  const [open, setOpen] = useState(false);
  const user = currentUser();
  useEffect(() => {
    if (user && !user.avatar && !asked(user.id)) setOpen(true);
  }, [user?.id, user?.avatar, version]);
  if (!user) return null;

  const close = () => {
    markAsked(user.id);
    setOpen(false);
  };
  const choose = async (path: string) => {
    if (!path) return;
    close();
    Taro.showLoading({ title: "正在上传…", mask: true });
    try {
      await uploadAvatar(path);
      Taro.hideLoading();
      toast("头像换好了", "success");
    } catch (e) {
      Taro.hideLoading();
      toast(errorText(e));
    }
  };

  return (
    <Sheet open={open} onClose={close} title="设置头像">
      <View className="col gap12" style={{ alignItems: "center", padding: "4px 0 8px" }}>
        <Avatar name={user.nickname} size={72} />
        <Text className="t-foot c-sec">老师和同学在学习计划里能认出你</Text>
      </View>
      <NativeButton className="btn btn-native" hoverClass="btn--hover" openType="chooseAvatar" onChooseAvatar={(e) => void choose(e.detail.avatarUrl)}>
        <WechatIcon size={22} color="#ffffff" />
        <Text>用微信头像</Text>
      </NativeButton>
      <Button variant="plain" onClick={close}>
        以后再说
      </Button>
    </Sheet>
  );
}
