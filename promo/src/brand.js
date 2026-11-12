// 品牌素材：颜色取自小程序的 app.scss，图标直接用小程序的 lib/colorIcons.ts，吉祥物是 components/Buddy.tsx 的同一张 SVG。
import { colorIconSvg } from "../../miniprogram/src/lib/colorIcons";

export const C = {
  brand: "#1f3b73",
  brandPressed: "#162c58",
  brandTint: "#e6ebf5",
  heroA: "#2b4f96",
  heroB: "#1f3b73",
  spotA: "#eaf0fc",
  spotB: "#cfdcf6",
  pin: "#e2566a",
  tie: "#a3303f",
  tieBg: "#f8e6e8",
  label: "#1c1c1e",
  secondary: "#5b5b63",
  tertiary: "#8e8e93",
  sep: "#d1d1d6",
  sepLight: "#ececf0",
  bg: "#f3f4f8",
  wrong: "#b42323",
  wrongBg: "#fbe9e9",
  ok: "#1e7a47",
  okBg: "#e3f5ea",
  gold: "#ffb547",
  night: "#0b1530",
};

/** 小程序的彩色图标（校园蓝主题） */
export const icon = (name, size = 32, style = "") =>
  colorIconSvg(name, "classic").replace("<svg ", `<svg width="${size}" height="${size}" style="display:block;flex-shrink:0;${style}" `);

