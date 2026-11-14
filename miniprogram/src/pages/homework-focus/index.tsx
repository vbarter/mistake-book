import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { FocusRing, useTick } from "../../components/homework";
import { Icon, base64 } from "../../components/Icon";
import { Button, Empty, Sheet, useMenuButton } from "../../components/ui";
import { errorText } from "../../lib/api";
import { pickPhotos } from "../../lib/capture";
import { toast } from "../../lib/hooks";
import { ack, act, alarmKey, clockOf, groupBySubject, hwSubjectLabel, liveUsed, loadDay, minSec, mmss, nextTodo, orderOf, uploadPhotos, useHomework, type ChalkTone, type HwItem } from "../../lib/homework";
import { roleIconSvg, type RoleName } from "../../lib/roleIcons";
import type { ThemeName } from "../../lib/colorIcons";
import { C, useTheme, useThemeClass } from "../../lib/theme";

const MORE_MINUTES = 10;
const svgUri = (svg: string) => `data:image/svg+xml;base64,${base64(svg)}`; // 图里没有中文，可以直接用最简单的 base64
const SUN = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>`);
const STAR = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>`);
const LINE = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="8" viewBox="0 0 120 8" fill="none"><path d="M2 6C30 2.5 76 1.5 118 3" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/></svg>`);
const roleCache = new Map<string, string>();
function roleUri(role: RoleName, theme: ThemeName): string {
  const key = `${theme}|${role}`;
  let u = roleCache.get(key);
  if (!u) roleCache.set(key, (u = svgUri(roleIconSvg(role, theme, false, false))));
  return u;
}
/** 「收起」回首页（页面栈里只有首页和这一页）；做完了弹层里的「回清单」回清单 */
const close = () => void Taro.navigateBack().catch(() => Taro.switchTab({ url: "/pages/home/index" }));
const toList = () => void Taro.redirectTo({ url: "/pages/homework/index" });

/** 10 计时中 · 11 做完了（停表、完成拍照）· 13 超时（卡住了怎么办），和 App 一致：整块计时区是一块黑板，粉笔数字是烘好的图（tools/chalk-digits.mjs）。整页自己画（navigationStyle: custom） */
export default function HomeworkFocus() {
  const tc = useThemeClass();
  const theme = useTheme();
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
      <View className={"fz" + tc} style={{ paddingTop: `${mb.top}px` }}>
        <View className="fz__nav" style={{ height: `${mb.height}px` }}>
          <View className="fz__close" onClick={close}><Icon name="chevron-down" size={16} color={C.label} stroke={2.6} /><Text>收起</Text></View>
        </View>
        {data ? <Empty icon="document" title="这一项不在了" /> : <View className="empty"><View className="spinner spinner--lg" /></View>}
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
      } else toList();
    });
  const left = Math.ceil((estSec - used) / 60);
  const paused = cur.status === "paused";
  const done = cur.status === "done" || !!finished;
  const diff = used - estSec;
  const tone: ChalkTone = done ? "g" : over ? "o" : "w";
  const flat = groupBySubject(data.items).flatMap((g) => g.items);
  const started = cur.firstStartedAt ? `${clockOf(cur.firstStartedAt)} ${cur.autoStarted ? "自动开始" : "开始"}` : "";
  const role: RoleName = done ? "done" : over ? "stuck" : "focus";

  return (
    <View className={`fz${done ? " fz--done" : over ? " fz--over" : paused ? " fz--paused" : ""}${tc}`} style={{ paddingTop: `${mb.top}px` }}>
      <View className="fz__nav" style={{ height: `${mb.height}px` }}>
        <View className="fz__close" hoverClass="hw-press" onClick={close}>
          <Icon name="chevron-down" size={16} color={C.label} stroke={2.6} />
          <Text>收起</Text>
        </View>
      </View>

      <View className="fb">
        <View className="fb__face">
          <View className="fb__row">
            <Text className="fb__tag">第 <Text className="fb__tagb">{orderOf(data.items, cur.id)}</Text> 项 / 共 <Text className="fb__tagb">{data.items.length}</Text> 项</Text>
            <Text className="fb__subj">{hwSubjectLabel(cur.subject)}</Text>
          </View>
          <Text className="fb__title">{cur.title}</Text>
          <Image className="fb__line" src={LINE} mode="aspectFit" />
          <View className="fb__ring">
            <FocusRing used={used} est={estSec} paused={paused} done={done} tie={C.tie} />
            <View className="fb__in">
              <View className={`fb__t${mmss(used).length > 5 ? " fb__t--long" : ""}`}>
                {[...mmss(used)].map((ch, i) => (
                  <Image key={i} className={ch === ":" ? "fb__tc" : "fb__td"} src={`/assets/chalk/num/${tone}-${ch === ":" ? "c" : ch}.png`} mode="aspectFit" />
                ))}
              </View>
              {done ? (
                <Text className="fb__s">{diff > 0 ? `超了 ${minSec(diff)}` : `快了 ${minSec(-diff)}`}</Text>
              ) : over ? (
                <Text className="fb__badge">已超 <Text className="fb__b">{Math.floor(diff / 60)}</Text> 分钟</Text>
              ) : (
                <Text className="fb__s">{paused ? "已暂停" : "计时中"} · 还剩 <Text className="fb__b">{left}</Text> 分</Text>
              )}
            </View>
          </View>
          <Image className="fb__doodle fb__doodle--r" src={done ? STAR : SUN} mode="aspectFit" />
          <Image className="fb__doodle fb__doodle--l" src={STAR} mode="aspectFit" />
          <View className="fb__est">
            <Text>预计 <Text className="fb__b">{cur.est}</Text> 分钟</Text>
            {started && <Text>{started}</Text>}
          </View>
          {paused && <Text className="fb__zz">z z</Text>}
          <Image className="fb__buddy" src={roleUri(role, theme)} mode="aspectFit" />
        </View>
        <View className="fb__tray">
          <View className="fb__trayi" />
          <View className="fb__trayi fb__trayi--tie" />
        </View>
      </View>

      <View className="fs">
        <View className="fs__l">
          <Text className="fs__ls">今天做完</Text>
          <Text className="fs__lb"><Text className="fs__li">{data.summary.done}</Text> / {data.items.length} 项</Text>
        </View>
        <View className="fs__dots">
          <View className="fs__track" />
          {flat.map((it, i) => (
            <View key={it.id} className={`fs__d${it.id === cur.id && !done ? " fs__d--cur" : it.status === "done" ? " fs__d--done" : ""}`}>
              <View className="fs__c">{it.status === "done" ? <Icon name="check" size={14} color={C.brand} stroke={3} /> : <Text>{i + 1}</Text>}</View>
              <Text>{hwSubjectLabel(it.subject).slice(0, 1)}</Text>
            </View>
          ))}
        </View>
      </View>
      {cur.planAssignmentId && (
        <View className="fz__link" hoverClass="hw-press" onClick={() => void Taro.navigateTo({ url: `/pages/plan-task/index?id=${cur.planAssignmentId}` })}>
          <Icon name="document" size={15} color={C.brand} stroke={2.2} />
          <Text>看老师布置的作业</Text>
          <Icon name="chevron-right" size={12} color={C.brand} stroke={2.6} />
        </View>
      )}

      <View className="fc">
        {paused ? (
          <View className="fc__b" onClick={() => !busy && void run(() => act(cur.id, "resume"))}>
            <View className="fc__box"><View className="fc__i" hoverClass="fc--press"><Icon name="play" size={24} color={C.brand} fill /></View></View>
            <Text>继续</Text>
          </View>
        ) : (
          <View className={`fc__b${cur.status !== "running" ? " fc__b--dis" : ""}`} onClick={() => !busy && cur.status === "running" && void run(() => act(cur.id, "pause"))}>
            <View className="fc__box"><View className="fc__i" hoverClass="fc--press"><Icon name="pause" size={24} color={C.brand} stroke={3} /></View></View>
            <Text>暂停</Text>
          </View>
        )}
        <View className={`fc__b fc__b--main${cur.status === "done" ? " fc__b--dis" : ""}`} onClick={() => !busy && cur.status !== "done" && void finish()}>
          <View className="fc__box"><View className="fc__main" hoverClass="fc--press"><Icon name="check" size={40} color="#ffffff" stroke={3.2} /></View></View>
          <Text>做完了</Text>
        </View>
        <View className="fc__b" onClick={() => setStuck(true)}>
          <View className="fc__box"><View className="fc__i" hoverClass="fc--press"><Icon name="help" size={26} color={C.brand} stroke={2.2} /></View></View>
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
      } else toList();
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
