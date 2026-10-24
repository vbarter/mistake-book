/** 后端请求：和 App 共用 https://book.openmindai.cn，带上登录 token。 */
import Taro from "@tarojs/taro";

const TOKEN_KEY = "zcb.token";
let token: string | null = null;
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

export function loadToken(): string | null {
  try {
    token = Taro.getStorageSync(TOKEN_KEY) || null;
  } catch {
    token = null;
  }
  return token;
}

export function setToken(value: string | null) {
  token = value;
  if (value) Taro.setStorageSync(TOKEN_KEY, value);
  else Taro.removeStorageSync(TOKEN_KEY);
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

function headers(auth: boolean, json: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  if (auth && token) h.Authorization = `Bearer ${token}`;
  return h;
}

function netError(e: unknown): ApiError {
  const msg = String((e as { errMsg?: string })?.errMsg || (e as Error)?.message || "");
  if (/timeout/i.test(msg)) return new ApiError(0, "timeout", "请求超时，请稍后再试");
  if (/domain|合法域名/i.test(msg)) return new ApiError(0, "domain", "服务器域名还没加到小程序后台的 request 合法域名");
  return new ApiError(0, "offline", "现在没有网络，请检查连接");
}

function fail(status: number, data: unknown): never {
  if (status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized", "登录已过期，请重新登录");
  }
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  throw new ApiError(status, String(d.error || "error"), String(d.message || d.msg || "请求失败"));
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs = 60000 } = opts;
  let res: Taro.request.SuccessCallbackResult;
  try {
    res = await Taro.request({ url: `${API_BASE}${path}`, method: method as "GET", data: body as Record<string, unknown> | undefined, header: headers(auth, body !== undefined), timeout: timeoutMs, dataType: "json" });
  } catch (e) {
    throw netError(e);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) fail(res.statusCode, res.data);
  return res.data as T;
}

/** 二进制（PDF）：出错时服务端回 JSON，解出来当错误信息 */
export async function apiBinary(path: string, opts: Options = {}): Promise<ArrayBuffer> {
  const { method = "POST", body, auth = true, timeoutMs = 90000 } = opts;
  let res: Taro.request.SuccessCallbackResult<ArrayBuffer>;
  try {
    res = await Taro.request<ArrayBuffer>({ url: `${API_BASE}${path}`, method: method as "POST", data: body as Record<string, unknown> | undefined, header: { ...headers(auth, body !== undefined), Accept: "application/pdf" }, timeout: timeoutMs, responseType: "arraybuffer" });
  } catch (e) {
    throw netError(e);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    let data: unknown = {};
    try {
      data = JSON.parse(decodeUtf8(res.data));
    } catch {
      /* 不是 JSON */
    }
    fail(res.statusCode, data);
  }
  return res.data;
}

function decodeUtf8(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : String((e as Error)?.message || "出错了，请稍后再试");
}
