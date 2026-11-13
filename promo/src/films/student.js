// 学生视角《作业和错题，三步搞定》：加入学习计划 → 交作业 → 收集错题。
// 界面按小程序的 pages/plan-join、components/PlanMember、Celebrate、pages/camera、pages/home、pages/rank 重画，数据是为视频编的例子。
import { E, p, tw, spring, inOut, st, chars, riseChars, rng, count, makeScene } from "../engine.js";
import { C, icon, line, logo, buddy, star, wechat } from "../brand.js";
import { phone, statusBar, tabbar, caption, capAnim, pose, testPaper, worksheet, homeScreen, camScreen, camAnim, tap, tapAnim, push, sheet } from "../parts.js";
import { ACTS, DURATION, T } from "./student.timing.js";

const PLAN = "七（2）班数学";
const orbs = (list) => list.map(([x, y, r, c, o = 0.5]) => `<div class="orb" style="left:${x - r * 1.6}px;top:${y - r * 1.6}px;width:${r * 3.2}px;height:${r * 3.2}px;background:radial-gradient(closest-side, ${c} 0%, ${c}cc 28%, ${c}55 58%, ${c}00 100%);opacity:${o}"></div>`).join("");
const driftOrbs = (ctx, t) => ctx.qa(".orb").forEach((el, i) => st(el, { x: Math.sin(t * 0.5 + i * 2.1) * 26, y: Math.cos(t * 0.4 + i * 1.3) * 22 }));
const sparks = (n, seed) => { const r = rng(seed); return Array.from({ length: n }, () => `<div class="spark" style="left:${(r() * 500 + 20).toFixed(0)}px;top:${(r() * 900 + 30).toFixed(0)}px" data-p="${(r() * 6.28).toFixed(2)}" data-s="${(0.5 + r() * 0.9).toFixed(2)}">${star(14, r() > 0.5 ? C.gold : "#8fa6dc")}</div>`).join(""); };
const twinkle = (ctx, t) => ctx.qa(".spark").forEach((el) => { const ph = +el.dataset.p; st(el, { y: Math.sin(t * 0.8 + ph) * 8, s: +el.dataset.s * (0.75 + 0.25 * Math.sin(t * 2.2 + ph)), o: 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7 + ph)), r: t * 20 }); });
const progress = (step, dark) => `<div class="prog${dark ? " prog--dark" : ""}">${[1, 2, 3].map((i) => `<i><u data-i="${i}" style="width:${i < step ? 100 : 0}%"></u></i>`).join("")}</div>`;
const progAnim = (ctx, lt, step, dur) => { const u = ctx.q(`.prog u[data-i="${step}"]`); if (u) u.style.width = (p(lt, 0.3, dur, E.lin) * 100).toFixed(1) + "%"; };
function buddyIdle(root, t) {
  const body = root.querySelector(".bd-body");
  if (!body) return;
  body.style.transform = `translateY(${(Math.sin(t * 2.4) * 2.2).toFixed(2)}px)`;
  const eyes = root.querySelector(".bd-eyes");
  eyes.style.transformOrigin = "76px 86px";
  eyes.style.transform = `scaleY(${(t % 2.6) > 2.45 ? 0.15 : 1})`;
}
/** 手机整体放小一点，底部的按钮都要看得见 */
const phonePose = (ctx, lt, dir = 1) => { const k = p(lt, 0.1, 1.0, E.out5); pose(ctx.q(".phone"), { y: -82 + (1 - k) * 520 + Math.sin(lt * 1.2) * 3, rx: 2 + (1 - k) * 22, ry: dir * (5 - lt * 0.8), s: 1 }); };

