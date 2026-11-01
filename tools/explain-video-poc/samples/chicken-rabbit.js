export default async function create(kit) {
  const { THREE, scene, COLORS, text, tex, fade, seg, lerp, ease, clamp } = kit;

  // ---------------- 小动物：一开始都是鸡（2 条腿），变成兔时多长 2 条腿和一对耳朵
  const CHICK = new THREE.Color("#F2C14E");
  const RABBIT = new THREE.Color("#C8BBD9");
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true });

  function makeAnimal() {
    const g = new THREE.Group();
    const bodyMat = mat(CHICK.clone());
    const body = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), bodyMat);
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.24, 32), bodyMat);
    head.position.set(0.3, 0.36, 0.01);
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), mat(COLORS.ink));
    eye.position.set(0.37, 0.42, 0.02);
    const beakShape = new THREE.Shape([new THREE.Vector2(0, 0.06), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, -0.06)]);
    const beak = new THREE.Mesh(new THREE.ShapeGeometry(beakShape), mat("#E8892B"));
    beak.position.set(0.52, 0.36, 0.02);
    const earGeo = new THREE.CircleGeometry(0.1, 24); earGeo.scale(1, 2.6, 1);
    const ears = [0.2, 0.36].map((x) => {
      const e = new THREE.Mesh(earGeo, bodyMat);
      e.position.set(x, 0.62, 0); e.rotation.z = -0.15; return e;
    });
    const legGeo = new THREE.PlaneGeometry(0.075, 0.42); legGeo.translate(0, -0.21, 0);
    const legMat = mat("#B5651D");
    const legs = [-0.3, -0.1, 0.1, 0.3].map((x) => {
      const l = new THREE.Mesh(legGeo, legMat);
      l.position.set(x, -0.36, -0.01); return l;
    });
    g.add(body, head, eye, beak, ...ears, ...legs);
    return { g, bodyMat, beak, ears, legs };
  }

  const COLS = [-3.15, -1.05, 1.05, 3.15];
  const ROWS = [1.1, -1.7];
  const animals = [];
  for (let i = 0; i < 8; i++) {
    const a = makeAnimal();
    a.home = new THREE.Vector3(COLS[i % 4], ROWS[Math.floor(i / 4)], 0);
    a.g.position.copy(a.home);
    scene.add(a.g);
    animals.push(a);
  }
  const toRabbit = [5, 6, 7];
  const convertAt = [27.6, 31.2, 34.8];

  // ---------------- 文字和公式
  const q = await text("笼子里有鸡和兔一共 8 只，\n从下面数，有 22 只脚。\n鸡和兔各有几只？", { size: 0.52, weight: 700, color: COLORS.ink, lineHeight: 1.6 });
  q.position.set(0, 1.6, 0);
  const qKey8 = await text("8 只", { size: 0.6, weight: 700, color: "#FFFFFF", bg: COLORS.navy, padding: 0.12 });
  const qKey22 = await text("22 只脚", { size: 0.6, weight: 700, color: "#FFFFFF", bg: COLORS.wine, padding: 0.12 });
  qKey8.position.set(-1.7, -1.6, 0); qKey22.position.set(1.5, -1.6, 0);

  const summary = await text("共 8 只  ·  共 22 只脚", { size: 0.42, weight: 700, color: COLORS.navy, bg: COLORS.light, padding: 0.14 });
  summary.position.set(0, 5.3, 0);
  const assume = await text("假设：8 只全是鸡", { size: 0.5, weight: 700, color: COLORS.wine });
  assume.position.set(0, 3.6, 0);

  const f16 = await tex("8\\times 2=16", { size: 0.7, color: COLORS.ink });
  f16.position.set(0, -3.75, 0);
  const f16note = await text("只有 16 只脚", { size: 0.42, color: COLORS.gray });
  f16note.position.set(0, -4.85, 0);
  const f6 = await tex("22-16=6", { size: 0.7, color: COLORS.red });
  f6.position.set(0, -3.75, 0);
  const f6note = await text("比实际少了 6 只脚", { size: 0.42, weight: 700, color: COLORS.red });
  f6note.position.set(0, -4.85, 0);

  const plus2 = await text("每换 1 只兔，多 2 只脚", { size: 0.5, weight: 700, color: COLORS.wine });
  plus2.position.set(0, 3.6, 0);
  const counters = [];
  for (const n of [16, 18, 20, 22]) {
    const m = await text(`脚：${n} 只`, { size: 0.62, weight: 700, color: n === 22 ? COLORS.green : COLORS.ink });
    m.position.set(0, -4.1, 0); counters.push(m);
  }
  const bubbles = [];
  for (const i of toRabbit) {
    const b = await text("+2", { size: 0.42, weight: 700, color: "#FFFFFF", bg: COLORS.green, padding: 0.08 });
    b.position.set(animals[i].home.x, animals[i].home.y + 1.25, 0.1); bubbles.push(b);
  }

  const fR = await tex("6\\div 2=3", { size: 0.66, color: COLORS.ink });
  fR.position.set(0, -3.6, 0);
  const fRlab = await text("兔", { size: 0.45, weight: 700, color: COLORS.wine });
  fRlab.position.set(-2.4, -3.6, 0);
  const fC = await tex("8-3=5", { size: 0.66, color: COLORS.ink });
  fC.position.set(0, -4.75, 0);
  const fClab = await text("鸡", { size: 0.45, weight: 700, color: "#B07A12" });
  fClab.position.set(-2.4, -4.75, 0);
  const lab3 = await text("兔 3 只", { size: 0.46, weight: 700, color: "#FFFFFF", bg: COLORS.wine, padding: 0.1 });
  const lab5 = await text("鸡 5 只", { size: 0.46, weight: 700, color: COLORS.ink, bg: "#F7DC8F", padding: 0.1 });
  lab3.position.set(2.1, 3.6, 0); lab5.position.set(-1.6, 3.6, 0);

  const check = await tex("5\\times 2+3\\times 4=22", { size: 0.62, color: COLORS.ink });
  check.position.set(0, -3.6, 0);
  const answer = await text("答：鸡 5 只，兔 3 只", { size: 0.56, weight: 700, color: COLORS.green });
  answer.position.set(0, -4.8, 0);

  const tipTitle = await text("下次遇到这类题", { size: 0.6, weight: 700, color: COLORS.navy });
  tipTitle.position.set(0, 4.3, 0);
  const steps = [];
  const stepTexts = ["① 先假设全是鸡", "② 算一算少了几只脚", "③ 少的脚 ÷ 2 = 兔的只数"];
  for (let i = 0; i < 3; i++) {
    const s = await text(stepTexts[i], { size: 0.5, weight: 700, color: COLORS.ink, bg: COLORS.paper, padding: 0.22, align: "center" });
    s.position.set(0, 2.4 - i * 1.6, 0); steps.push(s);
  }

  scene.add(q, qKey8, qKey22, summary, assume, f16, f16note, f6, f6note, plus2, ...counters, ...bubbles,
    fR, fRlab, fC, fClab, lab3, lab5, check, answer, tipTitle, ...steps);

  // 出现 / 消失：从 a 开始用 d 秒淡入，到 b 前 0.4 秒淡出
  const show = (obj, t, a, b, d = 0.5, pop = false) => {
    const k = Math.min(ease.out(seg(t, a, a + d)), 1 - seg(t, b - 0.4, b));
    fade(obj, k);
    if (pop) { const s = lerp(0.6, 1, ease.outBack(seg(t, a, a + d))); obj.scale.setScalar(s); }
  };

  const scenes = [
    { from: 0, to: 8, caption: "鸡和兔一共 8 只，一共 22 只脚，各几只？", narration: "先把题读给孩子听，问问：一只鸡几只脚？一只兔几只脚？" },
    { from: 8, to: 17, caption: "先假设 8 只全是鸡：8 × 2 = 16 只脚", narration: "我们先「假装」笼子里全是鸡。一只鸡 2 只脚，8 只鸡就是 16 只脚。" },
    { from: 17, to: 25, caption: "可实际有 22 只脚，少了 22 − 16 = 6 只", narration: "先别往下看，问问孩子：为什么会少脚？少掉的脚去哪了？" },
    { from: 25, to: 39, caption: "把一只鸡换成兔，脚就多 2 只", narration: "每把一只鸡换成兔，就多长出 2 只脚。我们一只一只换，数到 22 为止。" },
    { from: 39, to: 48, caption: "兔：6 ÷ 2 = 3 只，鸡：8 − 3 = 5 只", narration: "少的 6 只脚，每只兔补 2 只，所以兔有 3 只，剩下的 5 只是鸡。" },
    { from: 48, to: 56, caption: "验算：5 × 2 + 3 × 4 = 22，对了！", narration: "让孩子自己验算一遍：鸡的脚加兔的脚，正好 22 只。" },
    { from: 56, to: 64, caption: "下次注意：先假设，再看差多少", narration: "这个方法叫「假设法」。让孩子用自己的话把三步说一遍。" },
  ];

  return {
    title: "鸡兔同笼：假设法",
    duration: 64,
    scenes,
    render(t) {
      // 第 1 幕：题目
      show(q, t, 0.3, 8, 0.7);
      show(qKey8, t, 2.6, 8, 0.5, true);
      show(qKey22, t, 3.6, 8, 0.5, true);
      // 顶部概要：第 2 幕起一直在
      show(summary, t, 8.2, 56, 0.5);
      show(assume, t, 8.4, 17, 0.5);

      // 小动物：第 2 幕依次弹出，第 7 幕淡出
      animals.forEach((a, i) => {
        const appear = 9.0 + i * 0.35;
        const k = Math.min(ease.outBack(seg(t, appear, appear + 0.6)), 1 - seg(t, 55.6, 56.2));
        a.g.visible = k > 0.001;
        a.g.scale.setScalar(Math.max(0.0001, k));
        // 第 3 幕：轻轻跳两下，提醒「脚不够」
        const hop = ease.pulse(seg(t, 18.5 + (i % 4) * 0.1, 19.1 + (i % 4) * 0.1)) * 0.18;
        const ri = toRabbit.indexOf(i);
        const rabbitHop = ri >= 0 ? ease.pulse(seg(t, 40.6 + ri * 0.15, 41.2 + ri * 0.15)) * 0.25 : 0;
        a.g.position.set(a.home.x, a.home.y + hop + rabbitHop, 0);
        // 变兔
        const ci = toRabbit.indexOf(i);
        const r = ci >= 0 ? ease.inOut(seg(t, convertAt[ci], convertAt[ci] + 1.0)) : 0;
        a.bodyMat.color.copy(CHICK).lerp(RABBIT, r);
        a.legs[0].scale.y = Math.max(0.0001, r);
        a.legs[3].scale.y = Math.max(0.0001, r);
        a.legs[0].visible = a.legs[3].visible = r > 0.001;
        a.ears.forEach((e) => { e.visible = r > 0.001; e.scale.setScalar(Math.max(0.0001, r)); });
        a.beak.visible = r < 0.5;
        // 第 3 幕：腿闪红，表示「脚少了」
        const warn = ease.pulse(seg(t, 20.0, 22.0));
        a.legs[1].material.color.set("#B5651D").lerp(new THREE.Color(COLORS.red), warn);
      });

      // 第 2 幕：算 16
      show(f16, t, 12.6, 17, 0.6, true);
      show(f16note, t, 13.6, 17, 0.5);
      // 第 3 幕：少 6
      show(f6, t, 17.4, 25, 0.6, true);
      show(f6note, t, 19.0, 25, 0.5);
      // 第 4 幕：逐只换成兔，脚数 16 → 22
      show(plus2, t, 25.3, 39, 0.5);
      const level = convertAt.filter((c) => t >= c + 0.5).length;
      counters.forEach((m, n) => {
        const on = t >= 25.6 && t < 39 && n === level;
        fade(m, on ? Math.min(seg(t, 25.6, 26.1), 1 - seg(t, 38.6, 39)) : 0);
        m.scale.setScalar(on && n > 0 ? lerp(1.25, 1, ease.out(seg(t, convertAt[n - 1] + 0.5, convertAt[n - 1] + 0.9))) : 1);
      });
      bubbles.forEach((b, k) => {
        const a = convertAt[k];
        const x = seg(t, a + 0.2, a + 2.0);
        fade(b, t < 39 ? Math.min(seg(t, a + 0.2, a + 0.5), 1 - seg(t, a + 1.6, a + 2.0)) : 0);
        b.position.y = animals[toRabbit[k]].home.y + 1.1 + x * 0.5;
      });
      // 第 5 幕：算式
      show(fRlab, t, 39.3, 48, 0.4);
      show(fR, t, 39.3, 48, 0.6, true);
      show(fClab, t, 42.0, 48, 0.4);
      show(fC, t, 42.0, 48, 0.6, true);
      show(lab3, t, 40.5, 56, 0.5, true);
      show(lab5, t, 43.0, 56, 0.5, true);
      // 第 6 幕：验算和答案
      show(check, t, 48.3, 56, 0.6, true);
      show(answer, t, 50.5, 56, 0.6, true);
      // 第 7 幕：三步
      show(tipTitle, t, 56.4, 65, 0.5);
      steps.forEach((s, i) => show(s, t, 57.2 + i * 1.3, 65, 0.6, true));
    },
  };
}
