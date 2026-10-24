/// <reference types="@tarojs/taro" />

declare module "*.png";
declare module "*.svg";

/** 编译期常量：后端地址（config/index.ts 的 defineConstants） */
declare const API_BASE: string;

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: "weapp" | "swan" | "alipay" | "h5" | "rn" | "tt" | "quickapp" | "qq" | "jd";
  }
}

