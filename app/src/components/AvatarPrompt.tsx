import { useEffect, useState } from "react";
import { pickAvatar } from "../lib/native";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { Button, Sheet } from "./ui";
import { Avatar } from "./v2";

const KEY = "syk.avatarPrompt";

function asked(userId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>)[userId] > 0;
  } catch {
    return true; // 读不了本机记录就不弹，免得每次都打扰
  }
}

function markAsked(userId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>), [userId]: Date.now() }));
  } catch {
    /* 存不上就算了 */
  }
}

/**
 * 登录后发现账号还没有头像：弹一次，点一下从相册选一张。
 * 每个账号只问一次：换好了、点了「以后再说」或关掉面板都不再弹，之后在「我的」里点头像照样能换。
 */
export function AvatarPrompt() {
  const { user, uploadAvatar } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (user && !user.avatar && !asked(user.id)) setOpen(true);
  }, [user?.id, user?.avatar]);
  if (!user) return null;

  const close = () => {
    markAsked(user.id);
    setOpen(false);
  };
  const choose = async () => {
    try {
      const image = await pickAvatar();
      if (!image) return; // 没选：面板留着，可以再点一次
      close();
      await uploadAvatar(image);
      toast("头像换好了", "success");
    } catch (e) {
      if ((e as Error).message === "permission_denied") toast("需要相册权限，请在系统设置里打开");
      else toastError(e);
    }
  };

  return (
    <Sheet open={open} onClose={close} title="设置头像">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "4px 0 16px" }}>
        <Avatar name={user.nickname} size={72} />
        <span style={{ fontSize: 13, color: "var(--secondary)" }}>老师和同学在学习计划里能认出你</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Button icon="photo" onClick={() => void choose()}>从相册选一张</Button>
        <Button variant="plain" onClick={close}>以后再说</Button>
      </div>
    </Sheet>
  );
}
