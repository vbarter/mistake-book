/**
 * 自己的拍照页（pages/camera）：页面里放 <camera> 组件，画对齐框，按快门拿原图。
 * 微信自带的拍照界面（chooseMedia）没有对齐框，不少安卓机上取景和成片都偏糊，所以拍试卷不再用它；
 * 这一页打不开（没给相机权限、基础库太老、页面栈满了、相机几秒都没起来）时返回 null，调用方退回 chooseMedia。
 * 拍照流程里 await openCamera() 拿到这一轮拍的照片，界面是 pages/camera。
 */
import Taro from "@tarojs/taro";

/** 拍下并确认过的一张：临时文件路径 + 确认页里顺时针转了几个 90° */
export interface CameraShot {
  path: string;
  turns: number;
}

let pending: { single: boolean; resolve: (r: CameraShot[] | null) => void } | null = null;

/**
 * 打开拍照页。single = 只拍一张（确认后自动关），否则连拍、点「完成」才关。
 * 返回这一轮确认过的照片（没拍就是空数组）；这一页用不了返回 null。
 */
export async function openCamera(single: boolean): Promise<CameraShot[] | null> {
  pending?.resolve([]);
  pending = null;
  if (!Taro.canIUse("camera")) return null;
  if (!(await cameraAllowed())) return null;
  return new Promise((resolve) => {
    pending = { single, resolve };
    Taro.navigateTo({ url: "/pages/camera/index" }).catch(() => {
      pending = null;
      resolve(null);
    });
  });
}

/**
 * 进拍照页之前先把摄像头授权问完：没问过的在这里弹微信的授权框，拒绝过的直接不进。
 * 不然 <camera> 在一部分手机上既不出画面也不报错，页面就停在一片黑上。
 * 查不出来（接口本身失败）时当作可以，交给拍照页自己的超时兜底。
 */
async function cameraAllowed(): Promise<boolean> {
  let state: boolean | undefined;
  try {
    state = (await Taro.getSetting()).authSetting["scope.camera"];
  } catch {
    return true;
  }
  if (state !== undefined) return state;
  try {
    await Taro.authorize({ scope: "scope.camera" });
    return true;
  } catch {
    return false;
  }
}

/** 拍照页读这一轮是不是只拍一张 */
export const cameraSingle = () => pending?.single ?? false;

/** 拍照页关掉时交回结果；没有在等的返回 false */
export function answerCamera(result: CameraShot[] | null): boolean {
  const p = pending;
  if (!p) return false;
  pending = null;
  p.resolve(result);
  return true;
}
