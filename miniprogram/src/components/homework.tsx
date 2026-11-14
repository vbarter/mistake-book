/** 今天作业计划几个页面共用的小块（和 App 的 pages/homework/shared.tsx 对应） */
import { useEffect, useState } from "react";
import { Image, Picker, Text, View } from "@tarojs/components";
import { ColorIcon } from "./ColorIcon";
import { Icon, base64 } from "./Icon";
import { Button, Empty, Sheet } from "./ui";
import { ensureLogin } from "../lib/auth";
import { errorText } from "../lib/api";
import { toast } from "../lib/hooks";
import { focusRingSvg, liveUsed, mmss, updateItem, useHomework, type HwItem } from "../lib/homework";

/** 每秒刷新一次（秒表用） */
export function useTick(active = true, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** 没登录时整页换成这一块 */
export function HomeworkLoginGate() {
  return (
    <View className="page center-page">
      <Empty art={<ColorIcon name="todo" size={72} />} title="登录后使用今天作业计划" text="清单存在服务器上，换手机也在">
        <Button size="sm" onClick={() => void ensureLogin("使用今天作业计划")} style={{ width: "auto", padding: "0 24px" }}>
          微信登录
        </Button>
      </Empty>
    </View>
  );
}

/** 清单右边那颗：提醒时间 / 接着上一项 / 已过 / 计时中 / 做完的用时 */
export function RemindChip({ item, now }: { item: HwItem; now: number }) {
  const { fetchedAt } = useHomework();
  if (item.status === "done") {
    return (
      <View className="hw-used">
        {item.photoCount > 0 && <Icon name="camera" size={12} color="#5b5b63" stroke={2.2} />}
        <Text>{Math.max(1, Math.round(item.used / 60))} 分</Text>
      </View>
    );
  }
  if (item.status === "running" || item.status === "paused") {
    return (
      <View className="hw-rmd hw-rmd--run">
        <Icon name={item.status === "running" ? "timer" : "pause"} size={13} color="#ffffff" stroke={2.4} />
        <Text>{mmss(liveUsed(item, fetchedAt, now))}</Text>
      </View>
    );
  }
  if (item.chain) return <Text className="hw-rmd hw-rmd--off">接着上一项</Text>;
  if (!item.remindAt) return <Text className="hw-rmd hw-rmd--off">不提醒</Text>;
  return (
    <View className={`hw-rmd${item.late ? " hw-rmd--late" : ""}`}>
      <ColorIcon name="remind" size={18} />
      <Text>
        {item.remindAt}
        {item.late ? " 已过" : ""}
      </Text>
    </View>
  );
}

/** 给一项改提醒时间：几点、接着上一项、不提醒 */
export function RemindSheet({ item, first, onClose }: { item: HwItem | null; first?: boolean; onClose: () => void }) {
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) setTime(item.remindAt ?? "");
  }, [item]);
  const save = async (patch: { remindAt?: string | null; chain?: boolean }) => {
    if (!item) return;
    setBusy(true);
    try {
      await updateItem(item.id, patch);
      onClose();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!item} onClose={onClose} title="什么时候开始">
      {item && (
        <View className="hw-time">
          <Text className="t-sub ellipsis">{item.title}</Text>
          <Picker mode="time" value={time || "18:00"} onChange={(e) => setTime(String(e.detail.value))}>
            <View className="hw-timebox">
              <Text>{time || "选一个时间"}</Text>
            </View>
          </Picker>
          <Text className="t-cap c-sec">到点提醒，并自动开始计时</Text>
          <Button disabled={busy || !time} onClick={() => save({ remindAt: time })}>
            {time ? `${time} 开始` : "选一个时间"}
          </Button>
          <View className="row-center" style={{ gap: "10px" }}>
            {!first && (
              <Button variant="tinted" className="flex1" disabled={busy} onClick={() => save({ chain: true })}>
                接着上一项
              </Button>
            )}
            <Button variant="plain" className="flex1" disabled={busy} onClick={() => save({ remindAt: null, chain: false })}>
              不提醒
            </Button>
          </View>
        </View>
      )}
    </Sheet>
  );
}

/** 计时页黑板上的粉笔圆环（小程序没有内联 SVG：画成 SVG 图片，232×232）。画法在 lib/homework.ts focusRingSvg，和 App 一致 */
export function FocusRing({ used, est, paused, done, tie }: { used: number; est: number; paused: boolean; done: boolean; tie: string }) {
  return <Image className="fb__ringimg" src={`data:image/svg+xml;base64,${base64(focusRingSvg({ used, est, paused, done, tie }))}`} />;
}
