import { useEffect, useState } from "react";
import { pickAvatar } from "../lib/native";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { Button, Sheet } from "./ui";
import { Avatar } from "./v2";

// 这次打开 App 期间已经问过谁（只记在内存里：点了「暂不设置」这次不再打扰，下次重新打开 App 还没有头像就再问）
const askedThisRun = new Set<string>();

/**
 * 登录后发现账号还没有头像：弹一次，点一下从相册选一张。
 * 点「暂不设置」或关掉面板：这次打开期间不再弹，下次重新打开 App 时如果还没有头像再提示。
 */
export function AvatarPrompt() {
  const { user, uploadAvatar } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (user && !user.avatar && !askedThisRun.has(user.id)) setOpen(true);
  }, [user?.id, user?.avatar]);
  if (!user) return null;

  const close = () => {
    askedThisRun.add(user.id);
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
        <Button variant="plain" onClick={close}>暂不设置</Button>
      </div>
    </Sheet>
  );
}
