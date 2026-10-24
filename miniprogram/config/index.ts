import { defineConfig } from "@tarojs/cli";

/** 知错本小程序：设计稿按 375 宽写 px，Taro 换算成 rpx。 */
export default defineConfig<"webpack5">(() => ({
  projectName: "zhicuoben-miniprogram",
  date: "2026-10-24",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: "src",
  outputRoot: "dist",
  plugins: [],
  defineConstants: {
    // 后端地址：和 App 共用同一个服务
    API_BASE: JSON.stringify(process.env.TARO_APP_API_BASE || "https://book.openmindai.cn"),
  },
  copy: { patterns: [], options: {} },
  framework: "react",
  compiler: "webpack5",
  cache: { enable: false },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false, config: { namingPattern: "module", generateScopedName: "[name]__[local]___[hash:base64:5]" } },
    },
  },
}));
