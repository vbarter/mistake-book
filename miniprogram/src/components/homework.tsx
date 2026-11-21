/** 待办事项几个页面共用的小块 */
import { useEffect, useState } from "react";
import { Image, View } from "@tarojs/components";
import { ColorIcon } from "./ColorIcon";
import { base64 } from "./Icon";
import { Button, Empty } from "./ui";
import { ensureLogin } from "../lib/auth";
import { focusRingSvg } from "../lib/homework";

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
      <Empty art={<ColorIcon name="todo" size={72} />} title="登录后使用待办事项" text="待办存在服务器上，换手机也在">
        <Button size="sm" onClick={() => void ensureLogin("使用待办事项")} style={{ width: "auto", padding: "0 24px" }}>
          微信登录
        </Button>
      </Empty>
    </View>
  );
}

/** 计时页黑板上的粉笔圆环（小程序没有内联 SVG：画成 SVG 图片，232×232）。画法在 lib/homework.ts focusRingSvg，和 App 一致 */
export function FocusRing({ used, est, paused, done, tie }: { used: number; est: number; paused: boolean; done: boolean; tie: string }) {
  return <Image className="fb__ringimg" src={`data:image/svg+xml;base64,${base64(focusRingSvg({ used, est, paused, done, tie }))}`} />;
}
