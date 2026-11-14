// 几幕共用的画面零件：手机外壳、状态栏、底部导航、示意试卷、顶部标题。
import { C, icon, line, logo, buddy } from "./brand.js";
import { chars, p, st, E, riseChars, lerp, spring, inOut } from "./engine.js";

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
export function homeScreen({ scanning = true, todo = 2 } = {}) {
  return (
    `<div class="ui">${statusBar()}<div class="capsule"></div>` +
    `<div class="h4__hero"><div class="h4__spot"></div><div class="abs hero-buddy" style="right:8px;bottom:30px">${buddy("hero", 150)}</div>` +
    `<div class="h4__brand">${logo(26)}<span class="h4__bname">上壹课</span><span class="h4__date">11月12日 周四</span></div>` +
    `<span class="h4__hi">下午好，小蔡</span><div class="h4__pill"><span class="h4__pilln">${todo}</span><span>份作业待交</span></div></div>` +
    `<div class="h4">` +
    `<div class="h4__acts"><div class="h4__act">${icon("collect", 72, "position:absolute;right:8px;top:8px")}<span class="h4__actt">错题收集</span></div><div class="h4__act h4__act--b">${icon("erase", 72, "position:absolute;right:8px;top:8px")}<span class="h4__actt">试卷擦除</span></div></div>` +
    (scanning
      ? `<div class="h4__card scan-card">${icon("scan", 44)}<div class="h4__main"><span class="h4__name">正在识别 七年级数学期中练习</span><div class="progress"><i class="scan-bar"></i></div></div><span class="h4__pct num scan-pct">0%</span></div>`
      : "") +
    `<div><div class="h4__sech"><span class="h4__sect">学习计划</span><div class="h4__add">${line("plus", 13, "#fff", 3)}<span>新建</span></div></div>` +
    `<div class="h4__plans">` +
    `<div class="h4__plan"><div class="avatar" style="background:#f8e6e8;color:#a3303f">王</div><div class="h4__main"><span class="h4__name">七（2）班数学</span><div class="h4__sub">${icon("plan-joined", 18)}<span>王老师</span></div></div></div>` +
    `<div class="h4__plan"><div class="avatar">李</div><div class="h4__main"><span class="h4__name">初一英语晨读</span><div class="h4__sub">${icon("plan-joined", 18)}<span>李老师</span></div></div></div>` +
    `</div></div></div>` +
    tabbar(0) +
    `</div>`
  );
}

export { C };

/* ───────── 分步流程片用的零件 ───────── */

/** 做完的作业（示意内容）：有手写作答，还没有批改 */
export function worksheet() {
  const a = (s) => `<i class="hw">${s}</i>`;
  return (
    `<div class="tp">` +
    `<div class="tp__title">第三单元练习卷</div>` +
    `<div class="tp__meta">姓名：<u>${a("小蔡")}</u>　班级：<u>${a("七(2)")}</u></div>` +
    `<div class="tp__sec">一、计算</div>` +
    `<div class="tp__q">1. (−8) + 15 = <u>${a("7")}</u></div>` +
    `<div class="tp__q">2. 12 − (−5) = <u>${a("17")}</u></div>` +
    `<div class="tp__q">3. (−3) × 6 = <u>${a("−18")}</u></div>` +
    `<div class="tp__q">4. (−24) ÷ (−4) = <u>${a("6")}</u></div>` +
    `<div class="tp__sec">二、解方程</div>` +
    `<div class="tp__q">5. 3x − 7 = 11</div><div class="tp__opt hw" style="display:block;transform:skewX(-10deg) rotate(-2deg)">3x = 18，x = 6</div>` +
    `<div class="tp__q">6. 2(x + 4) = 20</div><div class="tp__opt hw" style="display:block;transform:skewX(-10deg) rotate(-2deg)">x + 4 = 10，x = 6</div>` +
    `<div class="tp__sec">三、应用题</div>` +
    `<div class="tp__q">7. 一支笔 3 元，小明买了 x 支，付了 20 元找回 2 元，求 x。</div>` +
    `<div class="tp__opt hw" style="display:block;transform:skewX(-10deg) rotate(-2deg)">3x = 20 − 2，x = 6　答：买了 6 支</div>` +
    `</div>`
  );
}

/** 连拍相机（和小程序 pages/camera 同一套布局） */
export const camScreen = (paper, label = "扫描试卷") =>
  `<div class="ui camui">${statusBar()}<div class="capsule"></div><div class="cam__auto">自动拍</div>` +
  `<div class="cam__view"><div class="cam__paper">${paper}</div><div class="cam__frame"><div class="cam__q"><i></i><i></i><i></i><i></i></div></div>` +
  `<div class="cam__pill">${line("check", 18, "#fff", 2.8)}框住了，拿稳别动</div><div class="cam__fly">${paper}</div>` +
  `<div class="cam__thumb"><div class="pg pg2"></div><div class="pg pg1"><div class="mini">${paper}</div></div><b class="num">1</b></div></div>` +
  `<div class="cam__bottom"><span class="cam__label">${label}</span><div class="cam__shutter"><i></i></div><div class="cam__done">完成<b class="num">1</b></div></div><div class="cam__flash"></div></div>`;

