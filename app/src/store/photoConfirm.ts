import { create } from "zustand";

/**
 * 拍完照后的全屏确认：左上角 × 放弃这张、重新拍；右上角 ✓ 用这张，加入待扫描队列；底下可以左转 / 右转把试卷摆正。
 * 拍照流程里 await confirmPhoto(dataUrl) 拿到用户的选择，界面由 App 里的 <PhotoConfirmHost /> 渲染。
 */
interface PhotoConfirmState {
  src: string | null;
  resolve: ((result: string | null) => void) | null;
}

export const usePhotoConfirm = create<PhotoConfirmState>(() => ({ src: null, resolve: null }));

/** 显示确认界面：点 ✓ 返回要用的照片（转过就是转正后的那张），点 × 或按返回键返回 null */
export function confirmPhoto(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    // 上一次没答完的（理论上不会有）按放弃处理，免得 Promise 一直挂着
    usePhotoConfirm.getState().resolve?.(null);
    usePhotoConfirm.setState({ src, resolve });
  });
}

/** 关闭确认界面并给出结果（照片 = 用这张，null = 放弃重拍）；界面没打开时返回 false */
export function answerPhotoConfirm(result: string | null): boolean {
  const { resolve } = usePhotoConfirm.getState();
  if (!resolve) return false;
  usePhotoConfirm.setState({ src: null, resolve: null });
  resolve(result);
  return true;
}
