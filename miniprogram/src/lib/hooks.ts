import { useEffect, useMemo, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { JOBS_EVENT } from "./jobs";

/**
 * 本机数据版本：回到页面、扫描任务有变化时 +1，页面据此重新读。
 * 不检查登录：浏览本机数据不需要账号，扫描、导出等要服务器的操作在触发时再走 ensureLogin（微信审核要求先体验后登录）。
 */
export function useDataVersion(): [number, () => void] {
  const [v, setV] = useState(0);
  const bumpLocal = () => setV((x) => x + 1);
  useDidShow(bumpLocal);
  useEffect(() => {
    Taro.eventCenter.on(JOBS_EVENT, bumpLocal);
    Taro.eventCenter.on("auth", bumpLocal);
    return () => {
      Taro.eventCenter.off(JOBS_EVENT, bumpLocal);
      Taro.eventCenter.off("auth", bumpLocal);
    };
  }, []);
  return [v, bumpLocal];
}

export const toast = (title: string, icon: "none" | "success" = "none") => Taro.showToast({ title, icon, duration: 2000 });

/** Tab 页显示时告诉自定义 Tab 栏高亮哪个（每个 Tab 页各有一个 Tab 栏实例）。index 和 app.config 的 tabBar.list 顺序一致 */
export function useTabBar(index: number) {
  const page = useMemo(() => Taro.getCurrentInstance().page, []);
  useDidShow(() => {
    const bar = Taro.getTabBar<{ setSelected?: (i: number) => void }>(page);
    bar?.setSelected?.(index);
    // 原生 Tab 栏本来就不该出现；万一之前被显示出来了（旧版本调过 showTabBar），每次回到 Tab 页都再藏一次
    void Taro.hideTabBar({ animation: false }).catch(() => undefined);
  });
}
