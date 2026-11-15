/**
 * 语音输入：微信同声传译插件（WechatSI，app.config.ts 里声明），按住说话、松手出文字。
 * 识别在微信那边做，我们的服务器只收到文字。插件只能真机用，开发者工具里会报错。
 */
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";

type Manager = {
  start: (opt: { duration?: number; lang?: string }) => void;
  stop: () => void;
  onStart: (cb: () => void) => void;
  onRecognize: (cb: (res: { result: string }) => void) => void;
  onStop: (cb: (res: { result: string; duration: number }) => void) => void;
  onError: (cb: (res: { retcode: number; msg: string }) => void) => void;
};

let manager: Manager | null | undefined;
function getManager(): Manager | null {
  if (manager !== undefined) return manager;
  try {
    manager = (Taro.requirePlugin("WechatSI") as { getRecordRecognitionManager: () => Manager }).getRecordRecognitionManager();
  } catch {
    manager = null;
  }
  return manager;
}

/** 要麦克风权限；拒绝过的引导去设置页打开 */
async function ensureRecordAuth(): Promise<boolean> {
  try {
    await Taro.authorize({ scope: "scope.record" });
    return true;
  } catch {
    const { confirm } = await Taro.showModal({ title: "需要麦克风权限", content: "说出作业要用到麦克风，去设置里打开「麦克风」就能用了。", confirmText: "去设置" });
    if (!confirm) return false;
    const { authSetting } = await Taro.openSetting();
    return !!authSetting["scope.record"];
  }
}

/** 识别失败的提示：常见的是没说话、太短、网络 */
function errorMsg(code: number): string {
  if (code === -30003 || code === -30004) return "没听清，靠近一点再说一次";
  if (code === -30011) return "上一次还没结束，稍等一下再说";
  if (code === -30001 || code === -30002) return "麦克风打不开，检查一下权限";
  return "没识别出来，再试一次或者打字";
}

export type VoiceState = "idle" | "listening" | "finishing";

/**
 * 按住说话：down() 开始听，up() 结束；识别完把文字交给 onText。
 * live 是边说边出的中间结果，用来在浮层里显示。
 */
export function useVoiceInput(onText: (text: string) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [live, setLive] = useState("");
  const held = useRef(false);
  const started = useRef(false);
  const cbs = useRef({ onText, onError });
  cbs.current = { onText, onError };

  useEffect(() => {
    const m = getManager();
    if (!m) return;
    m.onStart(() => {
      // 权限弹窗期间就松手了：一开始就停
      if (!held.current) m.stop();
    });
    m.onRecognize((res) => setLive(res.result || ""));
    m.onStop((res) => {
      started.current = false;
      setState("idle");
      setLive("");
      const text = (res.result || "").trim().replace(/[。！!]+$/, "");
      if (text) cbs.current.onText(text);
      else if (res.duration < 800) cbs.current.onError("按住话筒说话，说完再松开");
      else cbs.current.onError("没听清，靠近一点再说一次");
    });
    m.onError((res) => {
      started.current = false;
      setState("idle");
      setLive("");
      cbs.current.onError(errorMsg(res.retcode));
    });
    return () => {
      if (started.current) m.stop();
    };
  }, []);

  const down = async () => {
    const m = getManager();
    if (!m) return cbs.current.onError("当前微信版本用不了语音输入，先打字吧");
    if (started.current || held.current) return;
    held.current = true;
    if (!(await ensureRecordAuth())) {
      held.current = false;
      return;
    }
    if (!held.current) return cbs.current.onError("可以了，按住话筒说话"); // 第一次授权时已经松手，这次不录
    setLive("");
    started.current = true;
    setState("listening");
    void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    m.start({ duration: 60000, lang: "zh_CN" });
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    if (started.current) {
      setState("finishing");
      getManager()?.stop();
    }
  };
  return { state, live, down, up };
}
