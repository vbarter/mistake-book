// 总览片《上壹课 · 46 秒看懂》：九幕，每一幕讲一个真实功能。界面按小程序的页面重画，数据是为视频编的例子。
import { E, p, tw, spring, inOut, st, chars, riseChars, rng, count, clamp, lerp, makeScene } from "../engine.js";
import { C, icon, line, logo, buddy, star, wechat } from "../brand.js";
import { phone, statusBar, tabbar, caption, capAnim, pose, testPaper, homeScreen } from "../parts.js";
import { ACTS, DURATION, CUES } from "./overview.timing.js";

const orbs = (list) => list.map(([x, y, r, c, o = 0.5]) => `<div class="orb" style="left:${x - r * 1.6}px;top:${y - r * 1.6}px;width:${r * 3.2}px;height:${r * 3.2}px;background:radial-gradient(closest-side, ${c} 0%, ${c}cc 28%, ${c}55 58%, ${c}00 100%);opacity:${o}"></div>`).join("");
const driftOrbs = (ctx, t) => ctx.qa(".orb").forEach((el, i) => st(el, { x: Math.sin(t * 0.5 + i * 2.1) * 26, y: Math.cos(t * 0.4 + i * 1.3) * 22 }));
const sparks = (n, seed, color = C.gold) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => `<div class="spark" style="left:${(r() * 500 + 20).toFixed(0)}px;top:${(r() * 900 + 30).toFixed(0)}px" data-p="${(r() * 6.28).toFixed(2)}" data-s="${(0.5 + r() * 0.9).toFixed(2)}">${star(14, r() > 0.5 ? color : "#8fa6dc")}</div>`).join("");
};
const twinkle = (ctx, t) => ctx.qa(".spark").forEach((el) => { const ph = +el.dataset.p; st(el, { y: Math.sin(t * 0.8 + ph) * 8, s: +el.dataset.s * (0.75 + 0.25 * Math.sin(t * 2.2 + ph)), o: 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7 + ph)), r: t * 20 }); });

/** 吉祥物的小动作：上下浮、眨眼 */
function buddyIdle(root, t) {
  const body = root.querySelector(".bd-body");
  if (!body) return;
  body.style.transform = `translateY(${(Math.sin(t * 2.4) * 2.2).toFixed(2)}px)`;
  const blink = (t % 2.6) > 2.45 ? 0.15 : 1;
  const eyes = root.querySelector(".bd-eyes");
  eyes.style.transformOrigin = "76px 86px";
  eyes.style.transform = `scaleY(${blink})`;
  [".bd-f1", ".bd-f2", ".bd-f3"].forEach((s, i) => { const el = root.querySelector(s); if (el) el.style.transform = `translateY(${(Math.sin(t * 1.8 + i * 2) * 3).toFixed(2)}px)`; });
}

