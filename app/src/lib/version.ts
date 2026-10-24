/** App 版本号：一律显示成三位（1.0.0 这种）。原生端读安装包里的真实版本（iOS 的 CFBundleShortVersionString / 安卓的 versionName），
 *  网页端用 package.json 的版本。 */
import pkg from "../../package.json";
import { isNative } from "./native";

/** 不足三位补 0（1.4 → 1.4.0），超过三位只取前三位 */
export function threePart(v: string | undefined | null): string {
  const parts = String(v ?? "").trim().split(".").map((x) => x.trim()).filter(Boolean).slice(0, 3);
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

export const WEB_VERSION = threePart(pkg.version);

export async function appVersion(): Promise<string> {
  if (!isNative) return WEB_VERSION;
  try {
    const { App } = await import("@capacitor/app");
    return threePart((await App.getInfo()).version);
  } catch {
    return WEB_VERSION;
  }
}
