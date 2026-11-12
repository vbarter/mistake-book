/**
 * 连拍扫描用的相机：在 WebView 里直接开后置摄像头（getUserMedia），取景、找四边、拍照都在页面里做。
 * 安卓 Capacitor 的 WebView 会把网页的相机请求转成系统相机权限；iOS 14.3+ 的 WKWebView 支持，Capacitor 已默认放行。
 * 打不开（老系统、权限被拒、个别 WebView 异常）时由调用方退回系统相机 + 确认页的旧流程。
 */

/** 这台设备能不能用页面内相机 */
export const canUseLiveCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;

/** 4:3、尽量高的分辨率：试卷是竖的，4:3 比 16:9 拍进来的纸更大 */
const HI_RES = { width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 } };

export async function openCamera(): Promise<MediaStream> {
  const tries: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: "environment" }, ...HI_RES } },
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
  let last: unknown = null;
  for (const c of tries) {
    try {
      const stream = await useMainBackCamera(await navigator.mediaDevices.getUserMedia(c));
      await keepFocusing(stream);
      return stream;
    } catch (e) {
      last = e;
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new Error("permission_denied");
    }
  }
  throw last instanceof Error ? last : new Error("camera_unavailable");
}

/**
 * 安卓多摄手机上 facingMode: environment 不一定给主摄，有的给超广角 / 微距 / 景深镜头（多是定焦，对着试卷是糊的）。
 * 安卓 WebView 里镜头名是 "camera2 N, facing back"，N 最小的是主摄：现在开的不是它就换过去。
 * iOS 的镜头名不是这个格式，默认给的就是主摄，不动。
 */
async function useMainBackCamera(stream: MediaStream): Promise<MediaStream> {
  let main: MediaDeviceInfo | undefined;
  try {
    const cur = stream.getVideoTracks()[0]?.getSettings().deviceId;
    const backs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({ d, n: Number(/camera2?\s*(\d+),\s*facing back/i.exec(d.label)?.[1] ?? NaN) }))
      .filter((x) => !Number.isNaN(x.n))
      .sort((a, b) => a.n - b.n);
    main = backs[0]?.d;
    if (!main || !cur || main.deviceId === cur) return stream;
  } catch {
    return stream;
  }
  // 安卓不能同时开两个镜头：先关掉现在这个再开主摄；主摄开不了的话抛出去，由 openCamera 换下一组参数重来
  stopCamera(stream);
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: main.deviceId }, ...HI_RES } });
  } catch {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
  }
}

type FocusCaps = MediaTrackCapabilities & { focusMode?: string[] };

/** 连续自动对焦：支持的设备（安卓 WebView）明确打开，有的机型默认停在开相机那一刻的焦点上 */
async function keepFocusing(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  try {
    const caps = track?.getCapabilities?.() as FocusCaps | undefined;
    if (caps?.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
  } catch {
    /* 不支持就用系统默认的 */
  }
}

/** 拍一张静态照片要的最长边：够清楚，又不至于把 5000 万像素的原图整张解进内存 */
const STILL_LONG_SIDE = 4000;
const STILL_TIMEOUT_MS = 2500;

type Range = { min?: number; max?: number };
type StillCapture = {
  takePhoto: (o?: { imageWidth?: number; imageHeight?: number }) => Promise<Blob>;
  getPhotoCapabilities: () => Promise<{ imageWidth?: Range; imageHeight?: Range }>;
};
const stills = new WeakMap<MediaStreamTrack, { ic: StillCapture; size: Promise<{ imageWidth?: number; imageHeight?: number }> }>();
const clamp = (v: number, r?: Range) => Math.max(r?.min ?? 1, Math.min(r?.max ?? v, v));

/**
 * 拍一张全分辨率的静态照片（ImageCapture，安卓 WebView 支持）。视频帧一般只有一两百万像素，试卷上的小字是糊的；静态照片走的是相机的拍照通道，清楚得多。
 * 不支持（iOS）、超时、出错都返回 null，调用方用视频帧。
 */
export async function takeStill(stream: MediaStream | null): Promise<Blob | null> {
  const track = stream?.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => StillCapture }).ImageCapture;
  if (!track || !IC || track.readyState !== "live") return null;
  try {
    let s = stills.get(track);
    if (!s) {
      const ic = new IC(track);
      const size = ic
        .getPhotoCapabilities()
        .then((caps) => {
          const wMax = caps.imageWidth?.max ?? 0;
          const hMax = caps.imageHeight?.max ?? 0;
          if (!wMax || !hMax) return {};
          // 传感器是横的：宽是长边
          const w = clamp(Math.min(wMax, STILL_LONG_SIDE), caps.imageWidth);
          return { imageWidth: w, imageHeight: clamp(Math.round((w * hMax) / wMax), caps.imageHeight) };
        })
        .catch(() => ({}));
      s = { ic, size };
      stills.set(track, s);
    }
    const shot = s.ic.takePhoto(await s.size);
    shot.catch(() => undefined);
    const blob = await Promise.race([shot, new Promise<null>((r) => window.setTimeout(() => r(null), STILL_TIMEOUT_MS))]);
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
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