export default function build(root) {
  const scenes = [];
  const add = (cfg) => scenes.push(makeScene(root, cfg));

  /* ───────── 第 1 幕：提问 ───────── */
  {
    const r = rng(7);
    const sheets = Array.from({ length: 9 }, (_, i) => {
      const w = 70 + r() * 70;
      return `<div class="fall" data-x="${(r() * 480).toFixed(0)}" data-v="${(60 + r() * 90).toFixed(0)}" data-r="${(r() * 60 - 30).toFixed(0)}" data-o="${(r() * 5).toFixed(2)}" style="width:${w.toFixed(0)}px;height:${(w * 1.38).toFixed(0)}px;opacity:${(0.05 + r() * 0.1).toFixed(2)};filter:blur(${(r() * 3).toFixed(1)}px)"><i></i><i></i><i></i><b>${line("xmark", w * 0.34, "#ff6b7d", 2.6)}</b></div>`;
    }).join("");
    add({
      id: "hook", from: ACTS.hook[0], to: ACTS.hook[1], wipe: 0,
      html: `<div class="bg bg--night"></div>${orbs([[90, 200, 170, "#2b4f96", 0.55], [470, 760, 200, "#a3303f", 0.28]])}${sheets}<div class="vig"></div>
        <div class="hook"><p class="hook__a">${chars("每次考完试")}</p><h1 class="hook__b">${chars("错题都")}<em>${chars("去哪了")}</em>${chars("？")}</h1>
        <div class="hook__chips">${["抄不完", "找不到", "改了还错"].map((s) => `<span>${line("xmark", 18, "#ff8c99", 2.8)}${s}</span>`).join("")}</div></div>`,
      update(lt, t, ctx) {
        driftOrbs(ctx, t);
        ctx.qa(".fall").forEach((el) => { const y = ((lt + +el.dataset.o) * +el.dataset.v) % 1200 - 200; st(el, { x: +el.dataset.x + Math.sin(lt + +el.dataset.o) * 14, y, r: +el.dataset.r + lt * 10 }); });
        riseChars(ctx.qa(".hook__a .ch"), lt, 0.25, { gap: 0.05 });
        riseChars(ctx.qa(".hook__b .ch"), lt, 0.95, { gap: 0.07, dur: 0.7, dy: 44 });
        ctx.qa(".hook__chips span").forEach((el, i) => { const k = spring(lt, 2.4 + i * 0.3, 2.6, 8); st(el, { s: 0.6 + 0.4 * k, o: p(lt, 2.4 + i * 0.3, 2.55 + i * 0.3), y: (1 - k) * 14 }); });
        const out = p(lt, 3.55, 4.2, E.in);
        st(ctx.q(".hook"), { s: 1 + out * 0.12 + lt * 0.006, o: 1 - out * 0.6 });
      },
    });
  }

  /* ───────── 第 2 幕：品牌亮相 ───────── */
  add({
    id: "brand", from: ACTS.brand[0], to: ACTS.brand[1], origin: "50% 42%",
    html: `<div class="bg bg--hero"></div>${orbs([[60, 120, 150, "#4f7be0", 0.45], [500, 880, 190, "#0d1c40", 0.6]])}${sparks(12, 3)}
      <div class="b-spot"></div><div class="b-buddy">${buddy("hero", 330)}</div>
      <div class="b-word">${logo(58)}<h1>${chars("上壹课")}</h1></div>
      <p class="b-tag">${chars("拍一拍，错题自己整理好")}</p><p class="b-kick"><i></i>AI 错题本 · 微信小程序<i></i></p><div class="vig"></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); twinkle(ctx, t);
      const s = spring(lt, 0.25, 2.4, 6);
      st(ctx.q(".b-spot"), { s: 0.5 + 0.5 * p(lt, 0.1, 1.0, E.out5), o: p(lt, 0.1, 0.6) });
      st(ctx.q(".b-buddy"), { y: (1 - s) * 220 + Math.sin(lt * 2) * 4, s: 0.7 + 0.3 * s, r: (1 - s) * -10, o: p(lt, 0.25, 0.5) });
      buddyIdle(ctx.el, lt);
      const lk = spring(lt, 1.0, 2.6, 7);
      st(ctx.q(".b-word .logo"), { s: lk, r: (1 - lk) * -40, o: p(lt, 1.0, 1.2) });
      riseChars(ctx.qa(".b-word h1 .ch"), lt, 1.15, { gap: 0.09, dur: 0.7, dy: 40 });
      riseChars(ctx.qa(".b-tag .ch"), lt, 1.75, { gap: 0.04, dur: 0.5, dy: 18 });
      const k = p(lt, 2.4, 3.0, E.out5);
      st(ctx.q(".b-kick"), { o: k * 0.8, y: (1 - k) * 10 });
    },
  });

  /* ───────── 第 3 幕：拍照收集 ───────── */
  add({
    id: "scan", from: ACTS.scan[0], to: ACTS.scan[1], origin: "50% 60%",
    html: `<div class="bg bg--cam"></div>${orbs([[80, 300, 170, "#1e7a47", 0.3], [480, 700, 190, "#2b4f96", 0.45]])}
      ${caption("01", "错题收集", "拍下试卷，<em>自动框选</em>", "多页连拍，一份卷子一次收好")}
      ${phone(`<div class="ui camui">${statusBar()}<div class="capsule"></div>
        <div class="cam__auto">自动拍</div>
        <div class="cam__view"><div class="cam__paper">${testPaper(true)}</div>
          <div class="cam__frame"><div class="cam__q"><i></i><i></i><i></i><i></i></div></div>
          <div class="cam__pill">${line("check", 18, "#fff", 2.8)}框住了，拿稳别动</div>
          <div class="cam__fly">${testPaper(true)}</div>
          <div class="cam__thumb"><div class="pg pg2"></div><div class="pg pg1">${`<div class="mini">${testPaper(true)}</div>`}</div><b class="num">1</b></div>
        </div>
        <div class="cam__bottom"><span class="cam__label">扫描试卷</span><div class="cam__shutter"><i></i></div><div class="cam__done">完成<b class="num">1</b></div></div>
        <div class="cam__flash"></div></div>`)}
      <div class="vig"></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); capAnim(ctx, lt);
      const inK = p(lt, 0.15, 1.2, E.out5);
      pose(ctx.q(".phone"), { y: -62 + (1 - inK) * 520 + Math.sin(lt * 1.3) * 4, rx: (1 - inK) * 26 + 3, ry: -7 + lt * 1.4, rz: (1 - inK) * -6, s: 1.0 + lt * 0.005 });
      const [s1, s2] = CUES.shutter.map((c) => c - ACTS.scan[0]);
      // 取景：纸在画面里轻轻晃，绿色框从松到紧
      const second = lt > s1 + 0.55;
      const base = second ? { x: 44, y: 72, r: 2.5 } : { x: 50, y: 78, r: -3 };
      const hold = second ? p(lt, s1 + 0.75, s1 + 1.25) : p(lt, 1.0, 1.9);
      const wob = (1 - hold) * 1;
      const px = base.x + Math.sin(lt * 5) * 5 * wob, py = base.y + Math.cos(lt * 4.2) * 6 * wob, pr = base.r + Math.sin(lt * 3.3) * 2 * wob;
      const paperIn = second ? p(lt, s1 + 0.55, s1 + 0.95, E.out5) : 1;
      st(ctx.q(".cam__paper"), { x: px + (1 - paperIn) * 380, y: py, r: pr, s: 0.74 });
      st(ctx.q(".cam__frame"), { x: px + (1 - paperIn) * 380, y: py, r: pr * hold, s: 0.74, o: p(lt, second ? s1 + 0.7 : 0.9, second ? s1 + 0.9 : 1.2) });
      ctx.q(".cam__q").style.inset = `${(-(1 - hold) * 46).toFixed(1)}px`;
      ctx.q(".cam__q").style.borderColor = hold > 0.9 ? "#3ecf8e" : "#ffffff";
      const pill = (second ? p(lt, s1 + 1.15, s1 + 1.4) : p(lt, 1.75, 2.05)) * (1 - p(lt, s1, s1 + 0.1)) + (second ? 0 : 0);
      const pillK = second ? spring(lt, s1 + 1.15, 2.8, 8) : spring(lt, 1.75, 2.8, 8);
      st(ctx.q(".cam__pill"), { x: -90, s: 0.8 + 0.2 * pillK, o: second ? p(lt, s1 + 1.15, s1 + 1.35) * (1 - p(lt, s2, s2 + 0.1)) : pill });
      // 快门：白闪 + 按下
      const fl = Math.max(inOut(lt, s1, s1 + 0.05, s1 + 0.05, s1 + 0.4), inOut(lt, s2, s2 + 0.05, s2 + 0.05, s2 + 0.4));
      ctx.q(".cam__flash").style.opacity = (fl * 0.9).toFixed(3);
      const press = Math.max(inOut(lt, s1 - 0.12, s1, s1, s1 + 0.25), inOut(lt, s2 - 0.12, s2, s2, s2 + 0.25));
      st(ctx.q(".cam__shutter i"), { s: 1 - press * 0.16 });
      // 拍下的那张飞进右下角缩略图
      const shot = lt >= s2 ? s2 : s1;
      const fk = p(lt, shot + 0.08, shot + 0.6, E.io);
      const fly = ctx.q(".cam__fly");
      fly.style.visibility = lt >= s1 && fk < 1 ? "visible" : "hidden";
      st(fly, { x: lerp(base.x, 268, fk), y: lerp(base.y, 468, fk), r: lerp(base.r, 4, fk), s: lerp(0.74, 0.17, fk) });
      const th = ctx.q(".cam__thumb");
      const tk = spring(lt, s1 + 0.5, 3, 8);
      st(th, { s: tk * (1 + inOut(lt, s2 + 0.5, s2 + 0.6, s2 + 0.6, s2 + 0.85) * 0.12), o: p(lt, s1 + 0.5, s1 + 0.6) });
      ctx.q(".pg2").style.opacity = lt > s2 + 0.5 ? 1 : 0;
      const n = lt > s2 + 0.5 ? 2 : 1;
      ctx.q(".cam__thumb b").textContent = n; ctx.q(".cam__done b").textContent = n;
      const dk = p(lt, s1 + 0.5, s1 + 0.8, E.out5);
      const tap = inOut(lt, 5.15, 5.3, 5.3, 5.55);
      st(ctx.q(".cam__done"), { x: (1 - dk) * 30, o: dk, s: 1 - tap * 0.08 });
    },
  });

  /* ───────── 第 4 幕：AI 还原批改 ───────── */
  {
    const rows = [["1", "0", true, "0"], ["2", "7", true, "7"], ["3", "75°", false, "65°", "三角形内角和是 180°，先加再减"], ["4", "B", false, "A", "负数比 0 小，绝对值大的负数更小"], ["5", "B", true, "B"]];
    const paperScreen =
      `<div class="ui">${statusBar("#1c1c1e")}<div class="capsule capsule--dark"></div><div class="nav">${line("chevron-left", 24, C.brand, 2.2)}<span class="nav__title">七年级数学期中练习</span></div>` +
      `<div class="body"><div style="display:flex;gap:8px;align-items:center"><span class="tag" style="background:#dbe6fb;color:#2f6fed">数学</span><span class="tag" style="background:#e5e5ea;color:#5b5b63">期中</span><span class="t-foot" style="margin-left:auto">11月12日 扫描</span></div>` +
      `<div class="seg"><div>${line("document", 16, C.secondary)}试卷</div><div class="on">${line("pencil", 16, C.label)}作答</div><div>${line("xcircle", 16, C.secondary)}错题 2</div></div>` +
      `<div class="card ans"><div class="ans__row ans__row--head"><span class="ans__num">题号</span><span class="ans__hand">你写的</span><span class="ans__mark">批改</span><span class="ans__answer">正确答案</span></div>` +
      rows.map(([n, hand, ok, ans, note]) =>
        `<div class="arow"><div class="ans__row${ok ? "" : " ans__row--wrong"}"><span class="ans__num">第 ${n} 题</span><span class="ans__hand">${hand}</span><span class="ans__mark"><span class="verdict verdict--${ok ? "ok" : "no"}">${line(ok ? "check" : "xmark", 15, ok ? C.ok : C.wrong, 3)}</span></span><span class="ans__answer">${ans}</span></div>${note ? `<div class="ans__note"><b>下次注意</b><span>${note}</span></div>` : ""}</div>`).join("") +
      `</div><div class="card" style="display:flex;align-items:center;gap:12px">${icon("knowledge", 40)}<div style="flex:1"><div style="font-weight:700;font-size:16px">2 道错题已归入知识点</div><div class="t-foot">三角形内角和 · 有理数比较大小</div></div>${line("chevron-right", 16, C.tertiary, 2.2)}</div></div></div>`;
    add({
      id: "grade", from: ACTS.grade[0], to: ACTS.grade[1], origin: "50% 55%",
      html: `<div class="bg bg--light"></div>${orbs([[470, 240, 180, "#c9d7f5", 0.9], [60, 780, 200, "#f3d5da", 0.8]])}
        ${caption("02", "AI 还原批改", "照片变成<em>电子试卷</em>", "逐题批改，错题自动归到知识点", true)}
        ${phone(`<div class="g-a">${homeScreen({ scanning: true })}</div><div class="g-b">${paperScreen}</div>`, "phone--light")}
        <div class="float f1">${icon("wrong", 44)}<div>2 道错题<small>自动进错题榜</small></div></div>
        <div class="float f2">${icon("math", 44)}<div>数学 · 期中<small>学科、卷名自动识别</small></div></div>`,
      update(lt, t, ctx) {
        driftOrbs(ctx, t); capAnim(ctx, lt);
        const inK = p(lt, 0.1, 1.1, E.out5);
        pose(ctx.q(".phone"), { x: 0, y: (1 - inK) * 500 + Math.sin(lt * 1.2) * 4, rx: 3 + (1 - inK) * 20, ry: 8 - lt * 1.5, s: 1.1 + lt * 0.005 });
        buddyIdle(ctx.q(".g-a"), lt);
        const prog = tw(lt, 0.5, 1.9, 12, 100, E.io);
        ctx.q(".scan-bar").style.width = prog.toFixed(1) + "%";
        ctx.q(".scan-pct").textContent = Math.round(prog) + "%";
        st(ctx.q(".scan-card"), { s: 1 + inOut(lt, 0.4, 0.7, 1.8, 2.0) * 0.03 });
        const sw = p(lt, 2.0, 2.6, E.io);
        st(ctx.q(".g-a"), { x: -sw * 90, o: 1 - sw * 0.5 });
        st(ctx.q(".g-b"), { x: (1 - sw) * 300 });
        ctx.qa(".arow").forEach((el, i) => {
          const k = p(lt, 2.35 + i * 0.07, 2.8 + i * 0.07, E.out5);
          st(el, { y: (1 - k) * 18, o: k });
          const c = CUES.ding[i] - ACTS.grade[0];
          const m = spring(lt, c, 3, 7);
          st(el.querySelector(".verdict"), { s: m, r: (1 - m) * -60 });
          el.querySelector(".ans__answer").style.opacity = p(lt, c, c + 0.2);
          const row = el.querySelector(".ans__row--wrong");
          if (row) row.style.background = `rgba(255,236,236,${p(lt, c, c + 0.3)})`;
          const note = el.querySelector(".ans__note");
          if (note) { const nk = p(lt, 3.5 + i * 0.1, 4.0 + i * 0.1, E.out5); note.style.maxHeight = (nk * 44).toFixed(1) + "px"; note.style.opacity = nk; note.style.paddingBottom = (nk * 9).toFixed(1) + "px"; }
        });
        const kc = ctx.q(".g-b .card:last-child");
        const kk = p(lt, 4.0, 4.5, E.out5);
        st(kc, { y: (1 - kk) * 20, o: kk });
        [[".f1", 4.3, 1], [".f2", 4.8, -1]].forEach(([s, at, dir]) => { const k = spring(lt, at, 2.6, 7); st(ctx.q(s), { x: (1 - k) * 40 * dir, y: Math.sin(lt * 1.6 + at) * 4, s: 0.7 + 0.3 * k, o: p(lt, at, at + 0.2) }); });
      },
    });
  }

  /* ───────── 第 5 幕：错题榜 ───────── */
  {
    const sub = { 数: ["#dbe6fb", "#2f6fed"], 英: ["#e9e0fb", "#5b37a8"], 语: ["#fde0e4", "#b3364a"] };
    const cards = [
      ["数", "一个三角形的两个内角是 40° 和 75°，第三个角是 ____°。", ["三角形内角和", "期中练习 第 3 题", "错过 2 次"], "下次注意：三角形内角和是 180°，先加再减", 92],
      ["数", "下列各数中最小的是（ ）A. −3  B. 0  C. 2  D. −1", ["有理数比较大小", "期中练习 第 4 题"], "你写：B · 正确：A", 87],
      ["英", "Our handmade bookmarks were sold out within half ____ hour.", ["冠词", "二模卷 第 21 题"], "你写：a · 正确：an", 81],
      ["语", "默写：____，天涯若比邻。", ["古诗文默写", "周练 3 第 2 题"], "没作答 · 正确：海内存知己", 76],
    ];
    const weeks = [["9/22", 3], ["9/29", 5], ["10/6", 2], ["10/13", 6], ["10/20", 4], ["10/27", 7], ["11/3", 5], ["本周", 3]];
    const screen =
      `<div class="ui">${statusBar("#1c1c1e")}<div class="capsule capsule--dark"></div><div class="nav" style="padding-right:106px"><div class="seg" style="flex:1"><div>近 7 天</div><div class="on">近 30 天</div><div>全部</div></div></div>` +
      `<div class="body r-scroll" style="gap:14px;bottom:auto"><div class="rank-head"><div class="rank-head__text"><span class="t-title1">错题榜</span><span class="t-foot">近 30 天 16 道错题</span><span class="t-sub" style="margin-top:2px">数学错得最多，先看三角形内角和</span></div><div style="margin:-6px -4px -10px 0">${buddy("chart", 100)}</div></div>` +
      `<div class="rank-panel"><div class="subject-tabs">${["全部", "数学", "英语", "语文"].map((s, i) => `<span class="subject-tab${i ? "" : " on"}">${s}</span>`).join("")}</div>` +
      `<div class="rank-boards">${["易错题", "知识点", "反复错", "空白"].map((s, i) => `<span class="chip${i ? "" : " on"}">${s}</span>`).join("")}</div><div class="rank-hint t-foot">同一知识点错得越多、越近，排得越前</div>` +
      cards.map(([s, title, meta, quote], i) => `<div class="rank-card"><span class="rank-badge num${i < 3 ? " top" : ""}">${i + 1}</span><div class="rank-card__body"><div class="rank-card__title"><span class="tile-xs" style="background:${sub[s][0]};color:${sub[s][1]}">${s}</span><span>${title}</span></div><div class="rank-card__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div><div class="rank-card__quote">${quote}</div></div><div class="rank-index"><span class="rank-index__num num">0</span><span class="rank-index__label">易错指数</span></div></div>`).join("") +
      `</div><div class="card"><div class="chart__head"><span class="t-headline">每周错题</span><span class="t-foot">比上周少 2 题</span></div><div class="trend">${weeks.map(([l, v], i) => `<div class="trend__col${i === 7 ? " on" : ""}"><span class="trend__val num">${i === 7 ? v : ""}</span><div class="trend__area"><div class="trend__bar" style="height:${(v / 7) * 100}%"></div></div><span class="trend__label">${l}</span></div>`).join("")}</div></div>` +
      `<div style="height:120px"></div></div>${tabbar(2)}</div>`;
    add({
      id: "rank", from: ACTS.rank[0], to: ACTS.rank[1], origin: "50% 55%",
      html: `<div class="bg bg--night"></div>${orbs([[450, 260, 190, "#2b4f96", 0.6], [70, 820, 190, "#a3303f", 0.3]])}${sparks(8, 11)}
        ${caption("03", "错题榜", "先补<em>最容易错</em>的", "易错题 · 知识点 · 反复错 · 空白，四张榜")}
        ${phone(screen)}
        <div class="float float--big f3"><b class="num">92</b><div>易错指数<small>错得越多、越近，排得越前</small></div></div><div class="vig"></div>`,
      update(lt, t, ctx) {
        driftOrbs(ctx, t); twinkle(ctx, t); capAnim(ctx, lt);
        const inK = p(lt, 0.1, 1.1, E.out5);
        pose(ctx.q(".phone"), { x: 0, y: (1 - inK) * 500 + Math.sin(lt * 1.2) * 4, rx: 3 + (1 - inK) * 20, ry: -8 + lt * 1.6, s: 1.1 + lt * 0.005 });
        buddyIdle(ctx.q(".rank-head"), lt);
        const hk = p(lt, 0.25, 0.75, E.out5);
        st(ctx.q(".rank-head"), { y: (1 - hk) * 16, o: hk });
        const pk = p(lt, 0.4, 0.9, E.out5);
        st(ctx.q(".rank-panel"), { y: (1 - pk) * 20, o: pk });
        ctx.qa(".rank-card").forEach((el, i) => {
          const a = 0.75 + i * 0.14;
          const k = spring(lt, a, 2.2, 7.5);
          st(el, { y: (1 - k) * 24, o: p(lt, a, a + 0.2) });
          el.querySelector(".rank-index__num").textContent = count(lt, a + 0.1, a + 1.0, cards[i][4]);
        });
        const sc = p(lt, 3.9, 4.9, E.io);
        ctx.q(".r-scroll").style.transform = `translateY(${(-sc * 430).toFixed(1)}px)`;
        ctx.qa(".trend__bar").forEach((el, i) => { const k = spring(lt, 4.5 + i * 0.05, 2.4, 7); el.style.transform = `scaleY(${k.toFixed(3)})`; });
        const fk = spring(lt, 3.6 - 0.0, 2.6, 7) * (1 - p(lt, 4.3, 4.7, E.in));
        st(ctx.q(".f3"), { x: (1 - fk) * 40, y: Math.sin(lt * 1.6) * 4, s: 0.7 + 0.3 * fk, o: p(lt, 3.6, 3.8) * (1 - p(lt, 4.3, 4.7)) });
      },
    });
  }

  /* ───────── 第 6 幕：试卷擦除 ───────── */
  add({
    id: "erase", from: ACTS.erase[0], to: ACTS.erase[1], origin: "50% 60%",
    html: `<div class="bg bg--rose"></div>${orbs([[460, 220, 180, "#f1c9d0", 0.9], [60, 800, 200, "#c9d7f5", 0.8]])}
      ${caption("04", "试卷擦除", "一键<em>擦掉手写</em>", "作答和批改都去掉，原题再做一遍", true)}
      <div class="er"><div class="er__in"><div class="er__clean">${testPaper(false)}</div><div class="er__raw">${testPaper(true)}</div>
        <span class="er__tag er__tag--l">擦除后</span><span class="er__tag er__tag--r">原图</span>
        <div class="er__bar"><i>${line("arrows", 20, C.brand, 2.2)}</i></div>
        ${Array.from({ length: 8 }, (_, i) => `<div class="er__sp" data-i="${i}">${star(i % 2 ? 12 : 18, i % 3 ? C.gold : "#e2566a")}</div>`).join("")}</div></div>
      <div class="er__btn btn">${line("export", 20, "#fff", 2)}导出空白卷 PDF</div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); capAnim(ctx, lt);
      const inK = spring(lt, 0.2, 1.8, 6.5);
      st(ctx.q(".er"), { y: (1 - inK) * 420, r: -2.5 + (1 - inK) * 8 + Math.sin(lt * 0.9) * 0.4, s: 1 + lt * 0.006, o: p(lt, 0.2, 0.4) });
      const sweepAt = CUES.sweep[0] - ACTS.erase[0];
      const k = p(lt, sweepAt, sweepAt + 2.3, E.io);
      const x = k * 360;
      ctx.q(".er__raw").style.clipPath = `inset(0 0 0 ${x.toFixed(1)}px)`;
      const bar = ctx.q(".er__bar");
      st(bar, { x, o: p(lt, 0.9, 1.2) * (1 - p(lt, sweepAt + 2.3, sweepAt + 2.7)) });
      ctx.q(".er__tag--l").style.opacity = p(lt, sweepAt + 0.5, sweepAt + 0.8);
      ctx.q(".er__tag--r").style.opacity = p(lt, 0.9, 1.2) * (1 - p(lt, sweepAt + 1.6, sweepAt + 1.9));
      ctx.qa(".er__sp").forEach((el, i) => {
        const ph = i * 0.27;
        const life = clamp((lt - sweepAt - ph) / 0.7);
        const on = lt > sweepAt + ph && life < 1 && k < 0.99;
        const sx = p(sweepAt + ph, sweepAt, sweepAt + 2.3, E.io) * 360;
        st(el, { x: sx - 26 * life - 8, y: 40 + ((i * 137) % 420) - life * 30, s: Math.sin(life * Math.PI), r: life * 120, o: on ? 1 : 0 });
      });
      const bk = spring(lt, 4.4, 2.6, 7);
      st(ctx.q(".er__btn"), { y: (1 - bk) * 50, s: (0.8 + 0.2 * bk) * (1 - inOut(lt, 5.2, 5.35, 5.35, 5.6) * 0.06), o: p(lt, 4.4, 4.6) });
    },
  });

  /* ───────── 第 7 幕：导出错题本 ───────── */
  add({
    id: "export", from: ACTS.export[0], to: ACTS.export[1], origin: "50% 34%",
    html: `<div class="bg bg--light"></div>${orbs([[80, 260, 180, "#c9d7f5", 0.9], [480, 820, 200, "#f6e2bd", 0.7]])}
      ${caption("05", "导出错题本", "错题本<em>一键打印</em>", "按知识点排好，左边重做，右边看解析", true)}
      <div class="a4 a4--3"><h5>有理数比较大小</h5><div class="a4__cols"><div><div class="a4__q">2. 下列各数中最小的是（　）<br>A. −3　B. 0　C. 2　D. −1</div><div class="a4__blank"></div><div class="a4__q" style="margin-top:10px">3. 比较大小：−5 ____ −2</div><div class="a4__blank"></div></div><div><div class="a4__ans">原答案 <b class="r">B</b>　正确答案 <b class="g">A</b><br>解析：负数比 0 小，绝对值大的负数更小。</div><div class="a4__ans">原答案 <b class="r">＞</b>　正确答案 <b class="g">＜</b><br>解析：在数轴上，−5 在 −2 的左边。</div></div></div><div class="a4__foot">— 3 —</div></div>
      <div class="a4 a4--2"><h5>三角形内角和</h5><div class="a4__cols"><div><div class="a4__q">1. 一个三角形的两个内角是 40° 和 75°，第三个角是 ____°。</div><div class="a4__blank" style="height:60px"></div><div style="margin-top:10px;color:#8e8e93">重做区</div></div><div><div class="a4__ans">原答案 <b class="r">75°</b>　正确答案 <b class="g">65°</b><br>解析：三角形内角和是 180°，<br>180° − 40° − 75° = 65°。</div><div class="a4__ans" style="color:#b42323">下次注意：先把已知的两个角加起来，再用 180° 去减。</div></div></div><div class="a4__foot">— 2 —</div></div>
      <div class="a4 a4--1"><div style="display:flex;align-items:center;gap:8px">${logo(20)}<h4>错题本</h4><span style="margin-left:auto;color:#8e8e93">上壹课 · 小蔡 · 11月12日</span></div><div class="a4__toc"><div style="color:#8e8e93;font-size:9px"><span>知识点</span><span style="width:40px">题数</span><span style="width:70px">题号</span><span style="width:30px;text-align:right">页码</span></div>${[["三角形内角和", 4, "1 – 4", 2], ["有理数比较大小", 3, "5 – 7", 3], ["一元一次方程", 3, "8 – 10", 4], ["冠词", 2, "11 – 12", 5], ["古诗文默写", 4, "13 – 16", 6]].map(([a, b, c2, d]) => `<div><span>${a}</span><span style="width:40px">${b} 道</span><span style="width:70px">${c2}</span><span style="width:30px;text-align:right">${d}</span></div>`).join("")}</div><div class="a4__foot">— 1 —</div></div>
      <div class="ex__chip float">${icon("export", 40)}<div>导出新增的 16 道错题<small>只导上次导出之后新增的</small></div></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); capAnim(ctx, lt, 0.1);
      const tgt = [[62, 300, -5], [84, 478, 3], [58, 656, -2.5]];
      [".a4--1", ".a4--2", ".a4--3"].forEach((s, i) => {
        const at = 1.0 + i * 0.25;
        const k = spring(lt, at, 2.0, 6.5);
        st(ctx.q(s), { x: tgt[i][0], y: tgt[i][1] + (1 - k) * 700 + Math.sin(lt * 1.3 + i) * 3, r: tgt[i][2] + (1 - k) * 14, s: 1.12 + lt * 0.004, o: p(lt, at, at + 0.15) });
      });
      const ck = spring(lt, 2.4, 2.6, 7);
      st(ctx.q(".ex__chip"), { y: (1 - ck) * 40, s: 0.75 + 0.25 * ck, o: p(lt, 2.4, 2.6) });
    },
  });

  /* ───────── 第 8 幕：学习计划 ───────── */
  {
    const members = [["明", "王小明"], ["雨", "李思雨"], ["然", "张浩然"], ["蔡", "小蔡"]];
    const screen =
      `<div class="ui">${statusBar("#1c1c1e")}<div class="capsule capsule--dark"></div><div class="nav">${line("chevron-left", 24, C.brand, 2.2)}<div style="flex:1;text-align:center;padding-left:60px"><div style="font-size:16px;font-weight:700">七（2）班数学</div><div style="font-size:11px;color:#5b5b63">数学</div></div></div>` +
      `<div class="body"><div style="display:flex;justify-content:flex-end;margin-top:-4px"><span class="fwd">${wechat(18)}转发</span></div>` +
      `<div class="pstats"><div class="pstat"><small>${line("checkcircle", 13, C.secondary, 2.2)}今日已交</small><b class="num n-done">0</b></div><div class="pstat"><small>${line("pencil", 13, C.secondary, 2.2)}待批阅</small><b class="num n-rev">0</b></div><div class="pstat"><small>成员</small><b class="num">4</b></div></div>` +
      `<div class="seg"><div>作业 2</div><div class="on">成员 4</div></div>` +
      `<div class="card" style="padding:0">${members.map(([a, n]) => `<div class="mrow"><div class="avatar">${a}</div><span class="mrow__name">${n}</span><div class="mstate"><span class="no">${line("clock", 12, "#b35300", 2.4)}未交</span><span class="ok">${line("check", 12, C.ok, 3)}已交</span></div></div>`).join("")}</div>` +
      `<div class="card" style="display:flex;align-items:center;gap:12px">${icon("homework", 40)}<div style="flex:1"><div style="font-weight:700;font-size:16px">第三单元练习</div><div class="t-foot">今天 21:00 截止 · 拍照就能交</div></div></div>` +
      `<div class="btn" style="margin-top:auto;margin-bottom:40px">${line("plus", 18, "#fff", 2.6)}布置新作业</div></div></div>`;
    add({
      id: "plan", from: ACTS.plan[0], to: ACTS.plan[1], origin: "50% 55%",
      html: `<div class="bg bg--night"></div>${orbs([[90, 280, 180, "#2b4f96", 0.6], [470, 800, 190, "#1e7a47", 0.25]])}${sparks(8, 23)}
        ${caption("06", "学习计划", "老师布置，<em>拍照就交</em>", "微信一键转发，批改结果自动回填")}
        ${phone(screen)}
        <div class="float f4">${wechat(34)}<div>转发到微信群<small>同学点开卡片就加入</small></div></div><div class="vig"></div>`,
      update(lt, t, ctx) {
        driftOrbs(ctx, t); twinkle(ctx, t); capAnim(ctx, lt, 0.1);
        const inK = p(lt, 0.1, 1.0, E.out5);
        pose(ctx.q(".phone"), { x: 0, y: (1 - inK) * 500 + Math.sin(lt * 1.2) * 4, rx: 3 + (1 - inK) * 20, ry: 7 - lt * 1.6, s: 1.1 + lt * 0.006 });
        const fk = spring(lt, 0.9, 2.6, 7);
        st(ctx.q(".f4"), { x: (1 - fk) * -40, y: Math.sin(lt * 1.6) * 4, s: 0.7 + 0.3 * fk, o: p(lt, 0.9, 1.1) });
        let done = 0;
        ctx.qa(".mrow").forEach((el, i) => {
          const rk = p(lt, 0.6 + i * 0.08, 1.0 + i * 0.08, E.out5);
          st(el, { y: (1 - rk) * 14, o: rk });
          const at = 1.6 + i * 0.4;
          const flip = i < 3 ? spring(lt, at, 3, 7) : 0;
          if (i < 3 && lt >= at) done++;
          st(el.querySelector(".ok"), { s: flip, o: lt >= at ? 1 : 0 });
          el.querySelector(".no").style.opacity = lt >= at && i < 3 ? 0 : 1;
        });
        ctx.q(".n-done").textContent = done; ctx.q(".n-rev").textContent = done;
        st(ctx.q(".n-done"), { s: 1 + [1.6, 2.0, 2.4].reduce((m, a) => Math.max(m, inOut(lt, a, a + 0.1, a + 0.1, a + 0.35)), 0) * 0.3 });
      },
    });
  }

  /* ───────── 第 9 幕：落版 ───────── */
  add({
    id: "end", from: ACTS.end[0], to: ACTS.end[1], origin: "50% 40%",
    html: `<div class="bg bg--hero"></div>${orbs([[80, 140, 160, "#4f7be0", 0.45], [480, 860, 200, "#0d1c40", 0.6]])}${sparks(14, 31)}
      <div class="e-spot"></div><div class="e-buddy">${buddy("empty", 250)}</div>
      <div class="b-word e-word">${logo(58)}<h1>${chars("上壹课")}</h1></div>
      <p class="b-tag e-tag">${chars("拍下试卷，错题自己整理好")}</p>
      <div class="e-feats">${["拍照收集", "AI 批改", "错题榜", "试卷擦除", "导出打印", "学习计划"].map((s) => `<span>${s}</span>`).join("")}</div>
      <div class="e-search"><span class="e-search__l">${wechat(26)}微信搜一搜</span><span class="e-search__box">${line("search", 22, C.tertiary, 2.2)}<b>${chars("上壹课")}</b><i class="e-caret"></i></span></div>
      <div class="vig"></div><div class="e-fade"></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); twinkle(ctx, t);
      const s = spring(lt, 0.3, 2.4, 6);
      st(ctx.q(".e-spot"), { s: 0.5 + 0.5 * p(lt, 0.1, 1.0, E.out5), o: p(lt, 0.1, 0.6) });
      st(ctx.q(".e-buddy"), { y: (1 - s) * 200 + Math.sin(lt * 2) * 4, s: 0.7 + 0.3 * s, o: p(lt, 0.3, 0.5) });
      buddyIdle(ctx.el, lt);
      const hand = ctx.q(".bd-hand");
      if (hand) { hand.style.transformOrigin = "112px 80px"; hand.style.transform = `rotate(${(Math.sin(lt * 7) * 10 * p(lt, 0.8, 1.2)).toFixed(2)}deg)`; }
      const lk = spring(lt, 0.7, 2.6, 7);
      st(ctx.q(".e-word .logo"), { s: lk, r: (1 - lk) * -40, o: p(lt, 0.7, 0.9) });
      riseChars(ctx.qa(".e-word h1 .ch"), lt, 0.85, { gap: 0.09, dur: 0.7, dy: 40 });
      riseChars(ctx.qa(".e-tag .ch"), lt, 1.3, { gap: 0.035, dur: 0.5, dy: 18 });
      ctx.qa(".e-feats span").forEach((el, i) => { const k = spring(lt, 1.9 + i * 0.09, 2.6, 8); st(el, { s: 0.7 + 0.3 * k, y: (1 - k) * 12, o: p(lt, 1.9 + i * 0.09, 2.05 + i * 0.09) }); });
      const sk = spring(lt, 1.6 + 0.0, 2.2, 7);
      const sIn = p(lt, 2.6, 3.1, E.out5);
      st(ctx.q(".e-search"), { y: (1 - sIn) * 30, o: sIn, s: 0.94 + 0.06 * sIn + sk * 0 });
      ctx.qa(".e-search__box .ch").forEach((el, i) => { el.style.opacity = lt > 3.2 + i * 0.22 ? 1 : 0; });
      ctx.q(".e-caret").style.opacity = lt > 3.0 && Math.floor(lt * 2.5) % 2 === 0 ? 1 : 0;
      ctx.q(".e-fade").style.opacity = p(lt, 5.3, 5.95, E.io);
    },
  });

  return {
    id: "overview",
    title: "上壹课 · 46 秒看懂",
    duration: DURATION,
    render(t) { for (const s of scenes) s.render(t); },
  };
}
