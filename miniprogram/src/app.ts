import { PropsWithChildren } from "react";
import { useDidHide, useDidShow } from "@tarojs/taro";
import { isLoggedIn } from "./lib/auth";
import { startJobPoller, stopJobPoller } from "./lib/jobs";
import "./app.scss";

/** 小程序入口：在前台时轮询服务器上的扫描任务；没登录时由各页面的 useDataVersion 送去登录页 */
function App({ children }: PropsWithChildren) {
  useDidShow(() => {
    if (isLoggedIn()) startJobPoller();
  });
  useDidHide(() => stopJobPoller());
  return children;
}

export default App;
