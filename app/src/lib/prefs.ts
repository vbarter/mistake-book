import { Preferences } from "@capacitor/preferences";

const CITY_KEY = "zcb.city";

/** 学生所在城市：本机保存，扫描时作为知识点归类的考纲提示 */
export async function getCity(): Promise<string> {
  try {
    return (await Preferences.get({ key: CITY_KEY })).value ?? "";
  } catch {
    return "";
  }
}

export async function setCity(city: string): Promise<void> {
  try {
    if (city.trim()) await Preferences.set({ key: CITY_KEY, value: city.trim() });
    else await Preferences.remove({ key: CITY_KEY });
  } catch { /* ignore */ }
}

const EXPORT_KEY = "zcb.lastExportAt";

/** 上次导出错题本的时间：首页据此提示「新增 N 题」，一键导出只导新的 */
export async function getLastExportAt(): Promise<string | null> {
  try {
    return (await Preferences.get({ key: EXPORT_KEY })).value ?? null;
  } catch {
    return null;
  }
}

export async function setLastExportAt(iso = new Date().toISOString()): Promise<void> {
  try {
    await Preferences.set({ key: EXPORT_KEY, value: iso });
  } catch { /* ignore */ }
}
