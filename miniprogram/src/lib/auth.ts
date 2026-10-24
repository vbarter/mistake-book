/** 登录：微信一键登录（wx.login 的 code 换账号）；服务器还没配小程序 AppID 时退回游客账号。 */
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

export function isLoggedIn(): boolean {
  return Boolean(loadToken());
}

export function logout() {
  setToken(null);
  setUser(null);
  Taro.reLaunch({ url: "/pages/login/index" });
}

setUnauthorizedHandler(() => {
  setToken(null);
  setUser(null);
  Taro.reLaunch({ url: "/pages/login/index" });
});

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
    const { user: u } = await api<{ user: User }>("/api/auth/me");
    setUser(u);
    return u;
  } catch {
    return currentUser();
  }
}

export async function updateProfile(patch: Record<string, unknown>): Promise<User> {
  const { user: u } = await api<{ user: User }>("/api/auth/me", { method: "PUT", body: patch });
  setUser(u);
  return u;
}
