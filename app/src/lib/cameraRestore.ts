import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const isAndroid = Capacitor.getPlatform() === "android";

/**
 * 安卓：拍照时 App 在后台，内存紧张的手机（ColorOS、MIUI 等尤其激进）会把 App 进程杀掉。
 * 拍完回来是一个重新启动的 App，这张照片不会回到原来的 getPhoto 调用，而是通过 App 插件的
 * `appRestoredResult` 事件送回来（事件会保留到有人监听为止）。
 *
 * 起相机前把「这张照片要放进哪张试卷」写进 Preferences；重启后收到照片时据此放回去，
 * 放不回原试卷就在原文件夹里新建一张，再打开录入页。
 */

const KEY = "camera.pendingTarget";
/** 太久以前的记录不用：相机不会开半天，过期的多半是没清掉的残留 */
const MAX_AGE_MS = 30 * 60 * 1000;

export interface CameraTarget {
  folderId: string | null;
  paperId: string | null;
  at: number;
}

export async function rememberCameraTarget(folderId: string | null, paperId: string | null): Promise<void> {
  if (!isAndroid) return;
  const value: CameraTarget = { folderId, paperId, at: Date.now() };
  try { await Preferences.set({ key: KEY, value: JSON.stringify(value) }); } catch { /* ignore */ }
}

export async function forgetCameraTarget(): Promise<void> {
  if (!isAndroid) return;
  try { await Preferences.remove({ key: KEY }); } catch { /* ignore */ }
}

async function takeCameraTarget(): Promise<CameraTarget | null> {
  try {
    const raw = (await Preferences.get({ key: KEY })).value;
    await Preferences.remove({ key: KEY });
    if (!raw) return null;
    const t = JSON.parse(raw) as CameraTarget;
    return Date.now() - t.at < MAX_AGE_MS ? t : null;
  } catch {
    return null;
  }
}

interface RestoredPhoto {
  dataUrl: string;
  target: CameraTarget | null;
}

/**
 * 监听被系统回收后送回来的拍照结果。只处理 Camera.getPhoto 成功的情况；取消或失败只清掉记录。
 * 返回取消监听的函数。
 */
export async function listenRestoredPhoto(onPhoto: (photo: RestoredPhoto) => void): Promise<() => void> {
  if (!isAndroid) return () => {};
  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("appRestoredResult", async (event) => {
    if (event.pluginId !== "Camera" || event.methodName !== "getPhoto") return;
    const target = await takeCameraTarget();
    const dataUrl = (event.data as { dataUrl?: string } | undefined)?.dataUrl;
    if (!event.success || !dataUrl) return;
    onPhoto({ dataUrl, target });
  });
  return () => { void handle.remove(); };
}
