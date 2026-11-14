import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Ring, useTick } from "../../components/homework";
import { Icon } from "../../components/Icon";
import { Button, Sheet, useMenuButton } from "../../components/ui";
import { errorText } from "../../lib/api";
import { pickPhotos } from "../../lib/capture";
import { toast } from "../../lib/hooks";
import { ack, act, alarmKey, clockOf, hourMin, hwSubjectLabel, liveUsed, loadDay, minSec, mmss, nextTodo, orderOf, uploadPhotos, useHomework, type HwItem } from "../../lib/homework";
import { C, useThemeClass } from "../../lib/theme";

const MORE_MINUTES = 10;
const close = () => void Taro.navigateBack().catch(() => Taro.redirectTo({ url: "/pages/homework/index" }));

/** 10 计时中 · 11 做完了（停表、完成拍照）· 13 超时（卡住了怎么办），和 App 一致。整页自己画（navigationStyle: custom） */
export default function HomeworkFocus() {
  const tc = useThemeClass();
  const mb = useMenuButton();
  const id = useRouter().params.id || "";
  const { data, fetchedAt } = useHomework();
  const item = data?.items.find((it) => it.id === id) ?? null;
  const now = useTick(item?.status === "running");
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [finished, setFinished] = useState<HwItem | null>(null);
  const remindAgainAt = useRef<number | null>(null);

  useEffect(() => {
    if (!item) loadDay().catch((e) => toast(errorText(e)));
    else ack(alarmKey(item));
  }, [item?.id, item?.firstStartedAt]);

  const used = item ? liveUsed(item, fetchedAt, now) : 0;
  const estSec = (item?.est ?? 20) * 60;
  const over = used > estSec;
  useEffect(() => {
    if (!item || item.status !== "running" || finished) return;
    const limit = remindAgainAt.current ?? estSec;
    if (used >= limit && used < limit + 2) {
      setStuck(true);
      void Taro.vibrateLong().catch(() => undefined);
    }
  }, [used]);

  const cur = item ?? finished;
  if (!data || !cur) {
    return (
      <View className={"hw-focus" + tc} style={{ paddingTop: `${mb.top}px` }}>
        <View className="hw-focus__close" onClick={close}><Text>收起</Text></View>
        <View className="hw-focus__what"><Text className="hw-focus__title">{data ? "这一项不在了" : ""}</Text></View>
      </View>
    );
  }
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = () =>
    run(async () => {
      const snap = { ...cur, used };
      await act(cur.id, "finish");
      setFinished(snap);
    });
  const skip = () =>
    run(async () => {
      setStuck(false);
      const d = await act(cur.id, "skip");
      const next = nextTodo(d.items, cur.id);
      if (next) {
        await act(next.id, "start");
        void Taro.redirectTo({ url: `/pages/homework-focus/index?id=${next.id}` });
      } else close();
    });
  const left = Math.ceil((estSec - used) / 60);

  return (
    <View className={`hw-focus${over && cur.status !== "done" ? " hw-focus--over" : ""}${tc}`} style={{ paddingTop: `${mb.top}px` }}>
      <View className="hw-focus__top" style={{ height: `${mb.height}px` }}>
        <View className="hw-focus__close" hoverClass="hw-press" onClick={close}>
          <Icon name="chevron-down" size={16} color="#ffffff" stroke={2.4} />
          <Text>收起</Text>
        </View>
      </View>
      <View className="hw-focus__what">
        <View className="hw-focus__tag">
          <Text className="hw-focus__tagi">{hwSubjectLabel(cur.subject)}</Text>
          <Text>
            第 {orderOf(data.items, cur.id)} 项 / 共 {data.items.length} 项
          </Text>
        </View>
        <Text className="hw-focus__title">{cur.title}</Text>
      </View>
      <View className="hw-ring">
        <Ring ratio={used / estSec} />
        <View className="hw-ring__in">
          <Text className="hw-ring__t">{mmss(used)}</Text>
          {over ? (
            <Text className="hw-ring__over">已超 {Math.floor((used - estSec) / 60)} 分钟</Text>
          ) : (
            <Text className="hw-ring__s">
              {cur.status === "paused" ? "已暂停" : cur.autoStarted ? `${clockOf(cur.firstStartedAt)} 自动开始` : "计时中"} · 还剩 {left} 分
            </Text>
          )}
        </View>
      </View>
      <Text className="hw-focus__note">
        预计 {cur.est} 分钟 · 今天已用 {hourMin(data.summary.used)} · 做完 {data.summary.done} 项
      </Text>
      {cur.planAssignmentId && (
        <View className="hw-focus__links">
          <View className="hw-focus__link" hoverClass="hw-press" onClick={() => void Taro.navigateTo({ url: `/pages/plan-task/index?id=${cur.planAssignmentId}` })}>
            <Icon name="document" size={16} color="#ffffff" />
            <Text>看老师布置的作业</Text>
          </View>
        </View>
      )}
      <View className="hw-ctl">
        {cur.status === "paused" ? (
          <View className="hw-ctl__btn" onClick={() => !busy && void run(() => act(cur.id, "resume"))}>
            <View className="hw-ctl__b"><Icon name="play" size={22} color="#ffffff" fill /></View>
            <Text>继续</Text>
          </View>
        ) : (
          <View className={`hw-ctl__btn${cur.status !== "running" ? " hw-ctl__dis" : ""}`} onClick={() => !busy && cur.status === "running" && void run(() => act(cur.id, "pause"))}>
            <View className="hw-ctl__b"><Icon name="pause" size={22} color="#ffffff" stroke={2.6} /></View>
            <Text>暂停</Text>
          </View>
        )}
        <View className="hw-ctl__btn" onClick={() => !busy && cur.status !== "done" && void finish()}>
          <View className="hw-ctl__main"><Icon name="check" size={38} color={over ? "#b42a24" : C.brand} stroke={3.2} /></View>
          <Text>做完了</Text>
        </View>
        <View className="hw-ctl__btn" onClick={() => setStuck(true)}>
          <View className="hw-ctl__b"><Icon name="help" size={24} color="#ffffff" stroke={2.2} /></View>
          <Text>卡住了</Text>
        </View>
      </View>

      <Sheet open={stuck} onClose={() => setStuck(false)} title={over ? "超过预计时间了" : "卡住了？"}>
        <Text className="t-sub">
          预计 {cur.est} 分钟，已经做了 {Math.floor(used / 60)} 分钟。接下来怎么办？
        </Text>
        <View
          className="hw-help"
          hoverClass="list-row--hover"
          onClick={() => {
            remindAgainAt.current = used + MORE_MINUTES * 60;
            setStuck(false);
            toast(`好的，再做 ${MORE_MINUTES} 分钟，到点再提醒一次`);
          }}
        >
          <Icon name="timer" size={24} color={C.brand} />
          <View className="flex1">
            <Text className="hw-help__b">再做 {MORE_MINUTES} 分钟</Text>
            <Text className="hw-help__s">继续计时，到点再提醒一次</Text>
          </View>
        </View>
        {cur.status === "running" && (
          <View className="hw-help" hoverClass="list-row--hover" onClick={() => { setStuck(false); void run(() => act(cur.id, "pause")); }}>
            <Icon name="pause" size={24} color={C.brand} />
            <View className="flex1">
              <Text className="hw-help__b">先停一下</Text>
              <Text className="hw-help__s">暂停计时，歇一会再继续</Text>
            </View>
          </View>
        )}
        <Button variant="plain" disabled={busy} onClick={() => void skip()}>
          先跳过，做下一项
        </Button>
      </Sheet>

      {finished && <FinishSheet item={finished} />}
    </View>
  );
}

