import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zhicuoben.app",
  appName: "知错本",
  webDir: "dist",
  // 原生壳里直接访问 http 开发服务器需要放开明文：生产应改为 https 后端
  server: { androidScheme: "http", cleartext: true },
  ios: { contentInset: "never", backgroundColor: "#F2F2F7", scrollEnabled: true },
  android: { backgroundColor: "#F2F2F7", allowMixedContent: true },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
    StatusBar: { style: "DEFAULT" },
    // 保持关闭：真机连不上 HTTP 的根因是 ATS（见 Info.plist 注释），与 fetch 实现无关
    CapacitorHttp: { enabled: false },
  },
};

export default config;
