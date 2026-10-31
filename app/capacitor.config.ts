import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zhicuoben.app",
  appName: "知错本",
  webDir: "dist",
  // androidScheme 必须保持 http：改成 https 会换掉页面的 origin，已装用户 IndexedDB 里的试卷照片会全部读不到。
  // 明文 HTTP 不在这里放开，交给 android/app/src/{main,debug}/res/xml/network_security_config.xml：正式包只走 HTTPS，调试包允许连局域网后端。
  server: { androidScheme: "http" },
  // backgroundColor：网页还没画出来前的底色，和启动页一致
  ios: { contentInset: "never", backgroundColor: "#1F3B73", scrollEnabled: true },
  android: { backgroundColor: "#1F3B73" },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
    StatusBar: { style: "DEFAULT" },
    // 保持关闭：真机连不上 HTTP 的根因是 ATS（见 Info.plist 注释），与 fetch 实现无关
    CapacitorHttp: { enabled: false },
  },
};

export default config;
