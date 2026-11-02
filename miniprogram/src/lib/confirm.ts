/**
 * 拍完照的全屏确认（和 App 的 PhotoConfirm 一样）：左上 × 不要这张、重拍；右上 ✓ 用这张；底下左转 / 右转把横着拍的试卷摆正。
 * 拍照流程里 await confirmPhoto(临时文件) 拿到用户的选择，界面是 pages/confirm。
 */
import Taro from "@tarojs/taro";

export interface ConfirmResult {
  turns: number; // 顺时针转了几个 90°
}

let pending: { src: string; resolve: (r: ConfirmResult | null) => void } | null = null;

/** 打开确认页：点 ✓ 返回转了几下，点 × 或返回键返回 null */
export function confirmPhoto(src: string): Promise<ConfirmResult | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { src, resolve };
    Taro.navigateTo({ url: "/pages/confirm/index" }).catch(() => {
      // 页面栈满了等打不开：不确认，直接用这张
      pending = null;
      resolve({ turns: 0 });
    });
  });
}

/** 确认页读要显示的照片 */
export const confirmingSrc = () => pending?.src ?? "";

/** 确认页给出结果（关页面由确认页自己做）；没有在等的返回 false */
export function answerConfirm(result: ConfirmResult | null): boolean {
  const p = pending;
  if (!p) return false;
  pending = null;
  p.resolve(result);
  return true;
}
