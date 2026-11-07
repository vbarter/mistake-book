/**
 * 连拍扫描用的相机：在 WebView 里直接开后置摄像头（getUserMedia），取景、找四边、拍照都在页面里做。
 * 安卓 Capacitor 的 WebView 会把网页的相机请求转成系统相机权限；iOS 14.3+ 的 WKWebView 支持，Capacitor 已默认放行。
 * 打不开（老系统、权限被拒、个别 WebView 异常）时由调用方退回系统相机 + 确认页的旧流程。
 */

/** 这台设备能不能用页面内相机 */
export const canUseLiveCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;

export async function openCamera(): Promise<MediaStream> {
  const tries: MediaStreamConstraints[] = [
    // 4:3、尽量高的分辨率：试卷是竖的，4:3 比 16:9 拍进来的纸更大
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 } } },
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
  let last: unknown = null;
  for (const c of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      last = e;
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new Error("permission_denied");
    }
  }
  throw last instanceof Error ? last : new Error("camera_unavailable");
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** 能不能开闪光灯（安卓 Chrome 内核一般可以，iOS WebView 不行） */
export function torchSupported(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  try {
    const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    return !!caps?.torch;
  } catch {
    return false;
  }
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** 视频在元素里 object-fit: cover 显示：视频像素坐标 ↔ 元素坐标 */
export function coverMapping(vw: number, vh: number, ew: number, eh: number) {
  const s = Math.max(ew / vw, eh / vh);
  const ox = (ew - vw * s) / 2;
  const oy = (eh - vh * s) / 2;
  return {
    scale: s,
    toView: (x: number, y: number): [number, number] => [x * s + ox, y * s + oy],
    toVideo: (x: number, y: number): [number, number] => [(x - ox) / s, (y - oy) / s],
  };
}