/* ───── 学习计划的几块界面 ───── */
const fileRow = (badge, name, size, locked) => `<div class="hw-file"><div class="plan-file__icon">${badge}</div><div class="flex1"><div class="hw-file__name">${name}</div><small>${size}</small></div>${locked ? line("lock", 14, C.tertiary, 2) : line("chevron-right", 14, C.tertiary, 2.4)}</div>`;
const FILES2 = (locked) => fileRow("PDF", "第三单元练习卷.pdf", "1.2 MB", locked) + fileRow("图片", "板书-例题.jpg", "860 KB", locked);
const FILES1 = (locked) => fileRow("PDF", "口算天天练 第 12 页.pdf", "420 KB", locked);
const hwCard = ({ no, title, sub, tag = "", open, files = "", cls = "" }) =>
  `<div class="group hw ${cls}"><div class="hw-head"><div class="hw-no">${no}</div><div class="flex1"><div class="hw-title">${title}</div><div class="hw-sub">${sub}</div></div>${tag}${line(open ? "chevron-up" : "chevron-down", 16, C.tertiary, 2.4)}</div>${open ? files : ""}</div>`;
const pending = `<span class="ptag ptag--pending">${line("clock", 12, "#b35300", 2.4)}待交</span>`;
const navBar = (title) => `${statusBar("#1c1c1e")}<div class="capsule capsule--dark"></div><div class="nav">${line("chevron-left", 24, C.brand, 2.2)}<span class="nav__title" style="text-align:center;padding-left:70px">${title}</span></div>`;

const wxScreen =
  `<div class="ui wx">${statusBar("#1c1c1e")}<div class="wx__nav">${line("chevron-left", 24, "#1c1c1e", 2.2)}<span>七（2）班数学群（42）</span></div>` +
  `<div class="wx__list"><span class="wx__time">下午 4:32</span>` +
  `<div class="wx__msg m1"><div class="avatar" style="background:#f8e6e8;color:#a3303f">王</div><div><div class="wx__who">王老师</div><div class="wx__bubble">同学们，这周的作业发在上壹课里了，点下面的卡片加入就能看到～</div></div></div>` +
  `<div class="wx__msg m2"><div class="avatar" style="background:#f8e6e8;color:#a3303f">王</div><div><div class="wx__who">王老师</div><div class="wx__card">${tap("card")}<div class="wx__card-app">${logo(16)}上壹课</div><div class="wx__card-title">王老师布置了「第三单元练习」，点开加入「${PLAN}」</div>` +
  `<div class="wx__card-cover"><b>第三单元练习</b><small>${PLAN} · 2 个文件</small><div class="abs" style="right:-6px;bottom:-22px">${buddy("empty", 120)}</div></div><div class="wx__card-foot">${wechat(12, "#8a8a8a")}小程序</div></div></div></div>` +
  `</div><div class="wx__input"><i></i></div></div>`;

const joinScreen =
  `<div class="ui">${navBar("加入学习计划")}<div class="body">` +
  `<div class="group plan-join jr"><div style="display:flex;align-items:center;gap:12px"><div class="avatar" style="width:46px;height:46px;background:#f8e6e8;color:#a3303f">王</div><div class="flex1"><div class="t-foot">王老师 邀请你加入</div><div class="plan-join__name">${PLAN}</div></div></div>` +
  `<div class="plan-join__members"><div class="avatar-stack">${[["明", "#e6ebf5", "#1f3b73"], ["雨", "#e3f5ea", "#1e7a47"], ["然", "#fff0e3", "#b35300"], ["欣", "#e9e0fb", "#5b37a8"]].map(([n, b, c]) => `<div class="avatar" style="background:${b};color:${c}">${n}</div>`).join("")}</div><span class="t-foot flex1">小明、思雨、浩然等 28 人已加入</span></div></div>` +
  `<div class="plan-join__label jr">作业 2</div>` +
  `<div class="jr">${hwCard({ no: 2, title: "第三单元练习", sub: "11月13日 16:30 · 2 个文件", tag: `<span class="ptag ptag--info">这次布置</span>`, open: true, files: FILES2(true) })}</div>` +
  `<div class="jr">${hwCard({ no: 1, title: "口算天天练", sub: "11月11日 08:05 · 1 个文件", open: false })}</div>` +
  `</div><div class="bottom-bar bottom-bar--col"><div class="btn">${tap("join")}加入学习计划</div><div class="plan-join__tip">${line("lock", 11, C.tertiary, 2.2)}加入后可以打开文件、扫描交作业</div></div>` +
  `<div class="dialog"><div class="dialog__mask"></div><div class="dialog__box"><h6>加入「${PLAN}」？</h6><p>你会用「小蔡」加入，王老师能看到你的名字和你交的作业。</p><div class="dialog__btns"><span>取消</span><span>${tap("ok")}加入</span></div></div></div></div>`;

