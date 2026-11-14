// 很小的一套软件合成器：振荡器、包络、滤波、混响、延迟，全部用代码算出采样，不用任何录音素材。
export const SR = 44100;
export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
/** "F#5" → 频率 */
export const hz = (name) => { const m = /^([A-G]#?)(-?\d)$/.exec(name); return midi(NOTE[m[1]] + (Number(m[2]) + 1) * 12); };

export class Bus {
  constructor(seconds) { this.n = Math.ceil(seconds * SR); this.l = new Float32Array(this.n); this.r = new Float32Array(this.n); }
  add(i, l, r) { if (i >= 0 && i < this.n) { this.l[i] += l; this.r[i] += r; } }
  mixInto(dst, gain = 1) { for (let i = 0; i < this.n; i++) { dst.l[i] += this.l[i] * gain; dst.r[i] += this.r[i] * gain; } }
}

let seed = 12345;
export const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
const tri = (ph) => 2 * Math.abs(saw(ph)) - 1;
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

/** 状态变量滤波器 */
class SVF {
  constructor() { this.low = 0; this.band = 0; }
  run(x, fc, q = 0.7) {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR * 0.22) / SR);
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return { low: this.low, band: this.band, high };
  }
}

/** 铺底：三个略微失谐的锯齿波，慢起慢落 */
export function pad(bus, t, dur, freqs, { gain = 0.1, cutoff = 1400, attack = 0.5, release = 0.9 } = {}) {
  const start = Math.floor(t * SR), len = Math.floor((dur + release) * SR);
  freqs.forEach((f, k) => {
    const [pl, pr] = pan(((k % 3) - 1) * 0.5);
    const fl = new SVF();
    const det = [0.996, 1, 1.005];
    const ph = [0.1 * k, 0.37, 0.71];
    for (let i = 0; i < len; i++) {
      const x = i / SR;
      const env = Math.min(1, x / attack) * (x > dur ? Math.max(0, 1 - (x - dur) / release) : 1);
      let s = 0;
      for (let d = 0; d < 3; d++) { ph[d] += (f * det[d]) / SR; s += saw(ph[d]); }
      const y = fl.run(s / 3, cutoff * (0.7 + 0.3 * Math.sin(x * 0.9 + k)), 0.9).low * env * gain;
      bus.add(start + i, y * pl, y * pr);
    }
  });
}

/** 拨弦：滤波随包络快速收拢 */
export function pluck(bus, t, f, { gain = 0.2, dur = 0.35, bright = 4200, p = 0 } = {}) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  const [pl, pr] = pan(p);
  const fl = new SVF();
  let ph = 0, ph2 = 0.25;
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    const env = Math.exp(-x * 9) * Math.min(1, x * 400);
    ph += f / SR; ph2 += (f * 2.005) / SR;
    const s = saw(ph) * 0.7 + tri(ph2) * 0.3;
    const y = fl.run(s, 300 + bright * Math.exp(-x * 14), 0.6).low * env * gain;
    bus.add(start + i, y * pl, y * pr);
  }
}

/** 钟琴：调频合成，清亮带一点金属感 */
export function bell(bus, t, f, { gain = 0.16, dur = 1.2, p = 0, ratio = 3.5, depth = 1.4 } = {}) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  const [pl, pr] = pan(p);
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    const env = Math.exp(-x * 3.6) * Math.min(1, x * 600);
    const mod = Math.sin(2 * Math.PI * f * ratio * x) * depth * Math.exp(-x * 7);
    const y = (Math.sin(2 * Math.PI * f * x + mod) + 0.35 * Math.sin(2 * Math.PI * f * 2 * x)) * env * gain;
    bus.add(start + i, y * pl, y * pr);
  }
}

