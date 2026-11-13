// 时间轴小工具：所有画面都是时间 t（秒）的纯函数，渲染器逐帧调用 render(t) 后截图，结果可重复。
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;

export const E = {
  lin: (x) => x,
  out: (x) => 1 - Math.pow(1 - x, 3),
  out5: (x) => 1 - Math.pow(1 - x, 5),
  in: (x) => x * x * x,
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  back: (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2),
};

/** t 在 [a, b] 里走到哪了（0–1），带缓动 */
export const p = (t, a, b, ease = E.out) => ease(clamp((t - a) / (b - a)));
/** 从 v0 到 v1 */
export const tw = (t, a, b, v0, v1, ease = E.out) => lerp(v0, v1, p(t, a, b, ease));
/** 阻尼弹簧：从 0 弹到 1，略过冲 */
export const spring = (t, start, freq = 3.2, damp = 7) => {
  const x = t - start;
  if (x <= 0) return 0;
  return 1 - Math.exp(-damp * x) * Math.cos(freq * Math.PI * 2 * x * 0.5);
};
/** 进场再出场：0→1→0 */
export const inOut = (t, a, b, c, d, e1 = E.out, e2 = E.in) => p(t, a, b, e1) * (1 - p(t, c, d, e2));

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => [...root.querySelectorAll(sel)];

/** 设置位移 / 缩放 / 旋转 / 透明度 / 模糊 */
export function st(el, { x = 0, y = 0, s = 1, r = 0, o, blur, sx, sy } = {}) {
  if (!el) return;
  el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${r.toFixed(3)}deg) scale(${(sx ?? s).toFixed(4)},${(sy ?? s).toFixed(4)})`;
  if (o !== undefined) el.style.opacity = clamp(o).toFixed(3);
  if (blur !== undefined) el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
}

/** 把一行字拆成逐字 span，返回 HTML */
export const chars = (text, cls = "ch") => [...text].map((c) => `<span class="${cls}">${c === " " ? "&nbsp;" : c}</span>`).join("");

/** 逐字上浮进场 */
export function riseChars(els, t, start, { gap = 0.045, dur = 0.55, dy = 26 } = {}) {
  els.forEach((el, i) => {
    const k = p(t, start + i * gap, start + i * gap + dur, E.out5);
    st(el, { y: (1 - k) * dy, o: k, blur: (1 - k) * 6 });
  });
}

/** 确定性的伪随机数 */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 数字滚动 */
export const count = (t, a, b, to, from = 0) => Math.round(tw(t, a, b, from, to, E.out));

/**
 * 一幕：在 [from, to] 之间显示。进场用圆形展开（从 origin 点）或直接出现，
 * update(lt, t) 里 lt 是这一幕自己的时间（从 0 起）。
 */
export function makeScene(root, { id, from, to, html, origin = "50% 50%", wipe = 0.7, update }) {
  const el = document.createElement("section");
  el.className = `scene scene--${id}`;
  el.innerHTML = html;
  root.appendChild(el);
  const ctx = { el, q: (s) => $(el, s), qa: (s) => $$(el, s) };
  return {
    id,
    from,
    to,
    el,
    ctx,
    render(t) {
      // 下一幕展开时盖在上面，这一幕多留一小段
      const on = t >= from && t < to + 0.8;
      el.style.visibility = on ? "visible" : "hidden";
      // 幕里有些元素自己设了 visibility: visible，会透出隐藏的父级；不在场的幕整个不参与排版
      el.style.display = on ? "block" : "none";
      if (!on) return;
      if (wipe > 0 && from > 0) {
        const k = p(t, from, from + wipe, E.io);
        el.style.clipPath = k >= 1 ? "none" : `circle(${(k * 150).toFixed(2)}% at ${origin})`;
      }
      update(t - from, t, ctx);
    },
  };
}