/** 加入后的学习计划页（加入者看到的）。done：第 2 份已经交了 */
const planScreen = (extra = "") =>
  `<div class="ui">${navBar(PLAN)}<div class="body">` +
  `<div class="plan-head"><div class="avatar" style="width:42px;height:42px;background:#f8e6e8;color:#a3303f">王</div><div class="flex1 t-headline">王老师</div><div class="plan-iconbtn">${icon("plan-quit", 22)}</div></div>` +
  `<div class="stats"><div class="stat"><small>${line("clock", 13, C.secondary, 2.2)}待交</small><b class="num n-todo">2</b></div><div class="stat"><small>${line("checkcircle", 13, C.secondary, 2.2)}已交</small><b class="num n-done">0</b></div></div>` +
  `<div class="hw2-a">${hwCard({ no: 2, title: "第三单元练习", sub: "11月13日 16:30 · 2 个文件", tag: pending, open: true, files: FILES2(false) })}</div>` +
  `<div class="hw2-b" style="display:none">${hwCard({ no: 2, title: "第三单元练习", sub: "11月13日 16:30 · 2 个文件", tag: `<span class="ptag ptag--ok">${line("check", 12, C.ok, 3)}已交</span>`, open: false, cls: "hw--done" })}</div>` +
  `${hwCard({ no: 1, title: "口算天天练", sub: "11月11日 08:05 · 1 个文件", tag: pending, open: true, files: FILES1(false) })}` +
  `</div><div class="bottom-bar"><div class="btn btn--outline">${line("printer", 18, C.brand, 2)}导出</div><div class="btn flex1">${tap("hand")}${line("camera", 20, "#fff", 2)}交作业</div></div>${extra}</div>`;

