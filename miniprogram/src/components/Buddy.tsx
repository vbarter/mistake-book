/**
 * 插画「试卷小人」（和 App 的 components/Illustration.tsx 同一张图）：小程序里画成 SVG 图片，整体轻轻漂浮。
 * scene：hero 首页（拿着铅笔）· scan 识别中（扫描线）· chart 错题榜（举着小柱状图）· empty 空状态（打招呼）
 */
import { Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { CSSProperties } from "react";
import { base64 } from "./Icon";

export type Scene = "hero" | "scan" | "chart" | "empty";

const K = {
  paper: "#ffffff",
  paper2: "#dbe2f0",
  line: "#1f3b73",
  ink: "#1f2a44",
  cheek: "#ffb4a8",
  tie: "#a3303f",
  star: "#e0b252",
  ok: "#1e9e5a",
  okBg: "#dcf5e7",
  shadow: "rgba(31,42,68,0.12)",
  brand: "#1f3b73",
};

function svg(scene: Scene): string {
  const hand =
    scene === "empty"
      ? `<path d="M112 78q14-6 16-20" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>`
      : `<path d="M112 84q10 2 14-6" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>`;
  const prop =
    scene === "hero"
      ? `<rect x="120" y="52" width="9" height="34" rx="3" fill="${K.tie}" transform="rotate(28 124 69)"/><path d="M115 85l5 8 3-9z" fill="${K.ink}" opacity=".7"/>`
      : scene === "chart"
        ? `<rect x="118" y="44" width="34" height="30" rx="6" fill="${K.paper}" stroke="${K.line}" stroke-width="2"/><rect x="124" y="58" width="5" height="10" rx="1.5" fill="${K.brand}"/><rect x="132" y="52" width="5" height="16" rx="1.5" fill="${K.brand}"/><rect x="140" y="62" width="5" height="6" rx="1.5" fill="${K.tie}"/>`
        : scene === "scan"
          ? `<rect x="36" y="70" width="80" height="4" rx="2" fill="${K.brand}" opacity=".85"/>`
          : "";
  const floats =
    scene === "scan"
      ? ""
      : `<circle cx="26" cy="40" r="11" fill="${K.okBg}"/><path d="M21 40l4 4 7-8" stroke="${K.ok}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M136 20l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="${K.star}"/>` +
        `<path d="M22 112l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" fill="${K.brand}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 160 160" fill="none">` +
    `<ellipse cx="80" cy="148" rx="38" ry="6" fill="${K.shadow}"/>` +
    `<rect x="52" y="22" width="68" height="88" rx="12" fill="${K.paper2}" transform="rotate(8 86 66)"/>` +
    `<rect x="40" y="26" width="72" height="96" rx="14" fill="${K.paper}" stroke="${K.line}" stroke-width="2.5"/>` +
    `<path d="M52 42h36M52 52h48M52 62h28" stroke="${K.ink}" stroke-width="4" stroke-linecap="round" opacity=".18"/>` +
    `<ellipse cx="64" cy="86" rx="4" ry="5" fill="${K.ink}"/><ellipse cx="88" cy="86" rx="4" ry="5" fill="${K.ink}"/>` +
    `<path d="M70 98q6 6 12 0" stroke="${K.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="56" cy="96" r="5" fill="${K.cheek}"/><circle cx="96" cy="96" r="5" fill="${K.cheek}"/>` +
    `<path d="M58 122l18-12 18 12" fill="${K.line}"/>` +
    `<path d="M70 110l6 5 6-5" fill="#ffffff" stroke="${K.line}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M76 114l-4 3 2 4-3 9 5 4 5-4-3-9 2-4z" fill="${K.tie}"/>` +
    hand +
    `<path d="M40 88q-10 4-12 14" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>` +
    prop +
    floats +
    `</svg>`
  );
}

const cache = new Map<Scene, string>();
const uri = (scene: Scene) => {
  let u = cache.get(scene);
  if (!u) {
    u = `data:image/svg+xml;base64,${base64(svg(scene))}`;
    cache.set(scene, u);
  }
  return u;
};

export function Buddy({ scene = "hero", size = 140, style }: { scene?: Scene; size?: number; style?: CSSProperties }) {
  return <Image className="buddy" src={uri(scene)} mode="aspectFit" style={{ width: Taro.pxTransform(size), height: Taro.pxTransform(size), ...style }} />;
}
