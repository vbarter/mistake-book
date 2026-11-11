/**
 * 登录：微信一键登录（wx.login 的 code 换账号）；服务器还没配小程序 AppID 时退回游客账号。
 * 先浏览后登录（微信审核要求）：不登录也能打开各页面看本机数据，扫描、导出这类要服务器的操作触发时走 ensureLogin。
 */
import Taro from "@tarojs/taro";
import { ApiError, api, loadToken, setToken, setUnauthorizedHandler } from "./api";
import type { User } from "./types";

const USER_KEY = "zcb.user";
let user: User | null = null;

export function currentUser(): User | null {
  if (user) return user;
  try {
    user = Taro.getStorageSync(USER_KEY) || null;
  } catch {
    user = null;
  }
  return user;
}

function setUser(u: User | null) {
  user = u;
  if (u) Taro.setStorageSync(USER_KEY, u);
  else Taro.removeStorageSync(USER_KEY);
  Taro.eventCenter.trigger("auth");
}

export const loginLabel = (m?: string) => (m === "wechat" ? "微信" : m === "apple" ? "Apple" : m === "phone" ? "手机号" : "游客");

export function isLoggedIn(): boolean {
  return Boolean(loadToken());
}

/** 退出后回首页，照样能浏览本机数据 */
export function logout() {
  setToken(null);
  setUser(null);
  Taro.reLaunch({ url: "/pages/home/index" });
}

export const LOGIN_PAGE = "/pages/login/index";
/** 登录页关闭（登录成功返回，或用户点了「暂不登录」/ 左上角返回）时发出 */
export const LOGIN_CLOSED_EVENT = "login:closed";

function loginPageOpen(): boolean {
  return Taro.getCurrentPages().some((p) => `/${p.route}` === LOGIN_PAGE);
}

/** 登录过期：清掉本机 token，打开登录页（能返回，不打断浏览） */
setUnauthorizedHandler(() => {
  setToken(null);
  setUser(null);
  if (!loginPageOpen()) void Taro.navigateTo({ url: LOGIN_PAGE });
});

/**
 * 要账号的操作之前调：已登录直接 true；没登录先说明为什么要登录，用户选「去登录」就打开登录页，
 * 登录页关掉后按是否登录成功返回，调用方可以接着做刚才的操作。选「先看看」返回 false，留在原页。
 */
export async function ensureLogin(what = "使用这个功能"): Promise<boolean> {
  if (isLoggedIn()) return true;
  const m = await Taro.showModal({ title: "登录后才能" + what, content: "试卷要发到服务器识别、生成 PDF，需要一个账号。用微信一键登录即可，不用填手机号。", confirmText: "去登录", cancelText: "先看看" });
  if (!m.confirm) return false;
  return new Promise<boolean>((resolve) => {
    const done = () => {
      Taro.eventCenter.off(LOGIN_CLOSED_EVENT, done);
      resolve(isLoggedIn());
    };
    Taro.eventCenter.on(LOGIN_CLOSED_EVENT, done);
    Taro.navigateTo({ url: LOGIN_PAGE }).catch(done);
  });
}

export interface Profile {
  nickname?: string;
  grade: string;
  subjects: string[];
}

/** 先试微信登录；服务器没配置（503）就建游客账号，保证能先用起来 */
export async function login(profile: Profile): Promise<User> {
  let res: { token: string; user: User };
  try {
    const { code } = await Taro.login();
    res = await api<{ token: string; user: User }>("/api/auth/wechat", { method: "POST", body: { code, profile }, auth: false });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 503) throw e;
    res = await api<{ token: string; user: User }>("/api/auth/guest", { method: "POST", body: { profile }, auth: false });
  }
  setToken(res.token);
  setUser(res.user);
  return res.user;
}

export async function refreshUser(): Promise<User | null> {
  try {
    const res = await api<{ user: User; token?: string }>("/api/auth/me");
    if (res.token) setToken(res.token); // 服务端每次给新 token：常用就一直保持登录
    setUser(res.user);
    return res.user;
  } catch {
    return currentUser();
  }
}

export async function updateProfile(patch: Record<string, unknown>): Promise<User> {
  const { user: u } = await api<{ user: User }>("/api/auth/me", { method: "PUT", body: patch });
  setUser(u);
  return u;
}

/**
 * 换头像：path 是本机的一张图（微信「选择头像」给的临时文件）。缩小后直传到对象存储，再让服务器设成当前头像。
 * 小程序拿不到微信头像的地址，只能让用户自己点一下选，再由我们存一份。
 */
export async function uploadAvatar(path: string): Promise<User> {
  let src = path;
  try {
    src = (await Taro.compressImage({ src: path, quality: 80, compressedWidth: 400 } as Taro.compressImage.Option)).tempFilePath || path;
  } catch {
    /* 压不了就传原图 */
  }
  const up = await api<{ version: string; url: string; method: string; headers?: Record<string, string> }>("/api/auth/avatar/upload-url", { method: "POST", body: {} });
  const data = Taro.getFileSystemManager().readFileSync(src) as ArrayBuffer;
  let status = 0;
  try {
    status = (await Taro.request({ url: up.url.startsWith("/") ? `${API_BASE}${up.url}` : up.url, method: "PUT", data, header: { "Content-Type": "image/jpeg", ...(up.headers ?? {}) }, timeout: 60000 })).statusCode;
  } catch {
    status = 0;
  }
  if (status < 200 || status >= 300) throw new ApiError(0, "upload_failed", "头像没传上去，请重试");
  const { user: u } = await api<{ user: User }>("/api/auth/avatar", { method: "POST", body: { version: up.version } });
  setUser(u);
  return u;
}

/** 绑定手机号：先发验证码。registered = 这个号码已经有账号（比如在 App 里注册过），绑定时要合并 */
export async function sendBindCode(phone: string): Promise<{ registered: boolean; devCode?: string }> {
  const r = await api<{ registered?: boolean; devCode?: string }>("/api/auth/code", { method: "POST", body: { phone, purpose: "bind", allowMerge: true } });
  return { registered: Boolean(r.registered), devCode: r.devCode };
}

/**
 * 绑定手机号（验证码，或微信「手机号快速验证」的 code）。号码已有账号时 merge = true 把当前账号并进去，
 * 返回的是那个账号（token 换成它的），之后用微信或手机号登录都是同一个账号、同一份试卷。
 */
export async function bindPhone(body: { phone: string; code: string } | { wxCode: string }, merge = false): Promise<User> {
  const res = "wxCode" in body
    ? await api<{ user: User; token?: string }>("/api/auth/bind/wechat-phone", { method: "POST", body: { code: body.wxCode, merge } })
    : await api<{ user: User; token?: string }>("/api/auth/bind", { method: "POST", body: { ...body, merge } });
  if (res.token) setToken(res.token);
  setUser(res.user);
  return res.user;
}
