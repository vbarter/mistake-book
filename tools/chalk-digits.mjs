// 计时页黑板上的粉笔数字：0-9 和冒号烘成透明 PNG（白、超时黄、做完绿三种粉笔色），不把手写字体打进包里。
// 用法：node tools/chalk-digits.mjs <站酷快乐体字体.ttf>   字体：Google Fonts「ZCOOL KuaiLe」（OFL）。
// 输出：app/src/assets/chalk/num/、miniprogram/src/assets/chalk/num/ 各一份，文件名 <色>-<字>.png（冒号是 c）。
// 每个字都放在同样大小的格子里（数字 CELL_W × CELL_H、冒号 COLON_W × CELL_H），拼起来时数字不会跳来跳去。改格子尺寸要同步两端 ChalkTime。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { chromium } = createRequire("/")("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT = process.argv[2];
if (!FONT) throw new Error("要给字体文件路径");

const SIZE = 48, CELL_W = 30, COLON_W = 16, CELL_H = 56, SCALE = 2;
const COLORS = { w: "#ffffff", o: "#ffe08a", g: "#b9f2cf" };
const CHARS = [..."0123456789"].map((c) => [c, c]).concat([[":", "c"]]);

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: ChalkNum; src: url(data:font/ttf;base64,${fs.readFileSync(FONT).toString("base64")}); }
html, body { margin: 0; background: transparent; }
.c { width: ${CELL_W}px; height: ${CELL_H}px; display: flex; align-items: center; justify-content: center; font: ${SIZE}px/${CELL_H}px ChalkNum; filter: url(#chalk); text-shadow: 0 2px 0 rgba(0,0,0,.16); }
.c.k { width: ${COLON_W}px; }
</style>
<svg width="0" height="0" style="position:absolute"><filter id="chalk" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.05" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter></svg>
${Object.entries(COLORS).map(([k, col]) => CHARS.map(([ch, name]) => `<div class="c${ch === ":" ? " k" : ""}" id="${k}-${name}" style="color:${col}">${ch}</div>`).join("")).join("")}`;

const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: SCALE });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
const dirs = ["app/src/assets/chalk/num", "miniprogram/src/assets/chalk/num"];
for (const dir of dirs) fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
for (const k of Object.keys(COLORS)) for (const [, name] of CHARS) {
  const buf = await (await p.$(`#${k}-${name}`)).screenshot({ omitBackground: true });
  for (const dir of dirs) fs.writeFileSync(path.join(ROOT, dir, `${k}-${name}.png`), buf);
}
await b.close();
console.log("ok");
