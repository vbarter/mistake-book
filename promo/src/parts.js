// 几幕共用的画面零件：手机外壳、状态栏、底部导航、示意试卷、顶部标题。
import { C, icon, line, logo, buddy } from "./brand.js";
import { chars, p, st, E, riseChars } from "./engine.js";

export const statusBar = (color = "#fff") =>
  `<div class="ui__status" style="color:${color}"><span>9:41</span><span><svg width="17" height="11" viewBox="0 0 17 11" fill="${color}"><rect x="0" y="7" width="3" height="4" rx=".8"/><rect x="4.600" y="5" width="3" height="6" rx=".8"/><rect x="9.200" y="2.500" width="3" height="8.500" rx=".8"/><rect x="13.800" y="0" width="3" height="11" rx=".8"/></svg><i class="bat"></i></span></div>`;

export const phone = (inner, cls = "") =>
  `<div class="phone ${cls}"><div class="phone__screen">${inner}<div class="phone__island"></div><div class="phone__glare"></div></div></div>`;

export const tabbar = (on = 0) => {
  const tabs = [["home", "首页"], ["papers", "试卷"], null, ["analysis", "分析"], ["me", "我的"]];
  return `<div class="tabbar">${tabs
    .map((t, i) => (t ? `<div class="${(i > 2 ? i - 1 : i) === on ? "on" : "off"}">${icon(t[0], 26)}<span>${t[1]}</span></div>` : `<div><div class="cam">${line("camera", 28, "#fff", 1.9)}</div></div>`))
    .join("")}</div>`;
};

/** 每一幕顶部的标题：序号 + 功能名、大标题、一句说明 */
export const caption = (no, name, title, sub, dark = false) =>
  `<div class="cap${dark ? " cap--dark" : ""}"><div class="cap__k"><b>${no}</b><span>${name}</span></div><h2 class="cap__h">${title
    .split(/(<em>.*?<\/em>)/)
    .map((s) => (s.startsWith("<em>") ? `<em>${chars(s.slice(4, -5))}</em>` : chars(s)))
    .join("")}</h2><p class="cap__s">${sub}</p></div>`;

export function capAnim(ctx, lt, start = 0.15) {
  const k = p(lt, start, start + 0.5, E.out5);
  st(ctx.q(".cap__k"), { x: (1 - k) * -30, o: k });
  riseChars(ctx.qa(".cap__h .ch"), lt, start + 0.18, { gap: 0.05, dur: 0.6, dy: 34 });
  const s = p(lt, start + 0.65, start + 1.2, E.out5);
  st(ctx.q(".cap__s"), { y: (1 - s) * 16, o: s * 0.82 });
}

/** 手机的三维姿态 */
export function pose(el, { x = 0, y = 0, rx = 0, ry = 0, rz = 0, s = 1, o = 1 } = {}) {
  el.style.transform = `perspective(1500px) translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${s.toFixed(4)})`;
  el.style.opacity = o.toFixed(3);
}

