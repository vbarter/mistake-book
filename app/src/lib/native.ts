import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const isNative = Capacitor.isNativePlatform();

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
        width: 1600,
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
      downscale(file, 1600).then(resolve);
    };
    input.click();
  });
}

/** 从相册多选，返回 dataURL 列表（JPEG，最长边 1600）。网页端退化为多选文件。 */
export async function pickImages(limit = 8): Promise<string[]> {
  if (isNative) {
    const { Camera } = await import("@capacitor/camera");
    try {
      const result = await Camera.pickImages({ quality: 82, limit, correctOrientation: true, width: 1600 });
      const out: string[] = [];
      for (const p of result.photos) {
        if (!p.webPath) continue;
        out.push(await downscale(p.webPath, 1600));
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
      const files = Array.from(input.files ?? []).slice(0, limit);
      resolve(await Promise.all(files.map((f) => downscale(f, 1600))));
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
