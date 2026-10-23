import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";

const TOKEN_KEY = "zcb.token";
const BASE_KEY = "zcb.apiBase";

let token: string | null = null;
let apiBase: string | null = null;
let onUnauthorized: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function loadSession() {
  const [t, b] = await Promise.all([Preferences.get({ key: TOKEN_KEY }), Preferences.get({ key: BASE_KEY })]);
  token = t.value;
  apiBase = b.value;
  return token;
}

export async function setToken(value: string | null) {
  token = value;
  if (value) await Preferences.set({ key: TOKEN_KEY, value });
  else await Preferences.remove({ key: TOKEN_KEY });
}

export function getApiBase(): string {
  if (apiBase) return apiBase;
  const env = (import.meta.env.VITE_API_BASE as string | undefined) || "";
  if (env) return env;
  // 网页开发走 Vite 代理；原生壳必须显式配置服务器地址
  return Capacitor.isNativePlatform() ? "http://localhost:5001" : "";
}

export async function setApiBase(value: string) {
  apiBase = value.trim() || null;
  if (apiBase) await Preferences.set({ key: BASE_KEY, value: apiBase });
  else await Preferences.remove({ key: BASE_KEY });
}

export function assetUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${getApiBase()}${path}`;
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs = 60000 } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") throw new ApiError(0, "timeout", "请求超时，请稍后再试");
    throw new ApiError(0, "offline", "现在没有网络，请检查连接");
  }
  clearTimeout(timer);

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized", "登录已过期，请重新登录");
  }
  if (!res.ok) {
    throw new ApiError(res.status, String(data.error || "error"), String(data.message || data.msg || "请求失败"));
  }
  return data as T;
}

/** 请求二进制内容（例如 PDF）；错误仍按 JSON 解析成 ApiError */
export async function apiBlob(path: string, opts: Options = {}): Promise<Blob> {
  const { method = "POST", body, auth = true, timeoutMs = 60000 } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") throw new ApiError(0, "timeout", "请求超时，请稍后再试");
    throw new ApiError(0, "offline", "现在没有网络，请检查连接");
  }
  clearTimeout(timer);
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized", "登录已过期，请重新登录");
  }
  if (!res.ok) {
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* 非 JSON */ }
    throw new ApiError(res.status, String(data.error || "error"), String(data.message || "请求失败"));
  }
  return res.blob();
}
