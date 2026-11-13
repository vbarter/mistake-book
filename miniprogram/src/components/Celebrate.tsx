/**
 * 庆祝层（和 App 的 components/Celebrate.tsx 对应）：做成一件事时，小人跳出来举手、撒一把纸屑、一句话，约 1.8 秒自己收起。
 * 不接触摸（pointer-events: none），不挡下面的操作；动画全在样式里（app.scss 的 .cele），这里只管摆节点和到点收起。
 * 用法：const [cele, celebrate] = useCelebrate(); celebrate({ title: "交上啦！", sub: "…" }); 页面里放 {cele}。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { buddyUri } from "./Buddy";
import { C, ILLUST, useTheme } from "../lib/theme";

export type Cheer = { title: string; sub?: string; /** 大场面（比如作业全交齐）：纸屑多一些 */ big?: boolean };

const LIFE = 1900; // 和 .cele 的动画总长一致

/** 一把纸屑：每片的落点、转角、延迟、大小固定算出来（不用随机数，每次样子一样、不重排） */
function bits(n: number, colors: string[]): string[] {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const px = (v: number) => Taro.pxTransform(Math.round(v));
  return Array.from({ length: n }, (_, i) => {
    const a = ((-90 + (r() - 0.5) * 150) * Math.PI) / 180;
    const d = 100 + r() * 120;
    const w = 6 + r() * 5;
    const round = r() < 0.3;
    return `--x:${px(Math.cos(a) * d)};--y:${px(Math.sin(a) * d + 80)};--r:${Math.round(r() * 720 - 360)}deg;animation-delay:${150 + Math.round(r() * 120)}ms;width:${px(w)};height:${px(round ? w : w * 1.8)};background:${colors[i % colors.length]};border-radius:${round ? "50%" : px(2)}`;
  });
}

export function Celebrate({ cheer, onDone }: { cheer: Cheer; onDone: () => void }) {
  const theme = useTheme();
  useEffect(() => {
    const t = setTimeout(onDone, LIFE);
    return () => clearTimeout(t);
  }, [onDone]);
  const list = useMemo(() => bits(cheer.big ? 34 : 22, [C.brandSolid, ILLUST.tie, ILLUST.star, C.ok, C.accent, "#ffb4a8"]), [cheer.big, theme]);
  return (
    <View className="cele">
      <View className="cele__veil" />
      <View className="cele__burst">
        {list.map((st, i) => (
          // Taro 的 style 可以直接给字符串；这里要带 CSS 变量，用字符串最稳
          <View key={i} className="cele__bit" style={st as unknown as CSSProperties} />
        ))}
      </View>
      <View className="cele__center">
        <Image className="cele__buddy" src={buddyUri("cheer")} mode="aspectFit" />
        <Text className="cele__title">{cheer.title}</Text>
        {cheer.sub ? <Text className="cele__sub">{cheer.sub}</Text> : null}
      </View>
    </View>
  );
}

/** [要放进页面的节点, 触发一次庆祝]；连着触发时后一次顶掉前一次、从头播 */
export function useCelebrate(): [ReactNode, (c: Cheer) => void] {
  const [cur, setCur] = useState<(Cheer & { n: number }) | null>(null);
  const done = useCallback(() => setCur(null), []);
  const fire = useCallback((c: Cheer) => setCur((p) => ({ ...c, n: (p?.n ?? 0) + 1 })), []);
  return [cur ? <Celebrate key={cur.n} cheer={cur} onDone={done} /> : null, fire];
}
