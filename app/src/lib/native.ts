import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const isNative = Capacitor.isNativePlatform();
/** 安卓原生：没有 Apple 登录，相机 / 相册走安卓权限 */
export const isAndroid = Capacitor.getPlatform() === "android";

export const haptic = {
  async light() {
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch { /* 网页无触感 */ }
  },
  async rigid() {
    try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch { /* ignore */ }
  },
  async success() {
    try { await Haptics.notification({ type: NotificationType.Success }); } catch { /* ignore */ }
  },
  async selection() {
    try { await Haptics.selectionStart(); await Haptics.selectionEnd(); } catch { /* ignore */ }
  },
};

/** 存进本机的试卷照片最长边：两页并排拍时切半后每页仍有 1200 多像素，插图也从这张图里裁 */
export const PHOTO_MAX_SIDE = 2400;

/** 拍照或从相册选图，返回 dataURL（JPEG）。网页端退化为文件选择。 */
export async function pickImage(source: "camera" | "photos"): Promise<string | null> {
  if (isNative) {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    try {
      const photo = await Camera.getPhoto({
        quality: 82,
        resultType: CameraResultType.DataUrl,
        source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
        correctOrientation: true,
        width: PHOTO_MAX_SIDE,
      });
      return photo.dataUrl ?? null;
    } catch (e) {
      const msg = String((e as Error).message || "");
      if (/cancel/i.test(msg)) return null;
      throw new Error(msg.includes("denied") || msg.includes("permission") ? "permission_denied" : msg);
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      downscale(file, PHOTO_MAX_SIDE).then(resolve);
    };
    input.click();
  });
}

/** 从相册多选，返回 dataURL 列表（JPEG，最长边 PHOTO_MAX_SIDE）。limit 为 0 表示不限张数。网页端退化为多选文件。 */
export async function pickImages(limit = 8): Promise<string[]> {
  if (isNative) {
    const { Camera } = await import("@capacitor/camera");
    try {
      const result = await Camera.pickImages({ quality: 82, limit, correctOrientation: true, width: PHOTO_MAX_SIDE });
      const out: string[] = [];
      for (const p of result.photos) {
        if (!p.webPath) continue;
        out.push(await downscale(p.webPath, PHOTO_MAX_SIDE));
      }
      return out;
    } catch (e) {
      const msg = String((e as Error).message || "");
      if (/cancel/i.test(msg)) return [];
      throw new Error(msg.includes("denied") || msg.includes("permission") ? "permission_denied" : msg);
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => {
      const all = Array.from(input.files ?? []);
      const files = limit > 0 ? all.slice(0, limit) : all;
      resolve(await Promise.all(files.map((f) => downscale(f, PHOTO_MAX_SIDE))));
    };
    input.click();
  });
}

/** 把文件或 URL 缩放到 maxSide 并转成 JPEG dataURL。 */
export async function downscale(source: File | string, maxSide: number, quality = 0.85): Promise<string> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const img = await loadImage(url);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (typeof source !== "string") URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 模型会把图片压到最长边约 1568px；两页并排的宽幅照片直接上传等于每页只剩七八百像素，手写就糊了 */
export const UPLOAD_MAX_SIDE = 1568;
/** 宽高比超过这个值视为左右两页拍在一张照片里 */
export const SPLIT_ASPECT = 1.3;

export interface UploadPart {
  page: number; // 来源页下标
  image: string; // dataURL
  x0: number; // 该部分在原图上的横向起点（0–1）
  w: number; // 该部分在原图上的宽度比例
}

/**
 * 把一页照片准备成上传片段：宽幅照片切成左右两张（各带 2% 重叠），其余整张；都缩到 UPLOAD_MAX_SIDE。
 * 返回的 x0 / w 用来把模型给出的 bbox 映射回原图坐标。
 */
export async function prepareUpload(src: string, page: number, quality = 0.85): Promise<UploadPart[]> {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const parts: { x0: number; w: number }[] = W / H >= SPLIT_ASPECT ? [{ x0: 0, w: 0.52 }, { x0: 0.48, w: 0.52 }] : [{ x0: 0, w: 1 }];
  const out: UploadPart[] = [];
  for (const part of parts) {
    const sw = Math.round(W * part.w);
    const sx = Math.round(W * part.x0);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(sw, H));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(H * scale);
    canvas.getContext("2d")!.drawImage(img, sx, 0, sw, H, 0, 0, canvas.width, canvas.height);
    out.push({ page, image: canvas.toDataURL("image/jpeg", quality), x0: part.x0, w: part.w });
  }
  return out;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function openAppSettings() {
  if (!isNative) return;
  try {
    const { App } = await import("@capacitor/app");
    // Capacitor 没有直接打开设置的 API，这里退化为提示；可接入 capacitor-native-settings 插件
    void App;
  } catch { /* ignore */ }
}

/**
 * 把 PDF 交给用户：原生端写入缓存目录后拉起系统分享面板（可打印、存到「文件」、AirDrop）；
 * 网页端在新标签打开，由浏览器打印或保存。
 */
export async function exportPdf(blob: Blob, filename: string): Promise<void> {
  if (isNative) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const base64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [written.uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Android 返回键 / 返回手势：有历史就后退，在首页就退出 App。iOS 用 WKWebView 的原生边缘滑动返回（原生壳里打开）。 */
export async function setupBackButton(): Promise<() => void> {
  if (!isNative) return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const handle = await App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) window.history.back();
      else void App.exitApp();
    });
    return () => { void handle.remove(); };
  } catch {
    return () => {};
  }
}

const TAB_ROOTS = new Set(["/home", "/papers", "/rank", "/profile", "/welcome", "/", "/setup", "/login"]);

/**
 * 网页层的边缘右滑返回：从屏幕左边缘 28px 内按下、横向拖过 70px 且基本水平，松手就后退一页。
 * iOS 上原生 WKWebView 的滑动返回手势先识别到时会给页面 touchcancel，这里就不再处理，不会退两次；
 * 原生没接管（Android / 网页）时由这里兜底。Tab 根页面不处理。
 */
export function setupEdgeSwipeBack(onBack: () => void, isRoot: () => boolean): () => void {
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let armed = false;
  const onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || t.clientX > 28 || isRoot()) { tracking = false; return; }
    tracking = true; armed = false; startX = t.clientX; startY = t.clientY;
  };
  const onMove = (e: TouchEvent) => {
    if (!tracking) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    if (dy > 50 && dx < 40) tracking = false;
    else if (dx > 70 && dy < 50) armed = true;
  };
  const onEnd = () => {
    if (tracking && armed) onBack();
    tracking = false; armed = false;
  };
  const onCancel = () => { tracking = false; armed = false; };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onCancel, { passive: true });
  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onCancel);
  };
}

export const isTabRoot = (pathname: string) => TAB_ROOTS.has(pathname);