/** 相机的动画。lt：相机出现以来的秒数；shots：按快门的时刻；doneAt：点「完成」的时刻 */
export function camAnim(root, lt, shots, doneAt) {
  const q = (s) => root.querySelector(s);
  const bases = [{ x: 50, y: 78, r: -3 }, { x: 44, y: 72, r: 2.5 }];
  let k = shots.findIndex((s) => lt < s + 0.55);
  const after = k < 0;
  if (after) k = shots.length - 1;
  const base = bases[k % 2];
  const start = k === 0 ? 0 : shots[k - 1] + 0.55;
  const target = shots[k];
  const hold = p(lt, Math.max(start + 0.2, target - 1.0), target - 0.45);
  const arrive = k === 0 ? 1 : p(lt, start, start + 0.4, E.out5);
  const wob = 1 - hold;
  const px = base.x + Math.sin(lt * 5) * 5 * wob + (1 - arrive) * 380, py = base.y + Math.cos(lt * 4.2) * 6 * wob, pr = base.r + Math.sin(lt * 3.3) * 2 * wob;
  st(q(".cam__paper"), { x: px, y: py, r: pr, s: 0.74, o: after && lt > target + 0.5 ? 0 : 1 });
  st(q(".cam__frame"), { x: px, y: py, r: pr, s: 0.74, o: p(lt, start + 0.3, start + 0.5) * (lt > target ? 0 : 1) });
  q(".cam__q").style.inset = `${(-(1 - hold) * 46).toFixed(1)}px`;
  q(".cam__q").style.borderColor = hold > 0.9 ? "#3ecf8e" : "#ffffff";
  const pk = spring(lt, target - 0.5, 2.8, 8);
  st(q(".cam__pill"), { x: -90, s: 0.8 + 0.2 * pk, o: p(lt, target - 0.5, target - 0.35) * (lt > target ? 0 : 1) });
  let fl = 0, press = 0, n = 0, last = -1;
  shots.forEach((s, i) => {
    fl = Math.max(fl, inOut(lt, s, s + 0.05, s + 0.05, s + 0.4));
    press = Math.max(press, inOut(lt, s - 0.12, s, s, s + 0.25));
    if (lt > s + 0.5) n++;
    if (lt >= s) last = i;
  });
  q(".cam__flash").style.opacity = (fl * 0.9).toFixed(3);
  st(q(".cam__shutter i"), { s: 1 - press * 0.16 });
  const fly = q(".cam__fly");
  if (last >= 0) {
    const fk = p(lt, shots[last] + 0.08, shots[last] + 0.6, E.io);
    const b = bases[last % 2];
    fly.style.visibility = fk < 1 ? "visible" : "hidden";
    st(fly, { x: lerp(b.x, 268, fk), y: lerp(b.y, 468, fk), r: lerp(b.r, 4, fk), s: lerp(0.74, 0.17, fk) });
  } else fly.style.visibility = "hidden";
  const s0 = shots[0];
  st(q(".cam__thumb"), { s: spring(lt, s0 + 0.5, 3, 8), o: p(lt, s0 + 0.5, s0 + 0.6) });
  q(".pg2").style.opacity = n > 1 ? 1 : 0;
  q(".cam__thumb b").textContent = Math.max(1, n);
  q(".cam__done b").textContent = Math.max(1, n);
  const dk = p(lt, s0 + 0.5, s0 + 0.8, E.out5);
  st(q(".cam__done"), { x: (1 - dk) * 30, o: dk, s: 1 - inOut(lt, doneAt - 0.15, doneAt, doneAt, doneAt + 0.25) * 0.08 });
}

/** 点击的位置提示：放在被点的元素里面，at 时刻出现一圈涟漪 */
export const tap = (id) => `<i class="tap" data-tap="${id}"></i>`;
export function tapAnim(root, lt, times) {
  root.querySelectorAll(".tap").forEach((el) => {
    const at = times[el.dataset.tap];
    if (at === undefined) { el.style.opacity = 0; return; }
    const k = p(lt, at - 0.3, at + 0.35, E.lin);
    const press = inOut(lt, at - 0.3, at - 0.05, at, at + 0.35);
    el.style.opacity = press.toFixed(3);
    el.style.transform = `translate(-50%,-50%) scale(${(1.25 - 0.45 * Math.min(1, k * 2) + Math.max(0, k - 0.5) * 1.2).toFixed(3)})`;
  });
}

/** 一屏从右边推进来（前一屏往左退一点、变暗） */
export function push(next, prev, lt, at, dur = 0.45) {
  const k = p(lt, at, at + dur, E.io);
  next.style.visibility = lt >= at ? "visible" : "hidden";
  st(next, { x: (1 - k) * 300 });
  if (prev) {
    st(prev, { x: -k * 90 });
    // 第一屏（.fs0）没有别人管它的显隐；其余的屏由把它推进来的那次 push 管，这里只负责推完后藏起来
    if (k >= 1) prev.style.visibility = "hidden";
    else if (prev.classList.contains("fs0")) prev.style.visibility = "visible";
  }
}

/** 底部弹层：at 升起，until 落下 */
export function sheet(el, lt, at, until = 1e9) {
  const k = p(lt, at, at + 0.4, E.out5) * (1 - p(lt, until, until + 0.3, E.in));
  el.style.visibility = lt >= at && lt < until + 0.3 ? "visible" : "hidden";
  el.querySelector(".sheet__mask").style.opacity = k.toFixed(3);
  el.querySelector(".sheet__panel").style.transform = `translateY(${((1 - k) * 100).toFixed(2)}%)`;
}