/** 细线图标（路径取自小程序 components/Icon.tsx） */
const LINE = {
  check: "M5 12l5 5 9-10",
  xmark: "M6 6l12 12M18 6L6 18",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  export: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
  printer: "M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  pencil: "M4 20h4l10-10-4-4L4 16zM12.500 7.500l4 4",
  document: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  xcircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6",
  checkcircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  search: "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.500-4.500",
  arrows: "M4 9h12l-3-3M20 15H8l3 3",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7z",
};
export const line = (name, size = 20, color = C.label, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0"><path d="${LINE[name]}"/></svg>`;

/** 微信的两个气泡 */
export const wechat = (size = 18, color = "#07c160") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" fill-rule="evenodd" style="display:block;flex-shrink:0"><path d="M9.200 3.600c-4.300 0-7.700 2.900-7.700 6.500 0 2 1.100 3.800 2.800 5l-.8 2.400 2.800-1.400c.9.250 1.700.4 2.600.450-.150-.5-.2-1-.2-1.550 0-3.300 3.100-6 7-6 .3 0 .6 0 .9.050C16.050 5.900 12.950 3.600 9.200 3.600zM6.600 7.300a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM11.800 7.300a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/><path d="M22.500 15c0-2.900-2.900-5.200-6.300-5.200s-6.300 2.300-6.300 5.200 2.900 5.200 6.300 5.200c.7 0 1.400-.1 2.100-.3l2.200 1.200-.6-2c1.600-1 2.600-2.400 2.600-4.100zM14.100 13.300a.850.850 0 1 1 0 1.700.850.850 0 0 1 0-1.700zM18.300 13.300a.850.850 0 1 1 0 1.700.850.850 0 0 1 0-1.700z"/></svg>`;

/** 试卷小人。scene：hero 拿铅笔 · chart 举柱状图 · empty 打招呼。parts 拆成几组，方便分别做动画 */
export function buddy(scene = "hero", size = 160) {
  const K = { paper: "#ffffff", paper2: "#dfe6f6", line: C.brand, ink: "#1c2a4a", cheek: "#ffb4a8", tie: C.tie, star: C.gold, ok: "#1e9e5a", okBg: "#dcf5e7", shadow: "rgba(31,59,115,.16)", brand: C.brand };
  const hand =
    scene === "empty"
      ? `<path class="bd-hand" d="M112 78q14-6 16-20" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>`
      : `<path d="M112 84q10 2 14-6" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>`;
  const prop =
    scene === "hero"
      ? `<rect x="120" y="52" width="9" height="34" rx="3" fill="${K.tie}" transform="rotate(28 124 69)"/><path d="M115 85l5 8 3-9z" fill="${K.ink}" opacity=".7"/>`
      : scene === "chart"
        ? `<rect x="118" y="44" width="34" height="30" rx="6" fill="${K.paper}" stroke="${K.line}" stroke-width="2"/><rect x="124" y="58" width="5" height="10" rx="1.5" fill="${K.brand}"/><rect x="132" y="52" width="5" height="16" rx="1.5" fill="${K.brand}"/><rect x="140" y="62" width="5" height="6" rx="1.5" fill="${K.tie}"/>`
        : "";
  return (
    `<svg class="buddy" width="${size}" height="${size}" viewBox="0 0 160 160" fill="none" style="display:block;overflow:visible">` +
    `<ellipse class="bd-shadow" cx="80" cy="148" rx="38" ry="6" fill="${K.shadow}"/>` +
    `<g class="bd-body">` +
    `<rect x="52" y="22" width="68" height="88" rx="12" fill="${K.paper2}" transform="rotate(8 86 66)"/>` +
    `<rect x="40" y="26" width="72" height="96" rx="14" fill="${K.paper}" stroke="${K.line}" stroke-width="2.5"/>` +
    `<path d="M52 42h36M52 52h48M52 62h28" stroke="${K.ink}" stroke-width="4" stroke-linecap="round" opacity=".18"/>` +
    `<g class="bd-eyes"><ellipse cx="64" cy="86" rx="4" ry="5" fill="${K.ink}"/><ellipse cx="88" cy="86" rx="4" ry="5" fill="${K.ink}"/></g>` +
    `<path d="M70 98q6 6 12 0" stroke="${K.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="56" cy="96" r="5" fill="${K.cheek}"/><circle cx="96" cy="96" r="5" fill="${K.cheek}"/>` +
    `<path d="M58 122l18-12 18 12" fill="${K.line}"/>` +
    `<path d="M70 110l6 5 6-5" fill="#ffffff" stroke="${K.line}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M76 114l-4 3 2 4-3 9 5 4 5-4-3-9 2-4z" fill="${K.tie}"/>` +
    hand +
    `<path d="M40 88q-10 4-12 14" stroke="${K.line}" stroke-width="5" stroke-linecap="round"/>` +
    prop +
    `</g>` +
    `<g class="bd-f1"><circle cx="26" cy="40" r="11" fill="${K.okBg}"/><path d="M21 40l4 4 7-8" stroke="${K.ok}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `<path class="bd-f2" d="M136 20l2.500 6 6 2.500-6 2.500-2.500 6-2.500-6-6-2.500 6-2.500z" fill="${K.star}"/>` +
    `<path class="bd-f3" d="M22 112l1.800 4.200 4.200 1.800-4.200 1.800-1.800 4.200-1.800-4.200-4.200-1.800 4.200-1.800z" fill="${scene === "hero" ? "#8fa6dc" : K.brand}"/>` +
    `</svg>`
  );
}

/** 首页左上角的标志：白色圆角方块 + 对勾 + 下面一颗红色菱形 */
export const logo = (size = 26) =>
  `<span class="logo" style="width:${size}px;height:${size}px;border-radius:${size * 0.31}px">${line("check", size * 0.66, C.brand, 3)}<i style="width:${size * 0.31}px;height:${size * 0.31}px;margin-left:${-size * 0.155}px;bottom:${-size * 0.115}px;border-radius:${size * 0.08}px"></i></span>`;

/** 四角星 */
export const star = (size = 14, color = C.gold) => `<svg width="${size}" height="${size}" viewBox="-8 -8 16 16" style="display:block"><path d="M0-8l2.200 5.800L8 0 2.200 2.200 0 8l-2.200-5.800L-8 0l5.800-2.200z" fill="${color}"/></svg>`;
