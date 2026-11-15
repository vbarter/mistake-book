/**
 * 语音输入：按住话筒录音（mp3，60 秒以内），松手把音频传到 POST /api/asr，
 * 服务器转给腾讯云一句话识别，拿回文字。音频服务器不保存。
 */
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";

const MIN_MS = 600; // 按一下就松开的不算

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

export type VoiceState = "idle" | "listening" | "finishing";

/**
 * 按住说话：down() 开始录，up() 结束；识别完把文字交给 onText。
 * live 留给以后的流式识别，现在一直是空串。
 */
export function useVoiceInput(onText: (text: string) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const held = useRef(false);
  const started = useRef(false);
  const cbs = useRef({ onText, onError });
  cbs.current = { onText, onError };

  useEffect(() => {
    const rm = Taro.getRecorderManager();
    rm.onStart(() => {
      // 录音真正开始前就松手了：直接停
      if (!held.current) rm.stop();
    });
    rm.onStop(async (res) => {
      started.current = false;
      if (res.duration < MIN_MS) {
        setState("idle");
        cbs.current.onError("按住话筒说话，说完再松开");
        return;
      }
      setState("finishing");
      try {
        const audio = Taro.getFileSystemManager().readFileSync(res.tempFilePath, "base64") as string;
        const { text } = await api<{ text: string }>("/api/asr", { method: "POST", body: { audio, format: "mp3" }, timeoutMs: 30000 });
        const said = (text || "").trim().replace(/[。！!]+$/, "");
        if (said) cbs.current.onText(said);
        else cbs.current.onError("没听清，靠近一点再说一次");
      } catch (e) {
        cbs.current.onError(errorText(e));
      } finally {
        setState("idle");
      }
    });
    rm.onError((res) => {
      started.current = false;
      setState("idle");
      cbs.current.onError(/auth|permission/i.test(res.errMsg) ? "麦克风打不开，检查一下权限" : "录音出错了，再试一次");
    });
    return () => {
      if (started.current) rm.stop();
    };
  }, []);

  const down = async () => {
    if (started.current || held.current || state !== "idle") return;
    held.current = true;
    if (!(await ensureRecordAuth())) {
      held.current = false;
      return;
    }
    if (!held.current) return cbs.current.onError("可以了，按住话筒说话"); // 第一次授权时已经松手，这次不录
    started.current = true;
    setState("listening");
    void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    Taro.getRecorderManager().start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: "mp3" });
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    if (started.current) Taro.getRecorderManager().stop();
  };
  return { state, live: "", down, up };
}