export function bass(bus, t, f, { gain = 0.3, dur = 0.24 } = {}) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  const fl = new SVF();
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    const env = Math.min(1, x * 300) * Math.min(1, (dur - x) * 60);
    ph += f / SR;
    const y = (Math.sin(2 * Math.PI * ph) * 0.8 + fl.run(saw(ph), 500, 0.8).low * 0.35) * env * gain;
    bus.add(start + i, y, y);
  }
}

export function kick(bus, t, gain = 0.9) {
  const start = Math.floor(t * SR), len = Math.floor(0.32 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    ph += (46 + 110 * Math.exp(-x * 34)) / SR;
    const y = (Math.sin(2 * Math.PI * ph) * Math.exp(-x * 11) + noise() * 0.12 * Math.exp(-x * 220)) * gain;
    bus.add(start + i, y, y);
  }
}

export function clap(bus, t, gain = 0.3) {
  const start = Math.floor(t * SR), len = Math.floor(0.22 * SR);
  const fl = new SVF();
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    const burst = Math.exp(-((x % 0.011) * 260)) * (x < 0.033 ? 1 : 0) + Math.exp(-(x - 0.033) * 26) * (x >= 0.033 ? 1 : 0);
    const y = fl.run(noise(), 1500, 0.5).band * burst * gain;
    bus.add(start + i, y * 0.95, y * 1.05);
  }
}

export function hat(bus, t, gain = 0.1, decay = 70) {
  const start = Math.floor(t * SR), len = Math.floor(0.09 * SR);
  const fl = new SVF();
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    const y = fl.run(noise(), 8000, 0.9).high * Math.exp(-x * decay) * gain;
    bus.add(start + i, y * 0.8, y * 1.1);
  }
}

/** 上扬的气声：一幕结束前把情绪推上去 */
export function riser(bus, t, dur, gain = 0.16) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  const fl = new SVF();
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const y = fl.run(noise(), 500 + 7000 * k * k, 0.35).band * k * k * gain;
    const w = Math.sin(k * 40);
    bus.add(start + i, y * (1 + 0.3 * w), y * (1 - 0.3 * w));
  }
}

/** 换幕的重音：低频一沉 + 一片散开的气声 */
export function impact(bus, t, gain = 0.5) {
  const start = Math.floor(t * SR), len = Math.floor(1.6 * SR);
  const fl = new SVF();
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / SR;
    ph += (38 + 50 * Math.exp(-x * 12)) / SR;
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-x * 4.2);
    const air = fl.run(noise(), 6000 * Math.exp(-x * 2.4) + 400, 0.8).low * Math.exp(-x * 3.2) * 0.5;
    bus.add(start + i, (boom + air) * gain, (boom + air * 0.9) * gain);
  }
}

/* ───── 音效 ───── */
export function shutter(bus, t, gain = 0.35) {
  for (const [dt, g] of [[0, 1], [0.07, 0.7]]) {
    const start = Math.floor((t + dt) * SR), len = Math.floor(0.05 * SR);
    const fl = new SVF();
    for (let i = 0; i < len; i++) { const x = i / SR; const y = fl.run(noise(), 3200, 0.4).band * Math.exp(-x * 120) * gain * g; bus.add(start + i, y, y); }
  }
}
export const ding = (bus, t, k = 0, gain = 0.1) => bell(bus, t, hz(["A6", "B6", "D7", "E7", "F#7"][k % 5]), { gain, dur: 0.7, p: (k % 2 ? 0.4 : -0.4), ratio: 2, depth: 0.5 });
export function pop(bus, t, gain = 0.14) {
  const start = Math.floor(t * SR), len = Math.floor(0.12 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) { const x = i / SR; ph += (420 + 900 * x / 0.12) / SR; const y = Math.sin(2 * Math.PI * ph) * Math.exp(-x * 30) * Math.min(1, x * 800) * gain; bus.add(start + i, y, y); }
}
export function shimmer(bus, t, dur, gain = 0.1) {
  const start = Math.floor(t * SR), len = Math.floor(dur * SR);
  const fl = new SVF();
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const y = fl.run(noise(), 5000 + 3000 * Math.sin(k * Math.PI), 0.25).band * Math.sin(k * Math.PI) * gain;
    bus.add(start + i, y * (1 - k), y * k);
  }
}

