// 总览片的配乐。D 大调，120 拍/分，四小节一循环：Bm7 → Gmaj7 → D → A。
import { compose } from "./compose.mjs";
import { ACTS, CUES, DURATION, BPM } from "../src/films/overview.timing.js";

export default () => compose({
  ACTS, CUES, DURATION, BPM,
  CHORDS: [
    { root: "B1", tones: ["B3", "D4", "F#4", "A4"] },
    { root: "G1", tones: ["G3", "B3", "D4", "F#4"] },
    { root: "D2", tones: ["A3", "D4", "F#4", "A4"] },
    { root: "A1", tones: ["A3", "C#4", "E4", "A4"] },
  ],
  // 主旋律：[拍, 音, 时值（拍）]
  MELODY: [
    [[0, "F#5", 1], [1.5, "A5", 0.5], [2, "B5", 1.5], [3.5, "A5", 0.5]],
    [[0, "B5", 1], [1.5, "D6", 0.5], [2, "B5", 2]],
    [[0, "A5", 1], [1.5, "F#5", 0.5], [2, "A5", 1.5], [3.5, "D6", 0.5]],
    [[0, "E6", 1.5], [1.5, "C#6", 0.5], [2, "A5", 2]],
  ],
  introEnd: ACTS.brand[0], grooveFrom: ACTS.scan[0], highFrom: ACTS.export[0], endAt: ACTS.end[0],
  endChord: ["D3", "A3", "D4", "F#4", "A4", "E5"],
  endRun: [["F#5", 0], ["A5", 0.25], ["D6", 0.5], ["E6", 0.75], ["F#6", 1.0], ["A6", 1.5], ["D7", 2.5]],
});