export default function build(root) {
  const scenes = [];
  const add = (cfg) => scenes.push(makeScene(root, cfg));

  /* ───────── 开场：三步 ───────── */
  add({
    id: "s-open", from: ACTS.open[0], to: ACTS.open[1], wipe: 0,
    html: `<div class="bg bg--night"></div>${orbs([[90, 200, 170, "#2b4f96", 0.55], [470, 800, 200, "#a3303f", 0.26]])}${sparks(10, 5)}
      <div class="s-open"><p>${chars("老师在群里发作业了")}</p><h1>${chars("跟着做，")}<em>${chars("三步")}</em>${chars("搞定")}</h1></div>
      <div class="s-steps">${[["plan-joined", "加入学习计划", "点开老师发的卡片"], ["submit", "交作业", "做完拍一拍"], ["collect", "收集错题", "考卷拍下来，自动整理"]].map(([ic, a, b], i) => `<div class="s-step"><b>${i + 1}</b><div><strong>${a}</strong><small>${b}</small></div><div class="ic">${icon(ic, 42)}</div></div>`).join("")}</div><div class="vig"></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); twinkle(ctx, t);
      riseChars(ctx.qa(".s-open p .ch"), lt, 0.2, { gap: 0.04 });
      riseChars(ctx.qa(".s-open h1 .ch"), lt, 0.8, { gap: 0.07, dur: 0.7, dy: 44 });
      ctx.qa(".s-step").forEach((el, i) => { const at = T.steps[i]; const k = spring(lt, at, 2.4, 7.5); st(el, { x: (1 - k) * 80, s: 0.9 + 0.1 * k, o: p(lt, at, at + 0.2) }); });
    },
  });

  /* ───────── 第 1 步：加入学习计划 ───────── */
  add({
    id: "s-join", from: ACTS.join[0], to: ACTS.join[1], origin: "50% 60%",
    html: `<div class="bg bg--hero"></div>${orbs([[470, 240, 180, "#4f7be0", 0.45], [60, 820, 200, "#0d1c40", 0.6]])}${progress(1)}
      ${caption("1", "加入学习计划", "点开卡片，<em>一键加入</em>", "不用老师批准，微信一键登录")}
      ${phone(`<div class="fs fs0 f-wx">${wxScreen}</div><div class="fs f-join">${joinScreen}</div><div class="fs f-plan">${planScreen(`<div class="toastw"><div class="toast">已用「小蔡」加入「${PLAN}」</div></div>`)}</div>`)}
      <div class="float fj">${icon("done", 40)}<div>加入成功<small>作业和文件都能打开了</small></div></div><div class="vig"></div>`,
    update(lt, t, ctx) {
      const J = T.join;
      driftOrbs(ctx, t); capAnim(ctx, lt); phonePose(ctx, lt, 1); progAnim(ctx, lt, 1, 10);
      const [m1, m2] = [ctx.q(".m1"), ctx.q(".m2")];
      st(m1, { y: (1 - p(lt, 0.5, 0.9, E.out5)) * 20, o: p(lt, 0.5, 0.8) });
      const ck = spring(lt, 1.0, 2.6, 7.5);
      st(m2, { y: (1 - ck) * 30, o: p(lt, 1.0, 1.2) });
      st(ctx.q(".wx__card"), { s: 1 - inOut(lt, J.card - 0.15, J.card, J.card, J.card + 0.25) * 0.04 });
      push(ctx.q(".f-join"), ctx.q(".f-wx"), lt, J.card + 0.25);
      ctx.qa(".f-join .jr").forEach((el, i) => { const a = J.card + 0.55 + i * 0.1; const k = p(lt, a, a + 0.45, E.out5); st(el, { y: (1 - k) * 18, o: k }); });
      ctx.qa(".f-join .hw-file svg:last-child").forEach((el) => st(el, { s: 1 + inOut(lt, J.card + 1.4, J.card + 1.6, J.card + 1.6, J.card + 2.0) * 0.6 }));
      st(ctx.q(".f-join .btn"), { s: 1 - inOut(lt, J.join - 0.15, J.join, J.join, J.join + 0.25) * 0.04 });
      const dlg = ctx.q(".dialog");
      const dk = p(lt, J.join + 0.2, J.join + 0.5, E.out5) * (1 - p(lt, J.ok + 0.1, J.ok + 0.3));
      dlg.style.visibility = lt > J.join + 0.2 && lt < J.ok + 0.3 ? "visible" : "hidden";
      ctx.q(".dialog__mask").style.opacity = dk;
      st(ctx.q(".dialog__box"), { s: 0.9 + 0.1 * dk, o: dk });
      push(ctx.q(".f-plan"), ctx.q(".f-join"), lt, J.ok + 0.3);
      const tk = inOut(lt, J.ok + 0.8, J.ok + 1.05, J.ok + 2.8, J.ok + 3.1);
      st(ctx.q(".toast"), { s: 0.92 + 0.08 * tk, o: tk });
      const fk = spring(lt, J.ok + 1.3, 2.6, 7);
      st(ctx.q(".fj"), { x: (1 - fk) * 40, y: Math.sin(lt * 1.6) * 4, s: 0.7 + 0.3 * fk, o: p(lt, J.ok + 1.3, J.ok + 1.5) });
      tapAnim(ctx.el, lt, { card: J.card, join: J.join, ok: J.ok });
    },
  });

  /* ───────── 第 2 步：交作业 ───────── */
  {
    const r = rng(7);
    const colors = [C.brand, C.tie, C.gold, C.ok, "#ff8a3d", "#ffb4a8"];
    const bits = Array.from({ length: 26 }, (_, i) => {
      const a = ((-90 + (r() - 0.5) * 150) * Math.PI) / 180, d = 100 + r() * 120, w = 6 + r() * 5, round = r() < 0.3;
      return `<i class="cele__bit" data-x="${(Math.cos(a) * d).toFixed(1)}" data-y="${(Math.sin(a) * d + 80).toFixed(1)}" data-r="${Math.round(r() * 720 - 360)}" data-d="${(0.15 + r() * 0.12).toFixed(2)}" style="width:${w.toFixed(1)}px;height:${(round ? w : w * 1.8).toFixed(1)}px;background:${colors[i % colors.length]};border-radius:${round ? "50%" : "2px"}"></i>`;
    }).join("");
    const thumbs = [0, 1].map(() => `<div class="plan-thumb__wrap"><div class="plan-thumb"><div class="mini">${worksheet()}</div></div><div class="plan-thumb__x">${line("xmark", 10, "#fff", 3)}</div></div>`).join("");
    const extra =
      `<div class="sheetx sh-scan"><div class="sheet__mask"></div><div class="sheet__panel"><div class="sheet__grabber"></div><div class="sheet__title">拍下做完的作业</div><div class="add-grid"><div class="add-tile">${tap("shoot")}<div class="add-tile__icon">${line("camera", 28, "#fff", 2)}</div>拍照</div><div class="add-tile"><div class="add-tile__icon">${line("photo", 28, "#fff", 2)}</div>相册</div></div></div></div>` +
      `<div class="sheetx sh-hand"><div class="sheet__mask"></div><div class="sheet__panel"><div class="sheet__grabber"></div><div class="sheet__title">拍了 2 页</div><div class="plan-thumbs">${thumbs}<div class="plan-thumb__add">${line("plus", 18, C.brand, 2.4)}</div></div>` +
      `<div class="t-foot">交到哪一份作业</div><div class="field"><span>2. 第三单元练习</span>${line("chevron-down", 16, C.tertiary, 2.4)}</div><div class="t-foot">作业 2 · 11月13日 16:30 · 2 个文件</div><div class="btn" style="position:relative">${tap("give")}${line("check", 20, "#fff", 2.6)}交给老师</div></div></div>` +
      `<div class="cele"><div class="cele__veil"></div><div class="cele__burst">${bits}</div><div class="cele__center"><div class="cele__buddy">${buddy("cheer", 170)}</div><div class="cele__title">交上啦！</div><div class="cele__sub">第三单元练习</div></div></div>`;
    add({
      id: "s-hand", from: ACTS.hand[0], to: ACTS.hand[1], origin: "50% 60%",
      html: `<div class="bg bg--light"></div>${orbs([[470, 240, 180, "#c9d7f5", 0.9], [60, 780, 200, "#cfeedd", 0.8]])}${progress(2, true)}
        ${caption("2", "交作业", "拍一拍，<em>交给老师</em>", "做完的作业拍下来，选好交到哪一份", true)}
        ${phone(`<div class="fs fs0 f-plan">${planScreen(extra)}</div><div class="fs f-cam">${camScreen(worksheet())}</div>`, "phone--light")}
        <div class="float fh">${icon("submit", 40)}<div>已交 1 份<small>老师那边马上能看到</small></div></div>`,
      update(lt, t, ctx) {
        const H = T.hand;
        driftOrbs(ctx, t); capAnim(ctx, lt); phonePose(ctx, lt, -1); progAnim(ctx, lt, 2, 14);
        st(ctx.q(".bottom-bar .btn.flex1"), { s: 1 - inOut(lt, H.hand - 0.15, H.hand, H.hand, H.hand + 0.25) * 0.04 });
        sheet(ctx.q(".sh-scan"), lt, H.hand + 0.2, H.shoot + 0.1);
        // 相机盖上来，拍完收下去
        const cam = ctx.q(".f-cam");
        const ck = p(lt, H.shoot + 0.25, H.shoot + 0.7, E.io) * (1 - p(lt, H.done + 0.15, H.done + 0.55, E.io));
        cam.style.visibility = ck > 0 ? "visible" : "hidden";
        cam.style.transform = `translateY(${((1 - ck) * 100).toFixed(2)}%)`;
        camAnim(cam, lt - H.shoot - 0.5, H.shots.map((s) => s - H.shoot - 0.5), H.done - H.shoot - 0.5);
        sheet(ctx.q(".sh-hand"), lt, H.done + 0.4, H.give + 0.1);
        st(ctx.q(".sh-hand .btn"), { s: 1 - inOut(lt, H.give - 0.15, H.give, H.give, H.give + 0.25) * 0.04 });
        const fld = inOut(lt, H.done + 1.2, H.done + 1.4, H.done + 1.7, H.done + 2.0);
        ctx.q(".field").style.boxShadow = `0 0 0 ${(fld * 2.5).toFixed(2)}px #1f3b73`;
        // 庆祝：小人跳出来举手，撒纸屑，约 1.9 秒
        const c0 = H.give + 0.35, cl = lt - c0;
        const cele = ctx.q(".cele");
        cele.style.visibility = cl > 0 && cl < 1.9 ? "visible" : "hidden";
        cele.style.opacity = (p(cl, 0, 0.18) * (1 - p(cl, 1.6, 1.9))).toFixed(3);
        const jump = spring(cl, 0.05, 2.2, 5.5);
        st(ctx.q(".cele__buddy"), { y: (1 - jump) * 60, s: 0.6 + 0.4 * jump });
        st(ctx.q(".cele__title"), { y: (1 - p(cl, 0.2, 0.6, E.out5)) * 12, o: p(cl, 0.2, 0.5) });
        st(ctx.q(".cele__sub"), { y: (1 - p(cl, 0.3, 0.7, E.out5)) * 12, o: p(cl, 0.3, 0.6) });
        ctx.qa(".cele__bit").forEach((el) => { const d = +el.dataset.d; const k = p(cl, d, d + 1.2, E.out5); const fall = p(cl, d + 0.5, d + 1.5, E.in) * 60; st(el, { x: +el.dataset.x * k, y: +el.dataset.y * k - 80 * Math.sin(k * Math.PI) * 0.6 + fall, r: +el.dataset.r * k, o: cl > d ? 1 - p(cl, d + 0.9, d + 1.3) : 0 }); });
        // 交完：这一份变绿、收起，数字跟着变
        const done = lt > c0 + 0.3;
        ctx.q(".hw2-a").style.display = done ? "none" : "block";
        ctx.q(".hw2-b").style.display = done ? "block" : "none";
        ctx.q(".n-todo").textContent = done ? 1 : 2;
        ctx.q(".n-done").textContent = done ? 1 : 0;
        ctx.q(".n-done").style.color = done ? C.ok : "";
        const pulse = inOut(lt, c0 + 1.9, c0 + 2.1, c0 + 2.1, c0 + 2.6);
        st(ctx.q(".hw2-b"), { s: 1 + pulse * 0.03 });
        const fk = spring(lt, c0 + 2.2, 2.6, 7);
        st(ctx.q(".fh"), { x: (1 - fk) * -40, y: Math.sin(lt * 1.6) * 4, s: 0.7 + 0.3 * fk, o: p(lt, c0 + 2.2, c0 + 2.4) });
        tapAnim(ctx.el, lt, { hand: H.hand, shoot: H.shoot, give: H.give });
      },
    });
  }

  /* ───────── 第 3 步：收集错题 ───────── */
  {
    const sub = { 数: ["#dbe6fb", "#2f6fed"] };
    const cards = [
      ["一个三角形的两个内角是 40° 和 75°，第三个角是 ____°。", ["三角形内角和", "期中练习 第 3 题"], "你写：75 · 正确：65", 92],
      ["下列各数中最小的是（ ）A. −3  B. 0  C. 2  D. −1", ["有理数比较大小", "期中练习 第 4 题"], "你写：B · 正确：A", 87],
    ];
    const rankScreen =
      `<div class="ui">${statusBar("#1c1c1e")}<div class="capsule capsule--dark"></div><div class="nav" style="padding-right:106px"><div class="seg" style="flex:1"><div>近 7 天</div><div class="on">近 30 天</div><div>全部</div></div></div>` +
      `<div class="body" style="gap:14px"><div class="rank-head"><div class="rank-head__text"><span class="t-title1">错题榜</span><span class="t-foot">近 30 天 2 道错题</span></div><div style="margin:-6px -4px -10px 0">${buddy("chart", 100)}</div></div>` +
      `<div class="rank-panel"><div class="subject-tabs"><span class="subject-tab on">全部</span><span class="subject-tab">数学</span></div><div class="rank-boards">${["易错题", "知识点", "反复错", "空白"].map((s, i) => `<span class="chip${i ? "" : " on"}">${s}</span>`).join("")}</div><div class="rank-hint t-foot">同一知识点错得越多、越近，排得越前</div>` +
      cards.map(([title, meta, quote], i) => `<div class="rank-card"><span class="rank-badge num top">${i + 1}</span><div class="rank-card__body"><div class="rank-card__title"><span class="tile-xs" style="background:${sub.数[0]};color:${sub.数[1]}">数</span><span>${title}</span></div><div class="rank-card__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div><div class="rank-card__quote">${quote}</div></div><div class="rank-index"><span class="rank-index__num num">0</span><span class="rank-index__label">易错指数</span></div></div>`).join("") +
      `</div></div>${tabbar(2)}</div>`;
    const home = homeScreen({ scanning: true, todo: 1 }).replace('<span class="h4__actt">错题收集</span>', `${tap("collect")}<span class="h4__actt">错题收集</span>`);
    add({
      id: "s-collect", from: ACTS.collect[0], to: ACTS.collect[1], origin: "50% 60%",
      html: `<div class="bg bg--night"></div>${orbs([[450, 260, 190, "#2b4f96", 0.6], [70, 820, 190, "#a3303f", 0.3]])}${sparks(8, 11)}${progress(3)}
        ${caption("3", "收集错题", "拍下考卷，<em>错题归好</em>", "自动识别批改，错题排进错题榜")}
        ${phone(`<div class="fs fs0 f-home">${home}<div class="sheetx asheet"><div class="sheet__mask"></div><div class="sheet__panel"><div>${tap("shoot")}拍照</div><div>从相册选</div><div>取消</div></div></div></div><div class="fs f-cam">${camScreen(testPaper(true))}</div><div class="fs f-rank">${rankScreen}</div>`)}
        <div class="float fc">${icon("wrong", 40)}<div>2 道错题<small>自动进了错题榜</small></div></div><div class="vig"></div>`,
      update(lt, t, ctx) {
        const K = T.collect;
        driftOrbs(ctx, t); twinkle(ctx, t); capAnim(ctx, lt); phonePose(ctx, lt, 1); progAnim(ctx, lt, 3, 10);
        buddyIdle(ctx.q(".f-home"), lt);
        st(ctx.q(".f-home .h4__act"), { s: 1 - inOut(lt, K.collect - 0.15, K.collect, K.collect, K.collect + 0.25) * 0.04 });
        sheet(ctx.q(".asheet"), lt, K.collect + 0.2, K.shoot + 0.1);
        const cam = ctx.q(".f-cam");
        const ck = p(lt, K.shoot + 0.25, K.shoot + 0.7, E.io) * (1 - p(lt, K.done + 0.15, K.done + 0.55, E.io));
        cam.style.visibility = ck > 0 ? "visible" : "hidden";
        cam.style.transform = `translateY(${((1 - ck) * 100).toFixed(2)}%)`;
        camAnim(cam, lt - K.shoot - 0.5, K.shots.map((s) => s - K.shoot - 0.5), K.done - K.shoot - 0.5);
        // 回到首页：正在识别
        const scanOn = lt > K.done + 0.2;
        const sc = ctx.q(".scan-card");
        sc.style.display = scanOn ? "flex" : "none";
        const prog = tw(lt, K.done + 0.5, K.rank - 0.2, 8, 100, E.io);
        ctx.q(".scan-bar").style.width = prog.toFixed(1) + "%";
        ctx.q(".scan-pct").textContent = Math.round(prog) + "%";
        const sk = spring(lt, K.done + 0.3, 2.6, 7.5);
        st(sc, { s: 0.92 + 0.08 * sk, o: p(lt, K.done + 0.3, K.done + 0.5) });
        push(ctx.q(".f-rank"), ctx.q(".f-home"), lt, K.rank);
        buddyIdle(ctx.q(".f-rank"), lt);
        ctx.qa(".rank-card").forEach((el, i) => { const a = K.rank + 0.5 + i * 0.18; const k = spring(lt, a, 2.2, 7.5); st(el, { y: (1 - k) * 24, o: p(lt, a, a + 0.2) }); el.querySelector(".rank-index__num").textContent = count(lt, a + 0.1, a + 1.0, cards[i][3]); });
        const fk = spring(lt, K.rank + 1.3, 2.6, 7);
        st(ctx.q(".fc"), { x: (1 - fk) * 40, y: Math.sin(lt * 1.6) * 4, s: 0.7 + 0.3 * fk, o: p(lt, K.rank + 1.3, K.rank + 1.5) });
        tapAnim(ctx.el, lt, { collect: K.collect, shoot: K.shoot });
      },
    });
  }

  /* ───────── 落版 ───────── */
  add({
    id: "end", from: ACTS.end[0], to: ACTS.end[1], origin: "50% 40%",
    html: `<div class="bg bg--hero"></div>${orbs([[80, 140, 160, "#4f7be0", 0.45], [480, 860, 200, "#0d1c40", 0.6]])}${sparks(14, 31)}
      <div class="e-spot"></div><div class="e-buddy">${buddy("cheer", 250)}</div>
      <div class="b-word e-word">${logo(58)}<h1>${chars("上壹课")}</h1></div>
      <p class="b-tag e-tag">${chars("作业和错题，三步搞定")}</p>
      <div class="e-steps">${[["加入学习计划", "点开卡片"], ["交作业", "拍照就交"], ["收集错题", "自动整理"]].map(([a, b], i) => `<div><b>${i + 1}</b>${a}<small>${b}</small></div>`).join("")}</div>
      <div class="e-search" style="top:820px"><span class="e-search__l">${wechat(26)}微信搜一搜</span><span class="e-search__box">${line("search", 22, C.tertiary, 2.2)}<b>${chars("上壹课")}</b><i class="e-caret"></i></span></div>
      <div class="vig"></div><div class="e-fade"></div>`,
    update(lt, t, ctx) {
      driftOrbs(ctx, t); twinkle(ctx, t);
      const s = spring(lt, 0.3, 2.4, 6);
      st(ctx.q(".e-spot"), { s: 0.5 + 0.5 * p(lt, 0.1, 1.0, E.out5), o: p(lt, 0.1, 0.6) });
      st(ctx.q(".e-buddy"), { y: (1 - s) * 200 + Math.sin(lt * 2) * 4, s: 0.7 + 0.3 * s, o: p(lt, 0.3, 0.5) });
      const lk = spring(lt, 0.7, 2.6, 7);
      st(ctx.q(".e-word .logo"), { s: lk, r: (1 - lk) * -40, o: p(lt, 0.7, 0.9) });
      riseChars(ctx.qa(".e-word h1 .ch"), lt, 0.85, { gap: 0.09, dur: 0.7, dy: 40 });
      riseChars(ctx.qa(".e-tag .ch"), lt, 1.3, { gap: 0.035, dur: 0.5, dy: 18 });
      ctx.qa(".e-steps div").forEach((el, i) => { const a = T.endSteps[i]; const k = spring(lt, a, 2.6, 8); st(el, { x: (1 - k) * 40, o: p(lt, a, a + 0.15) }); });
      const sIn = p(lt, 2.9, 3.4, E.out5);
      st(ctx.q(".e-search"), { y: (1 - sIn) * 30, o: sIn });
      ctx.qa(".e-search__box .ch").forEach((el, i) => { el.style.opacity = lt > 3.5 + i * 0.22 ? 1 : 0; });
      ctx.q(".e-caret").style.opacity = lt > 3.3 && Math.floor(lt * 2.5) % 2 === 0 ? 1 : 0;
      ctx.q(".e-fade").style.opacity = p(lt, 5.3, 5.95, E.io);
    },
  });

  return { id: "student", title: "上壹课 · 学生三步", duration: DURATION, render(t) { for (const s of scenes) s.render(t); } };
}
