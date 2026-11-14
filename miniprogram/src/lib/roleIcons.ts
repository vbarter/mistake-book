/**
 * 角色图标：首页四块黑板上的「试卷小人」，各拿一样东西（待办事项拿夹板清单、学习计划拿台历、错题收集拿打叉的卷子、试卷擦除举板擦）。
 * 身体和插画 Buddy（App components/Illustration.tsx、小程序 components/Buddy.tsx）是同一张画，只是整体左移 16 给道具让位。160×160 画布。
 * 两套主题 × 深浅色各一份配色，和 tokens.css 的 --ill-* 同一套值。设计稿和 SVG 素材在项目文件 screenshots/home-blackboard/。
 * 这个文件 App 和小程序各放一份，内容保持一致（app/src/lib/roleIcons.ts ↔ miniprogram/src/lib/roleIcons.ts）。
 */
import type { ThemeName } from "./colorIcons";

export type RoleName = "todo" | "plan" | "wrong" | "erase";
interface Palette { paper: string; paper2: string; line: string; ink: string; cheek: string; tie: string; star: string; ok: string; okbg: string; shadow: string; wrong: string; wrongbg: string; soft: string }

const PALETTES: Record<string, Palette> = {
  classic:        { paper: "#ffffff", paper2: "#dbe2f0", line: "#1f3b73", ink: "#1f2a44", cheek: "#ffb4a8", tie: "#a3303f", star: "#e0b252", ok: "#1e9e5a", okbg: "#dcf5e7", shadow: "rgba(31,42,68,.12)", wrong: "#d23a3a", wrongbg: "#fde0e4", soft: "#dbe6fb" },
  "classic-dark": { paper: "#f4f6ff", paper2: "#33456e", line: "#b4c6f0", ink: "#1f2a44", cheek: "#ff9d90", tie: "#e07a86", star: "#e0b252", ok: "#1e9e5a", okbg: "#dcf5e7", shadow: "rgba(0,0,0,.45)", wrong: "#d23a3a", wrongbg: "#fde0e4", soft: "#dbe6fb" },
  pop:            { paper: "#ffffff", paper2: "#ffd6e2", line: "#f4608f", ink: "#4a2a36", cheek: "#ffb4a8", tie: "#00aeec", star: "#ffc53d", ok: "#00aeec", okbg: "#d3f1fd", shadow: "rgba(120,40,70,.12)", wrong: "#f4608f", wrongbg: "#ffe3ec", soft: "#d3f1fd" },
  "pop-dark":     { paper: "#f4f6ff", paper2: "#5a2c3d", line: "#ff8fb0", ink: "#2a1a22", cheek: "#ff9d90", tie: "#5cc8f0", star: "#ffc53d", ok: "#00aeec", okbg: "#d3f1fd", shadow: "rgba(0,0,0,.45)", wrong: "#f4608f", wrongbg: "#ffe3ec", soft: "#d3f1fd" },
};
export const ROLE_NAMES: Record<RoleName, string> = { todo: "待办事项", plan: "学习计划", wrong: "错题收集", erase: "试卷擦除" };

