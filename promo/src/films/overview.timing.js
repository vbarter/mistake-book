// 总览片的时间表（秒）。画面和配乐共用：配乐 120 拍/分，一小节 2 秒，每一幕都从小节线开始。
export const BPM = 120;
export const DURATION = 46;
export const ACTS = {
  hook: [0, 4],
  brand: [4, 8],
  scan: [8, 14],
  grade: [14, 20],
  rank: [20, 26],
  erase: [26, 32],
  export: [32, 36],
  plan: [36, 40],
  end: [40, 46],
};
/** 画面里要配音效的时刻 */
export const CUES = {
  shutter: [10.5, 12.0],
  ding: [16.6, 16.75, 16.9, 17.05, 17.2],
  sweep: [27.4],
  pop: [2.4, 2.7, 3.0, 18.3, 23.6, 30.4, 33.0, 33.25, 33.5, 37.6, 38.0, 38.4, 38.8, 41.6],
};
