import { create } from "zustand";

/**
 * 拍完照后的全屏确认：左上角 × 放弃这张、重新拍；右上角 ✓ 用这张，加入待扫描队列。
 * 拍照流程里 await confirmPhoto(dataUrl) 拿到用户的选择，界面由 App 里的 <PhotoConfirmHost /> 渲染。
 */
interface PhotoConfirmState {
  src: string | null;
  resolve: ((ok: boolean) => void) | null;
}

export const usePhotoConfirm = create<PhotoConfirmState>(() => ({ src: null, resolve: null }));

/** 显示确认界面，用户点 ✓ 返回 true，点 × 或按返回键返回 false */
export function confirmPhoto(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 上一次没答完的（理论上不会有）按放弃处理，免得 Promise 一直挂着
    usePhotoConfirm.getState().resolve?.(false);
    usePhotoConfirm.setState({ src, resolve });
  });
}

/** 关闭确认界面并给出结果；界面没打开时返回 false */
export function answerPhotoConfirm(ok: boolean): boolean {
  const { resolve } = usePhotoConfirm.getState();
  if (!resolve) return false;
  usePhotoConfirm.setState({ src: null, resolve: null });
  resolve(ok);
  return true;
}
