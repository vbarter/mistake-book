/** 今天作业计划几个页面共用的小块（和 App 的 pages/homework/shared.tsx 对应） */
import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Image, Picker, Text, View } from "@tarojs/components";
import { ColorIcon } from "./ColorIcon";
import { Icon, base64 } from "./Icon";
import { Button, Empty, Sheet } from "./ui";
import { ensureLogin } from "../lib/auth";
import { errorText } from "../lib/api";
import { toast } from "../lib/hooks";
import { C } from "../lib/theme";
import { defaultStart, focusRingSvg, liveNow, liveUsed, mmss, schedule, suggestRemind, updateItem, useHomework, type HwDay, type HwItem } from "../lib/homework";

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
/** action：在「提醒时间」页，点它就是去设提醒，没设的写「设提醒」；别的页面只说状态「未设提醒」（和 App 一致） */
export function RemindChip({ item, now, action }: { item: HwItem; now: number; action?: boolean }) {
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
  if (!item.remindAt) {
    return action ? (
      <View className="hw-rmd hw-rmd--set">
        <Icon name="plus" size={12} color={C.brand} stroke={2.8} />
        <Text>设提醒</Text>
      </View>
    ) : (
      <Text className="hw-rmd hw-rmd--off">未设提醒</Text>
    );
  }
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

/** 给一项设提醒时间：几点（先填好一个合适的时间）、接着上一项；设过的可以取消提醒（和 App 一致） */
export function RemindSheet({ item, first, onClose }: { item: HwItem | null; first?: boolean; onClose: () => void }) {
  const { data, fetchedAt } = useHomework();
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item && data) setTime(suggestRemind(data.items, item, liveNow(data.now, fetchedAt), data.day === data.today));
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
  const set = !!item && (!!item.remindAt || item.chain);
  return (
    <Sheet open={!!item} onClose={onClose} title="提醒时间">
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
            {time ? `${time} 提醒我` : "选一个时间"}
          </Button>
          {(!first || set) && (
            <View className="row-center" style={{ gap: "10px" }}>
              {!first && (
                <Button variant="tinted" className="flex1" disabled={busy} onClick={() => save({ chain: true })}>
                  接着上一项
                </Button>
              )}
              {set && (
                <Button variant="plain" className="flex1" disabled={busy} onClick={() => save({ remindAt: null, chain: false })}>
                  取消提醒
                </Button>
              )}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

/** 计时页黑板上的粉笔圆环（小程序没有内联 SVG：画成 SVG 图片，232×232）。画法在 lib/homework.ts focusRingSvg，和 App 一致 */
export function FocusRing({ used, est, paused, done, tie }: { used: number; est: number; paused: boolean; done: boolean; tie: string }) {
  return <Image className="fb__ringimg" src={`data:image/svg+xml;base64,${base64(focusRingSvg({ used, est, paused, done, tie }))}`} />;
}

/** 这一天关掉了「自动排时间」：记在本机，下次进清单不再自动排（和 App 一致） */
const offKey = (day: string) => `zcb.hw.autoOff.${day}`;
const autoOff = (day: string) => {
  try {
    return Taro.getStorageSync(offKey(day)) === "1";
  } catch {
    return false;
  }
};
const setAutoOff = (day: string, off: boolean) => {
  try {
    if (off) Taro.setStorageSync(offKey(day), "1");
    else Taro.removeStorageSync(offKey(day));
  } catch {
    /* 存不了只影响下次进来会不会自动排 */
  }
};

/** 清单顶部的开始时间（和 App 一致）：一个时钟定几点开始，每一项按预计用时自动排好，改时钟立刻重排；开关整体关掉。
 * 一项都还没排、也还没开始做时，进来就自动排一次 */
export function StartClock({ data }: { data: HwDay }) {
  const { fetchedAt } = useHomework();
  const todo = data.items.filter((it) => it.status === "todo");
  const auto = todo.some((it) => it.remindAt || it.chain);
  const firstAt = todo.find((it) => it.remindAt)?.remindAt;
  const [from, setFrom] = useState(firstAt ?? (data.day === data.today ? defaultStart(liveNow(data.now, fetchedAt)) : "18:00"));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (firstAt) setFrom(firstAt);
  }, [firstAt]);
  const run = async (start: string | null) => {
    setBusy(true);
    try {
      await schedule(start, data.day);
      setAutoOff(data.day, !start);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const tried = useRef("");
  const s = data.summary;
  useEffect(() => {
    if (tried.current === data.day) return;
    tried.current = data.day;
    if (todo.length && !auto && !s.done && !s.currentId && !s.startedAt && !autoOff(data.day)) void run(from);
  }, [data.day]);
  if (!todo.length) return null;
  return (
    <View className="hw-auto hw-auto--list">
      <View className="hw-auto__row">
        <Picker
          mode="time"
          value={from}
          onChange={(e) => {
            const v = String(e.detail.value);
            setFrom(v);
            void run(v);
          }}
        >
          <View className="hw-clock">
            <Icon name="clock" size={18} color={C.brand} stroke={2.4} />
            <Text className="hw-clock__t">{from}</Text>
          </View>
        </Picker>
        <View className="hw-auto__txt">
          <Text className="hw-auto__txtb">开始</Text>
          <Text>{auto ? "每一项按预计用时排好，到点自动计时" : "关着：不提醒，自己点开始"}</Text>
        </View>
        <View className={`hw-switch${auto ? " hw-switch--on" : ""}`} onClick={() => !busy && void run(auto ? null : from)} />
      </View>
    </View>
  );
}
