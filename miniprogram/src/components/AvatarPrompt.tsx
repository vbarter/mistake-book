import { useEffect, useState } from "react";
import { Button as NativeButton, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { errorText } from "../lib/api";
import { currentUser, uploadAvatar } from "../lib/auth";
import { toast } from "../lib/hooks";
import { WechatIcon } from "./Icon";
import { Avatar, Button, Sheet } from "./ui";
import type { User } from "../lib/types";

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
 * 换头像的面板：「用微信头像」和「从相册选」两条路。
 * 微信不让小程序自己读头像，只能用户亲手点原生按钮（弹出的面板第一项就是「用微信头像」）。
 * 这个原生按钮在后台隐私指引没声明「昵称、头像」时会被微信直接禁用，点了没有任何反应、也没有回调，
 * 所以不把它直接盖在头像上，而是先弹自己的面板：点头像一定有反应，另一条「从相册选」失败时能拿到原因并说明。
 */
export function AvatarSheet({ open, user, onClose, hint }: { open: boolean; user: User; onClose: () => void; hint?: string }) {
  const upload = async (path: string) => {
    if (!path) return;
    onClose();
    Taro.showLoading({ title: "正在上传…", mask: true });
    try {
      await uploadAvatar(path);
      Taro.hideLoading();
      toast("头像换好了", "success");
    } catch (e) {
      Taro.hideLoading();
      void Taro.showModal({ title: "头像没换成", content: errorText(e), showCancel: false });
    }
  };
  const fromAlbum = async () => {
    try {
      const res = await Taro.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"] });
      await upload(res.tempFiles[0]?.tempFilePath ?? "");
    } catch (e) {
      const msg = String((e as { errMsg?: string }).errMsg || (e as Error).message || "");
      if (!/cancel/i.test(msg)) void Taro.showModal({ title: "没选成", content: errorText(e), showCancel: false });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="设置头像">
      <View className="col gap12" style={{ alignItems: "center", padding: "4px 0 8px" }}>
        <Avatar name={user.nickname} url={user.avatar} size={72} />
        {hint && <Text className="t-foot c-sec">{hint}</Text>}
      </View>
      <NativeButton className="btn btn-native" hoverClass="btn--hover" openType="chooseAvatar" onChooseAvatar={(e) => void upload(e.detail.avatarUrl)}>
        <WechatIcon size={22} color="#ffffff" />
        <Text>用微信头像</Text>
      </NativeButton>
      <Button variant="outline" icon="photo" onClick={() => void fromAlbum()}>
        从相册选
      </Button>
      <Button variant="plain" onClick={onClose}>
        以后再说
      </Button>
    </Sheet>
  );
}

/**
 * 登录后发现账号还没有头像：弹一次上面的面板。
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
  return <AvatarSheet open={open} user={user} onClose={close} hint="老师和同学在学习计划里能认出你" />;
}