function inner(scene: RoleName, p: Palette, shadow: boolean): string {
  const S = `stroke="${p.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  const arm = (d: string) => `<path d="${d}" stroke="${p.line}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
  const happy = scene === "erase";
  const face = happy
    ? `<path d="M60 87q4-6 8 0M84 87q4-6 8 0" stroke="${p.ink}" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M68 97q8 9 16 0z" fill="${p.ink}"/>`
    : scene === "wrong"
    ? `<ellipse cx="64" cy="86" rx="4" ry="5" fill="${p.ink}"/><ellipse cx="88" cy="86" rx="4" ry="5" fill="${p.ink}"/><path d="M70 97q6 8 12 0z" fill="${p.ink}"/>`
    : `<ellipse cx="64" cy="86" rx="4" ry="5" fill="${p.ink}"/><ellipse cx="88" cy="86" rx="4" ry="5" fill="${p.ink}"/><path d="M70 98q6 6 12 0" stroke="${p.ink}" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  const body = `<g transform="translate(-16 0)">
    <rect x="52" y="22" width="68" height="88" rx="12" fill="${p.paper2}" transform="rotate(8 86 66)"/>
    <rect x="40" y="26" width="72" height="96" rx="14" fill="${p.paper}" stroke="${p.line}" stroke-width="2.5"/>
    <path d="M52 42h36M52 52h48M52 62h28" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".18"/>
    ${face}
    <circle cx="56" cy="96" r="5" fill="${p.cheek}"/><circle cx="96" cy="96" r="5" fill="${p.cheek}"/>
    <path d="M58 122l18-12 18 12" fill="${p.line}"/><path d="M70 110l6 5 6-5" fill="#ffffff" stroke="${p.line}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M76 114l-4 3 2 4-3 9 5 4 5-4-3-9 2-4z" fill="${p.tie}"/>
  </g>`;
  const armL = arm("M24 88q-10 4-12 14");
  const spark = (x: number, y: number, k: number, c: string) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0-8l2.5 5.5L8 0 2.5 2.5 0 8l-2.5-5.5L-8 0l5.5-2.5z" fill="${c}"/>`;
  let prop = "";
  if (scene === "todo") {
    // 夹板清单：两项打了勾，一项还空着；另一只手拿铅笔
    prop = `<g transform="rotate(6 124 92)">
      <rect x="102" y="64" width="46" height="58" rx="8" fill="${p.paper}" ${S}/>
      <rect x="115" y="57" width="20" height="13" rx="5" fill="${p.line}"/>
      <rect x="109" y="78" width="10" height="10" rx="3" fill="${p.okbg}" stroke="${p.ok}" stroke-width="2"/><path d="M111.5 83l2 2 3.5-4" stroke="${p.ok}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <rect x="109" y="92" width="10" height="10" rx="3" fill="${p.okbg}" stroke="${p.ok}" stroke-width="2"/><path d="M111.5 97l2 2 3.5-4" stroke="${p.ok}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <rect x="109" y="106" width="10" height="10" rx="3" fill="${p.paper}" stroke="${p.line}" stroke-width="2"/>
      <path d="M124 83h16M124 97h12M124 111h16" stroke="${p.ink}" stroke-width="3.5" stroke-linecap="round" opacity=".22"/>
    </g>` + arm("M96 96q4 8 10 10") +
      `<g transform="rotate(30 16 100)"><rect x="9.5" y="72" width="9" height="30" rx="3" fill="${p.tie}"/><path d="M9.5 102l4.5 9 4.5-9z" fill="${p.ink}" opacity=".75"/></g>` + arm("M24 90q-8 4-10 12") +
      spark(140, 44, 1, p.star);
    return wrap(body + prop, p, shadow);
  }
  if (scene === "plan") {
    // 台历：今天那格是领带色
    const cell = (cx: number, cy: number, on?: boolean) => `<rect x="${cx}" y="${cy}" width="8" height="7" rx="2" fill="${on ? p.tie : p.paper2}"/>`;
    prop = `<g transform="rotate(5 126 90)">
      <rect x="103" y="64" width="46" height="50" rx="8" fill="${p.paper}" ${S}/>
      <path d="M103 80v-8a8 8 0 0 1 8-8h30a8 8 0 0 1 8 8v8z" fill="${p.line}"/>
      <path d="M115 58v10M126 58v10M137 58v10" stroke="${p.paper}" stroke-width="5.5" stroke-linecap="round"/><path d="M115 58v10M126 58v10M137 58v10" stroke="${p.line}" stroke-width="2.5" stroke-linecap="round"/>
      ${cell(110, 86)}${cell(122, 86)}${cell(134, 86)}${cell(110, 98)}${cell(122, 98, true)}${cell(134, 98)}
    </g>` + arm("M96 88q6 3 12 0") + armL + spark(146, 46, .9, p.star);
    return wrap(body + prop, p, shadow);
  }
  if (scene === "wrong") {
    // 一张打了叉的卷子，另一只手拿红笔
    prop = `<g transform="rotate(12 126 90)">
      <rect x="104" y="58" width="42" height="56" rx="7" fill="${p.paper}" ${S}/>
      <path d="M112 70h18M112 79h26" stroke="${p.ink}" stroke-width="3.5" stroke-linecap="round" opacity=".22"/>
      <circle cx="126" cy="97" r="10.5" fill="${p.wrongbg}" stroke="${p.wrong}" stroke-width="2.5"/>
      <path d="M121.5 92.5l9 9M130.5 92.5l-9 9" stroke="${p.wrong}" stroke-width="3" stroke-linecap="round"/>
    </g>` + arm("M96 94q4 6 9 7") +
      `<g transform="rotate(30 16 100)"><rect x="9.5" y="72" width="9" height="30" rx="3" fill="${p.wrong}"/><path d="M9.5 102l4.5 9 4.5-9z" fill="${p.ink}" opacity=".75"/></g>` + arm("M24 90q-8 4-10 12") +
      `<path d="M134 44l3-7M143 50l7-4M126 42l-1-7" stroke="${p.star}" stroke-width="3" stroke-linecap="round"/>`;
    return wrap(body + prop, p, shadow);
  }
  // erase：举着板擦，擦过的地方留下一道干净的弧线
  prop = `<path d="M150 104q10-34-22-52" stroke="${p.soft}" stroke-width="13" stroke-linecap="round" fill="none" opacity=".9"/>
    <path d="M150 104q10-34-22-52" stroke="${p.paper}" stroke-width="3" stroke-linecap="round" fill="none" opacity=".95" stroke-dasharray="1 9"/>
    ` + arm("M96 84q12-4 18-18") +
    `<g transform="rotate(-32 120 54)">
      <rect x="100" y="43" width="40" height="22" rx="7" fill="${p.tie}" ${S}/>
      <path d="M100 55h40v3a7 7 0 0 1-7 7h-26a7 7 0 0 1-7-7z" fill="${p.paper}" ${S}/>
    </g>` + armL + spark(146, 118, .9, p.star) + spark(102, 24, .6, p.star);
  return wrap(body + prop, p, shadow);
}
function wrap(svg: string, p: Palette, shadow: boolean): string {
  return (shadow ? `<ellipse cx="78" cy="148" rx="46" ry="6" fill="${p.shadow}"/>` : "") + svg;
}

/** SVG 里面的内容（不带外层 <svg>），viewBox 0 0 160 160。shadow：脚下的影子，贴在黑板上时不要 */
export function roleIconInner(name: RoleName, theme: ThemeName, dark = false, shadow = true): string {
  return inner(name, PALETTES[dark ? `${theme}-dark` : theme], shadow);
}
export function roleIconSvg(name: RoleName, theme: ThemeName, dark = false, shadow = true): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" fill="none">${roleIconInner(name, theme, dark, shadow)}</svg>`;
}
