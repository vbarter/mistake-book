// 学生片的时间表（秒）。ACTS 是全片时间；T 里是每一幕自己的时间（从这一幕开始算）。
export const BPM = 120;
export const DURATION = 44;
export const ACTS = { open: [0, 4], join: [4, 14], hand: [14, 28], collect: [28, 38], end: [38, 44] };
export const T = {
  steps: [1.9, 2.4, 2.9],
  join: { card: 1.9, join: 4.6, ok: 5.9 },
  hand: { hand: 1.6, shoot: 2.8, shots: [5.0, 6.4], done: 7.4, give: 9.6 },
  collect: { collect: 1.3, shoot: 2.3, shots: [4.3], done: 5.0, rank: 6.6 },
  endSteps: [1.9, 2.15, 2.4],
};
const at = (act, list) => list.map((x) => ACTS[act][0] + x);
/** 要配音效的时刻（全片时间） */
export const CUES = {
  shutter: [...at("hand", T.hand.shots), ...at("collect", T.collect.shots)],
  pop: [...at("open", T.steps), ...at("join", [T.join.card, T.join.join, T.join.ok]), ...at("hand", [T.hand.hand, T.hand.shoot, T.hand.done, T.hand.give]), ...at("collect", [T.collect.collect, T.collect.shoot, T.collect.done]), ...at("end", T.endSteps)],
  ding: [...at("join", [T.join.ok + 0.8]), ...at("collect", [T.collect.rank + 0.6, T.collect.rank + 0.78])],
  cheer: at("hand", [T.hand.give + 0.4]),
  sweep: [],
};
