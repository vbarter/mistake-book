import { useEffect, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useRouter } from "@tarojs/taro";
import { FocusRing, useTick } from "../../components/homework";
import { Icon, base64 } from "../../components/Icon";
import { Button, Empty, useMenuButton } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { act, clockOf, hourMin, hwSubjectLabel, liveUsed, loadTodos, mmss, useHomework, type ChalkTone, type HwAction } from "../../lib/homework";
import { roleIconSvg, type RoleName } from "../../lib/roleIcons";
import type { ThemeName } from "../../lib/colorIcons";
import { C, useTheme, useThemeClass } from "../../lib/theme";

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
/** 左上角「待办」回列表：从列表点进来的直接返回；从首页进来的（页面栈里没有列表）换成列表 */
const back = () => {
  const pages = Taro.getCurrentPages();
  if (pages.length > 1 && pages[pages.length - 2]?.route === "pages/homework/index") void Taro.navigateBack();
  else void Taro.redirectTo({ url: "/pages/homework/index" });
};
/** 圆环一圈是一小时 */
const LAP = 3600;

/**
 * 待办的时钟计时页（界面稿 screenshots/todo-simplify-v4/ 07–10）：整块计时区是一块黑板，粉笔数字是烘好的图（tools/chalk-digits.mjs）。
 * 从 00:00 往上计：点时钟开始，再点暂停，再点继续；下面只有一个「完成」，点了停表、这一项进「已归档」，可以撤销。
 * 离开这一页计时照常走（时间记在服务器上）。整页自己画（navigationStyle: custom）
 */
export default function HomeworkFocus() {
  const tc = useThemeClass();
  const theme = useTheme();
  const mb = useMenuButton();
  const id = useRouter().params.id || "";
  const { data, fetchedAt } = useHomework();
  const item = data ? data.todo.find((it) => it.id === id) ?? data.archived.find((it) => it.id === id) ?? null : null;
  const now = useTick(item?.status === "running");
  const [busy, setBusy] = useState(false);

  const load = () => loadTodos().catch((e) => toast(errorText(e)));
  useEffect(() => {
    if (!item) void load();
  }, [id]);
  useDidShow(() => void load()); // 切走再回来：按服务器上的时间对一次表

  const nav = (
    <View className="fz__nav" style={{ height: `${mb.height}px` }}>
      <View className="fz__close" hoverClass="hw-press" onClick={back}>
        <Icon name="chevron-left" size={16} color={C.label} stroke={2.6} />
        <Text>待办</Text>
      </View>
    </View>
  );
  if (!data || !item) {
    return (
      <View className={"fz" + tc} style={{ paddingTop: `${mb.top}px` }}>
        {nav}
        {data ? <Empty icon="document" title="这一项不在了" /> : <View className="empty"><View className="spinner spinner--lg" /></View>}
      </View>
    );
  }

  const run = async (action: HwAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await act(item.id, action);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const used = liveUsed(item, fetchedAt, now);
  const done = item.status === "done";
  const running = item.status === "running";
  const idle = !done && !running && used === 0;
  const paused = !done && !running && used > 0; // 暂停的，和中途换去做别的、停下来的，都是「点一下继续」
  /** 点时钟：没开始 → 开始；计时中 → 暂停；停着 → 继续 */
  const tapClock = () => {
    if (done) return;
    void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    void run(running ? "pause" : item.status === "paused" ? "resume" : "start");
  };
  const tone: ChalkTone = done ? "g" : "w";
  const role: RoleName = done ? "done" : "focus";
  const hint = idle ? "点黑板上的时钟开始计时，再点一下暂停" : running ? "离开这一页也会继续计时" : "计时已停住，点时钟接着计";

  return (
    <View className={`fz${done ? " fz--done" : paused ? " fz--paused" : ""}${tc}`} style={{ paddingTop: `${mb.top}px` }}>
      {nav}

      <View className="fb">
        <View className="fb__face">
          <View className="fb__row">
            <Text className="fb__tag">{done ? "已完成" : "待办"}</Text>
            <Text className="fb__subj">{hwSubjectLabel(item.subject)}</Text>
          </View>
          <Text className="fb__title">{item.title}</Text>
          <Image className="fb__line" src={LINE} mode="aspectFit" />
          <View className={`fb__ring${idle ? " fb__ring--idle" : ""}`} hoverClass={done ? "none" : "fb__ring--press"} onClick={tapClock}>
            <FocusRing used={done ? LAP : used % LAP} est={LAP} paused={!running} done={done} tie={C.tie} />
            <View className="fb__in">
              {!done && (
                <View className="fb__ico">
                  <Icon name={running ? "pause" : "play"} size={15} color="#ffffff" stroke={running ? 3.4 : 2} fill={!running} />
                </View>
              )}
              <View className={`fb__t${mmss(used).length > 5 ? " fb__t--long" : ""}${idle ? " fb__t--idle" : ""}`}>
                {[...mmss(used)].map((ch, i) => (
                  <Image key={i} className={ch === ":" ? "fb__tc" : "fb__td"} src={`/assets/chalk/num/${tone}-${ch === ":" ? "c" : ch}.png`} mode="aspectFit" />
                ))}
              </View>
              <Text className="fb__s">{done ? `完成啦 · 用时 ${hourMin(used)}` : idle ? "点一下开始" : running ? "计时中 · 点一下暂停" : "已暂停 · 点一下继续"}</Text>
            </View>
          </View>
          <Image className="fb__doodle fb__doodle--r" src={done ? STAR : SUN} mode="aspectFit" />
          <Image className="fb__doodle fb__doodle--l" src={STAR} mode="aspectFit" />
          {(item.firstStartedAt || done) && (
            <View className="fb__est">
              {item.firstStartedAt && <Text>{clockOf(item.firstStartedAt)} 开始</Text>}
              {done && item.finishedAt && <Text>{clockOf(item.finishedAt)} 完成</Text>}
            </View>
          )}
          {paused && <Text className="fb__zz">z z</Text>}
          <Image className="fb__buddy" src={roleUri(role, theme)} mode="aspectFit" />
        </View>
        <View className="fb__tray">
          <View className="fb__trayi" />
          <View className="fb__trayi fb__trayi--tie" />
        </View>
      </View>

      {done ? (
        <>
          <View className="fs fs--done">
            <View className="fs__ok"><Icon name="check" size={16} color="#ffffff" stroke={3} /></View>
            <View className="flex1">
              <Text className="fs__b">已完成，放进「已归档」</Text>
              <Text className="fs__s">在归档里可以重新打开</Text>
            </View>
            <Text className="fs__undo" onClick={() => void run("undo")}>撤销</Text>
          </View>
          <View className="fc fc--col">
            <Button onClick={back}>回到待办</Button>
          </View>
        </>
      ) : (
        <>
          <View className="fs fs--hint"><Text>{hint}</Text></View>
          <View className="fc">
            <View className="fc__b fc__b--main" onClick={() => void run("finish")}>
              <View className="fc__box"><View className="fc__main" hoverClass="fc--press"><Icon name="check" size={40} color="#ffffff" stroke={3.2} /></View></View>
              <Text>完成</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