const mark = (ok) =>
  ok
    ? `<svg class="hw mk" width="26" height="22" viewBox="0 0 26 22" fill="none"><path d="M3 12l6 7L23 3" stroke="#d23a3a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg class="hw mk" width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 4l14 14M18 3L4 19" stroke="#d23a3a" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/** 示意试卷（内容是为视频编的例题）。hw=false 时不带手写作答和批改，就是「原题空白卷」 */
export function testPaper(hw = true) {
  const a = (s) => `<i class="hw"${hw ? "" : ' style="visibility:hidden"'}>${s}</i>`;
  const m = (ok) => (hw ? mark(ok) : "");
  return (
    `<div class="tp">` +
    `<div class="tp__title">七年级数学期中练习<small>（满分100分）</small></div>` +
    `<div class="tp__meta">姓名：<u>${a("小蔡")}</u>　班级：<u>${a("七(2)")}</u>　得分：<u>&nbsp;</u></div>` +
    (hw ? `<div class="tp__score hw">85</div>` : "") +
    `<div class="tp__sec">一、填空题（每空3分）</div>` +
    `<div class="tp__q">1. 计算：3×(−4) + 12 = <u>${a("0")}</u>。${m(true)}</div>` +
    `<div class="tp__q">2. 若 x + 5 = 12，则 x = <u>${a("7")}</u>。${m(true)}</div>` +
    `<div class="tp__q">3. 一个三角形的两个内角是 40° 和 75°，第三个角是 <u>${a("75")}</u>°。${m(false)}</div>` +
    `<div class="tp__sec">二、选择题（每题4分）</div>` +
    `<div class="tp__q">4. 下列各数中最小的是（ ${a("B")} ）${m(false)}</div><div class="tp__opt">A.−3 B.0 C.2 D.−1</div>` +
    `<div class="tp__q">5. 方程 2x − 6 = 0 的解是（ ${a("B")} ）${m(true)}</div><div class="tp__opt">A.x=2 B.x=3 C.x=−3 D.x=6</div>` +
    `<div class="tp__sec">三、解答题</div>` +
    `<div class="tp__q">6. 如图，已知 ∠1 = 50°，AB∥CD，求 ∠2 的度数。</div>` +
    `<svg class="tp__fig" width="170" height="92" viewBox="0 0 170 92" fill="none" stroke="#26262a" stroke-width="1.1"><path d="M8 22h140M4 74h140M104 4L42 90"/><g fill="#26262a" stroke="none" font-size="9" font-family="serif"><text x="2" y="18">A</text><text x="151" y="24">B</text><text x="0" y="86">C</text><text x="147" y="78">D</text><text x="96" y="34">1</text><text x="46" y="70">2</text></g></svg>` +
    (hw ? `<div class="tp__work hw">∠2 = 180° − 50° = 130°</div>` : "") +
    `</div>`
  );
}

/** 首页（和小程序 pages/home 同一套布局）。scanning：显示「正在识别」卡片 */
export function homeScreen({ scanning = true } = {}) {
  return (
    `<div class="ui">${statusBar()}<div class="capsule"></div>` +
    `<div class="h4__hero"><div class="h4__spot"></div><div class="abs hero-buddy" style="right:8px;bottom:30px">${buddy("hero", 150)}</div>` +
    `<div class="h4__brand">${logo(26)}<span class="h4__bname">上壹课</span><span class="h4__date">11月12日 周四</span></div>` +
    `<span class="h4__hi">下午好，小蔡</span><div class="h4__pill"><span class="h4__pilln">2</span><span>份作业待交</span></div></div>` +
    `<div class="h4">` +
    `<div class="h4__acts"><div class="h4__act">${icon("collect", 72, "position:absolute;right:8px;top:8px")}<span class="h4__actt">错题收集</span></div><div class="h4__act h4__act--b">${icon("erase", 72, "position:absolute;right:8px;top:8px")}<span class="h4__actt">试卷擦除</span></div></div>` +
    (scanning
      ? `<div class="h4__card scan-card">${icon("scan", 44)}<div class="h4__main"><span class="h4__name">正在识别 七年级数学期中练习</span><div class="progress"><i class="scan-bar"></i></div></div><span class="h4__pct num scan-pct">0%</span></div>`
      : "") +
    `<div><div class="h4__sech"><span class="h4__sect">学习计划</span><div class="h4__add">${line("plus", 13, "#fff", 3)}<span>新建</span></div></div>` +
    `<div class="h4__plans">` +
    `<div class="h4__plan"><div class="avatar">王</div><div class="h4__main"><span class="h4__name">七（2）班数学</span><div class="h4__sub"><span>王老师</span><span style="color:#a3303f;font-weight:600">明天 21:00 截止</span></div></div><div class="ring"><span>1/3</span></div></div>` +
    `<div class="h4__plan"><div class="avatar" style="background:#f8e6e8;color:#a3303f">英</div><div class="h4__main"><span class="h4__name">寒假英语打卡</span><div class="h4__sub"><span>我建的</span><span>都批完了</span></div></div>${icon("done", 40)}</div>` +
    `</div></div></div>` +
    tabbar(0) +
    `</div>`
  );
}

export { C };