/* ───── 效果 ───── */
/** 乒乓延迟 */
export function delay(bus, time, feedback = 0.35, wet = 0.3) {
  const d = Math.floor(time * SR);
  const out = new Bus(bus.n / SR);
  for (let i = 0; i < bus.n; i++) {
    const il = bus.l[i] + (i >= d ? out.r[i - d] * feedback : 0);
    const ir = bus.r[i] + (i >= d ? out.l[i - d] * feedback : 0);
    out.l[i] = il; out.r[i] = ir;
  }
  for (let i = bus.n - 1; i >= 0; i--) { bus.l[i] += (i >= d ? out.l[i - d] : 0) * wet; bus.r[i] += (i >= d ? out.r[i - d] : 0) * wet; }
}

/** 混响（Schroeder：四个梳状滤波器并联 + 两个全通串联） */
export function reverb(src, wet = 0.25, size = 1) {
  const out = new Bus(src.n / SR);
  for (const [ch, off] of [["l", 0], ["r", 23]]) {
    const x = src[ch], y = out[ch];
    const combs = [1557, 1617, 1491, 1422].map((n) => ({ buf: new Float32Array(Math.floor((n + off) * size)), i: 0, lp: 0 }));
    const aps = [225, 556].map((n) => ({ buf: new Float32Array(n + off), i: 0 }));
    for (let i = 0; i < src.n; i++) {
      let s = 0;
      for (const c of combs) {
        const o = c.buf[c.i];
        c.lp = o * 0.7 + c.lp * 0.3;
        c.buf[c.i] = x[i] + c.lp * 0.84;
        c.i = (c.i + 1) % c.buf.length;
        s += o;
      }
      s *= 0.25;
      for (const a of aps) { const o = a.buf[a.i]; a.buf[a.i] = s + o * 0.5; a.i = (a.i + 1) % a.buf.length; s = o - s * 0.5; }
      y[i] = s * wet;
    }
  }
  return out;
}

/** 侧链：底鼓响的时候把别的声部压一下，律动更明显 */
export function duck(bus, times, depth = 0.55, release = 0.28) {
  const env = new Float32Array(bus.n).fill(1);
  for (const t of times) {
    const s = Math.floor(t * SR), len = Math.floor(release * SR);
    for (let i = 0; i < len && s + i < bus.n; i++) env[s + i] = Math.min(env[s + i], 1 - depth * (1 - i / len) ** 2);
  }
  for (let i = 0; i < bus.n; i++) { bus.l[i] *= env[i]; bus.r[i] *= env[i]; }
}

/** 母带：软限幅、归一化（整体约 −14 LUFS）、首尾淡入淡出，返回 16 位立体声 WAV */
export function master(bus, { fadeOut = 1.6, peak = 0.74 } = {}) {
  let max = 0;
  for (let i = 0; i < bus.n; i++) {
    bus.l[i] = Math.tanh(bus.l[i] * 1.25); bus.r[i] = Math.tanh(bus.r[i] * 1.25);
    max = Math.max(max, Math.abs(bus.l[i]), Math.abs(bus.r[i]));
  }
  const g = peak / max, fo = Math.floor(fadeOut * SR);
  const pcm = Buffer.alloc(44 + bus.n * 4);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + bus.n * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(bus.n * 4, 40);
  let sum = 0;
  for (let i = 0; i < bus.n; i++) {
    const f = Math.min(1, i / 400) * Math.min(1, (bus.n - i) / fo);
    const l = bus.l[i] * g * f, r = bus.r[i] * g * f;
    sum += l * l + r * r;
    pcm.writeInt16LE(Math.round(l * 32767), 44 + i * 4); pcm.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return { wav: pcm, rms: Math.sqrt(sum / (bus.n * 2)) };
}
