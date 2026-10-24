import { PropsWithChildren } from "react";
import Taro, { useDidHide, useDidShow, useLaunch } from "@tarojs/taro";
import { isLoggedIn } from "./lib/auth";
import { startJobPoller, stopJobPoller } from "./lib/jobs";
import "./app.scss";

/** 小程序入口：没登录先去登录页；在前台时轮询服务器上的扫描任务 */
function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    if (!isLoggedIn()) Taro.reLaunch({ url: "/pages/login/index" });
  });
  useDidShow(() => {
    if (isLoggedIn()) startJobPoller();
  });
  useDidHide(() => stopJobPoller());
  return children;
}

export default App;
