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

async function downscale(file: File, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.85);
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
