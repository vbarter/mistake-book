// 学生片的配乐。G 大调，120 拍/分，四小节一循环：G → D → Em7 → Cmaj7，比总览片更轻快。
import { compose } from "./compose.mjs";
import { ACTS, CUES, DURATION, BPM } from "../src/films/student.timing.js";

export default () => compose({
  ACTS, CUES, DURATION, BPM,
  CHORDS: [
    { root: "G1", tones: ["G3", "B3", "D4", "G4"] },
    { root: "D2", tones: ["A3", "D4", "F#4", "A4"] },
    { root: "E2", tones: ["G3", "B3", "D4", "E4"] },
    { root: "C2", tones: ["G3", "B3", "C4", "E4"] },
  ],
  MELODY: [
    [[0, "D5", 0.5], [0.5, "G5", 0.5], [1, "B5", 1], [2.5, "A5", 0.5], [3, "G5", 1]],
    [[0, "A5", 1], [1.5, "F#5", 0.5], [2, "D5", 2]],
    [[0, "E5", 0.5], [0.5, "G5", 0.5], [1, "B5", 1], [2.5, "D6", 0.5], [3, "B5", 1]],
    [[0, "C6", 1.5], [1.5, "B5", 0.5], [2, "G5", 2]],
  ],
  ARP: [0, 2, 1, 3, 2, 1, 3, 2],
  introEnd: ACTS.join[0], grooveFrom: ACTS.join[0], highFrom: ACTS.collect[0], endAt: ACTS.end[0],
  endChord: ["G2", "D3", "G3", "B3", "D4", "A4"],
  endRun: [["B5", 0], ["D6", 0.25], ["G6", 0.5], ["A6", 0.75], ["B6", 1.0], ["D7", 1.5], ["G7", 2.5]],
});
