// 总览片的配乐（原创，代码合成）。D 大调，120 拍/分，四小节一循环：Bm7 → Gmaj7 → D → A。
// 结构跟着画面走：提问（只有铺底）→ 品牌亮相（旋律进来）→ 六个功能（鼓和贝斯进来，每换一幕有一次推高和重音）→ 落版（收在主和弦上）。
import { Bus, hz, pad, pluck, bell, bass, kick, clap, hat, riser, impact, shutter, ding, pop, shimmer, delay, reverb, duck, master } from "./synth.mjs";
import { ACTS, CUES, DURATION, BPM } from "../src/films/overview.timing.js";

const BEAT = 60 / BPM, BAR = BEAT * 4;
const CHORDS = [
  { root: "B1", tones: ["B3", "D4", "F#4", "A4"] },
  { root: "G1", tones: ["G3", "B3", "D4", "F#4"] },
  { root: "D2", tones: ["A3", "D4", "F#4", "A4"] },
  { root: "A1", tones: ["A3", "C#4", "E4", "A4"] },
];
// 主旋律：[拍, 音, 时值（拍）]
const MELODY = [
  [[0, "F#5", 1], [1.5, "A5", 0.5], [2, "B5", 1.5], [3.5, "A5", 0.5]],
  [[0, "B5", 1], [1.5, "D6", 0.5], [2, "B5", 2]],
  [[0, "A5", 1], [1.5, "F#5", 0.5], [2, "A5", 1.5], [3.5, "D6", 0.5]],
  [[0, "E6", 1.5], [1.5, "C#6", 0.5], [2, "A5", 2]],
];
const ARP = [0, 1, 2, 1, 3, 2, 1, 2];

export default function score() {
  const bars = Math.ceil(DURATION / BAR);
  const music = new Bus(DURATION), drums = new Bus(DURATION), lead = new Bus(DURATION), fx = new Bus(DURATION), low = new Bus(DURATION);
  const bounds = Object.values(ACTS).map(([a]) => a).filter((a) => a > 0);
  const endAt = ACTS.end[0];
  const grooveFrom = ACTS.scan[0];
  const kicks = [];

  for (let b = 0; b < bars; b++) {
    const t = b * BAR;
    if (t >= DURATION - 0.5) break;
    const ch = CHORDS[b % 4];
    const inHook = t < ACTS.brand[0], inBrand = t >= ACTS.brand[0] && t < grooveFrom, inEnd = t >= endAt;
    const groove = t >= grooveFrom && !inEnd;
    const lastBarOfAct = bounds.includes(t + BAR);
    const high = t >= ACTS.export[0] && !inEnd;

    // 铺底
    if (!inEnd) pad(music, t, BAR, ch.tones.map(hz), { gain: inHook ? 0.15 : 0.1, cutoff: inHook ? 700 : groove ? 1900 : 1400 });
    // 拨弦分解和弦
    if (!inHook && !inEnd) {
      for (let s = 0; s < 8; s++) {
        if (lastBarOfAct && s >= 6) continue;
        const f = hz(ch.tones[ARP[s]]) * 2;
        pluck(lead, t + s * BEAT / 2, f, { gain: inBrand ? 0.16 : 0.17, p: s % 2 ? 0.45 : -0.45, bright: groove ? 5200 : 3200 });
        if (high && s % 2 === 0) pluck(lead, t + s * BEAT / 2 + BEAT / 4, f * 2, { gain: 0.07, p: s % 4 ? -0.6 : 0.6 });
      }
    }
    // 旋律：提问那一幕只点几个音，之后每四小节一句
    if (inHook) { bell(lead, t, hz(ch.tones[2]) * 2, { gain: 0.13, dur: 1.8 }); bell(lead, t + BEAT * 2.5, hz(ch.tones[3]) * 2, { gain: 0.1, dur: 1.4, p: 0.4 }); }
    else if (!inEnd) for (const [beat, n, d] of MELODY[b % 4]) bell(lead, t + beat * BEAT, hz(n), { gain: groove ? 0.16 : 0.17, dur: d * BEAT + 0.6, p: beat % 2 ? 0.25 : -0.25 });
    // 贝斯和鼓
    if (groove) {
      for (let s = 0; s < 8; s++) {
        if (lastBarOfAct && s >= 6) continue;
        bass(low, t + s * BEAT / 2, hz(ch.root) * (s === 3 || s === 7 ? 2 : 1), { gain: 0.13 });
      }
      for (let q = 0; q < 4; q++) {
        if (lastBarOfAct && q === 3) continue;
        kick(drums, t + q * BEAT, 0.55); kicks.push(t + q * BEAT);
        if (q % 2 === 1) clap(drums, t + q * BEAT, 0.32);
        hat(drums, t + q * BEAT + BEAT / 2, 0.13);
        if (high) hat(drums, t + q * BEAT + BEAT / 4, 0.04, 110), hat(drums, t + q * BEAT + BEAT * 0.75, 0.04, 110);
      }
      if (lastBarOfAct) { for (let k = 0; k < 4; k++) clap(drums, t + 3 * BEAT + k * BEAT / 4, 0.1 + k * 0.05); }
    }
    if (inBrand && b % 4 === 3) for (let q = 0; q < 4; q++) hat(drums, t + q * BEAT + BEAT / 2, 0.06);
    if (lastBarOfAct || t + BAR === ACTS.brand[0]) riser(fx, t + BAR - 1.5, 1.5, t + BAR === endAt ? 0.2 : 0.13);
  }
  // 换幕重音
  for (const t of bounds) impact(fx, t, t === ACTS.brand[0] || t === endAt ? 0.36 : 0.2);
  // 落版：主和弦铺开，旋律往上收
  pad(music, endAt, 3.6, ["D3", "A3", "D4", "F#4", "A4", "E5"].map(hz), { gain: 0.12, cutoff: 2400, attack: 0.05, release: 2.2 });
  bass(low, endAt, hz("D2"), { gain: 0.2, dur: 1.4 });
  [["F#5", 0], ["A5", 0.25], ["D6", 0.5], ["E6", 0.75], ["F#6", 1.0], ["A6", 1.5], ["D7", 2.5]].forEach(([n, at], i) => bell(lead, endAt + at, hz(n), { gain: 0.16, dur: 2.4, p: i % 2 ? 0.3 : -0.3 }));
  ["D4", "F#4", "A4", "D5", "F#5", "A5", "D6", "A5"].forEach((n, i) => pluck(lead, endAt + i * BEAT / 2, hz(n), { gain: 0.16, p: i % 2 ? 0.4 : -0.4 }));

  // 跟画面的音效
  CUES.shutter.forEach((t) => shutter(fx, t));
  CUES.ding.forEach((t, i) => ding(fx, t, i));
  CUES.pop.forEach((t) => pop(fx, t));
  CUES.sweep.forEach((t) => shimmer(fx, t, 2.3));

  duck(music, kicks, 0.5); duck(low, kicks, 0.6, 0.2); duck(lead, kicks, 0.2);
  delay(lead, BEAT * 0.75, 0.32, 0.28);
  const mix = new Bus(DURATION);
  const send = new Bus(DURATION);
  music.mixInto(mix, 1); lead.mixInto(mix, 1); low.mixInto(mix, 1); drums.mixInto(mix, 0.8); fx.mixInto(mix, 1);
  music.mixInto(send, 0.6); lead.mixInto(send, 0.8); fx.mixInto(send, 0.7); drums.mixInto(send, 0.12);
  reverb(send, 0.3, 1.25).mixInto(mix, 1);
  return master(mix, { fadeOut: 1.8 });
}
