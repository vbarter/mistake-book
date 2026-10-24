import { useEffect, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { JOBS_EVENT } from "./jobs";
import { isLoggedIn } from "./auth";

/** 没登录就去登录页（onLaunch 里跳转太早会被丢掉，所以放在页面显示时做） */
function requireLogin(): boolean {
  if (isLoggedIn()) return true;
  void Taro.reLaunch({ url: "/pages/login/index" });
  return false;
}

/** 本机数据版本：回到页面、扫描任务有变化时 +1，页面据此重新读 */
export function useDataVersion(): [number, () => void] {
  const [v, setV] = useState(0);
  const bumpLocal = () => setV((x) => x + 1);
  useDidShow(() => {
    if (requireLogin()) bumpLocal();
  });
  useEffect(() => {
    Taro.eventCenter.on(JOBS_EVENT, bumpLocal);
    return () => {
      Taro.eventCenter.off(JOBS_EVENT, bumpLocal);
    };
  }, []);
  return [v, bumpLocal];
}

export const toast = (title: string, icon: "none" | "success" = "none") => Taro.showToast({ title, icon, duration: 2000 });