/** 11 这一项做完了：用时、拍完成照片、下一项 */
function FinishSheet({ item }: { item: HwItem }) {
  const { data } = useHomework();
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const next = data ? nextTodo(data.items, item.id) : null;
  const diff = item.used - item.est * 60;
  const add = async () => {
    try {
      const r = await Taro.showActionSheet({ itemList: ["拍照", "从相册选"] });
      const got = await pickPhotos(r.tapIndex === 0 ? "camera" : "album");
      setPhotos((p) => [...p, ...got].slice(0, 9));
    } catch {
      /* 取消 */
    }
  };
  const go = async (startNext: boolean, plan?: boolean) => {
    setBusy(true);
    try {
      if (photos.length) await uploadPhotos(item.id, photos);
      if (plan && item.planAssignmentId) void Taro.redirectTo({ url: `/pages/plan-task/index?id=${item.planAssignmentId}` });
      else if (startNext && next) {
        await act(next.id, "start");
        void Taro.redirectTo({ url: `/pages/homework-focus/index?id=${next.id}` });
      } else close();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={close} title="这一项做完了">
      <View className="hw-donebox">
        <View className="hw-donebox__i"><Icon name="check" size={22} color="#ffffff" stroke={3} /></View>
        <View>
          <Text className="hw-donebox__b">{minSec(item.used)}</Text>
          <Text className="hw-donebox__s">
            预计 {item.est} 分钟 · {diff > 0 ? `超了 ${minSec(diff)}` : `快了 ${minSec(-diff)}`}
          </Text>
        </View>
      </View>
      <Text className="t-foot c-sec">完成拍照 · 拍下做完的作业</Text>
      <View className="hw-photos">
        {photos.map((src, i) => (
          <View key={src} className="hw-photo">
            <Image className="hw-photo__img" src={src} mode="aspectFill" />
            <View className="hw-x" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
              <Icon name="xmark" size={11} color="#ffffff" stroke={2.8} />
            </View>
          </View>
        ))}
        {photos.length < 9 && (
          <View className="hw-photo__add" onClick={() => void add()}>
            <Icon name="plus" size={22} color="#8e8e93" />
          </View>
        )}
      </View>
      <Text className="t-cap c-sec">照片留作完成记录，点开这一项可以再看。{item.planAssignmentId ? "这是学习计划里的作业，记得去交给老师。" : ""}</Text>
      {item.planAssignmentId && (
        <Button variant="tinted" icon="export" disabled={busy} onClick={() => void go(false, true)}>
          去交给老师
        </Button>
      )}
      <Button disabled={busy} onClick={() => void go(true)}>
        {next ? `完成，下一项：${next.title}` : "完成"}
      </Button>
      <Button variant="plain" disabled={busy} onClick={() => void go(false)}>
        {photos.length ? "保存照片，回清单" : "不拍照，回清单"}
      </Button>
    </Sheet>
  );
}
