/** 通过 Apple 登录 / 注册：拿 identityToken（和 Apple 首次授权时给的姓名）。用户取消返回 null。 */
import { isNative } from "./native";

export class AppleAuthError extends Error {}

export async function appleIdentity(): Promise<{ identityToken: string; nickname?: string } | null> {
  if (!isNative) throw new AppleAuthError("通过 Apple 登录需要在 iPhone 上使用");
  try {
    const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { response } = await SignInWithApple.authorize({
      clientId: "com.zhicuoben.app",
      redirectURI: "https://zhicuoben.app/auth/apple",
      scopes: "name",
      state: "zcb",
      nonce,
    });
    if (!response.identityToken) throw new AppleAuthError("没有拿到 Apple 登录凭证");
    // Apple 只在首次授权返回姓名；之后为空，服务端沿用已有昵称
    const nickname = [response.familyName, response.givenName].filter(Boolean).join("") || undefined;
    return { identityToken: response.identityToken, nickname };
  } catch (e) {
    if (e instanceof AppleAuthError) throw e;
    const msg = String((e as Error).message || "");
    if (/cancel|1001|canceled/i.test(msg)) return null; // 用户取消
    if (/1000|unknown/i.test(msg)) throw new AppleAuthError("Apple 登录暂不可用：请确认设备已登录 Apple ID 且已联网");
    throw new AppleAuthError("Apple 登录失败，请稍后再试");
  }
}
