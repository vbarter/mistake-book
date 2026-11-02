/** 本机小设置：上次导出错题本的时间（首页「导出新增的 N 道错题」用） */
import Taro from "@tarojs/taro";

const LAST_EXPORT = "zcb.lastExportAt";

export function getLastExportAt(): string | null {
  try {
    return (Taro.getStorageSync(LAST_EXPORT) as string) || null;
  } catch {
    return null;
  }
}

export function setLastExportAt(iso = new Date().toISOString()) {
  Taro.setStorageSync(LAST_EXPORT, iso);
}
