// 首页黑板上的粉笔字：标题、下划线、副标题烘成透明 PNG（白色粉笔，压在哪个主题色的黑板上都行），不把 6MB 的手写字体打进包里。
// 用法：node tools/chalk-titles.mjs <马善政楷书字体.ttf>   字体：Google Fonts「Ma Shan Zheng」（OFL）。
// 输出：app/src/assets/chalk/、miniprogram/src/assets/chalk/ 各一份。改了文字重新跑一遍。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { chromium } = createRequire("/")("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT = process.argv[2];
if (!FONT) throw new Error("要给字体文件路径");

// 画布 156×80（CSS px），按 3 倍出图。副标题偏右，左下角让给小人。
const W = 156, H = 80, SCALE = 3;
const CARDS = [
  { id: "todo", title: "待办事项", sub: "今天要完成" },
  { id: "plan", title: "学习计划", sub: "长期安排" },
  { id: "wrong", title: "错题收集", sub: "拍照收错题" },
  { id: "erase", title: "试卷擦除", sub: "擦掉再做一遍" },
  { id: "tag", title: "", sub: "", tag: "值日生" },
];

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Chalk; src: url(data:font/ttf;base64,${fs.readFileSync(FONT).toString("base64")}); }
html, body { margin: 0; background: transparent; }
.c { position: relative; width: ${W}px; height: ${H}px; color: #fff; font-family: Chalk; }
.t { position: absolute; left: 0; right: 0; top: 2px; height: 40px; display: flex; align-items: center; justify-content: center; white-space: nowrap; -webkit-text-stroke: .5px #fff; filter: url(#chalk); text-shadow: 0 1px 0 rgba(0,0,0,.18); }
.l { position: absolute; left: 30px; top: 43px; filter: url(#chalk); opacity: .85; }
.s { position: absolute; left: 34px; right: 0; top: 53px; text-align: center; font-size: 16px; line-height: 20px; letter-spacing: 1px; opacity: .92; filter: url(#chalk); white-space: nowrap; }
.g { position: absolute; left: 1px; top: 1px; font-size: 12px; line-height: 15px; letter-spacing: 1px; padding-bottom: 1px; border-bottom: 1px solid #fff; opacity: .6; }
</style>
<svg width="0" height="0" style="position:absolute"><filter id="chalk" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.05" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter></svg>
${CARDS.map((c) => c.tag
  ? `<div class="c" id="${c.id}" style="width:44px;height:19px"><span class="g">${c.tag}</span></div>`
  : `<div class="c" id="${c.id}"><div class="t" style="font-size:${Math.min(37, Math.floor(150 / c.title.length))}px">${c.title}</div>
  <svg class="l" width="96" height="8" viewBox="0 0 96 8" fill="none"><path d="M2 6C24 2.5 60 1.5 94 3" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>
  <div class="s">${c.sub}</div></div>`).join("")}`;

const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: SCALE });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
for (const dir of ["app/src/assets/chalk", "miniprogram/src/assets/chalk"]) fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
for (const c of CARDS) {
  const buf = await (await p.$(`#${c.id}`)).screenshot({ omitBackground: true });
  for (const dir of ["app/src/assets/chalk", "miniprogram/src/assets/chalk"]) fs.writeFileSync(path.join(ROOT, dir, `${c.id}.png`), buf);
}
await b.close();
console.log("ok");
