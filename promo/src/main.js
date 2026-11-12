// 入口：载入字体和样式，按地址里的 film 参数搭好一条片子，交给渲染器逐帧驱动。
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "@fontsource/noto-sans-sc/900.css";
import "./styles.css";
import { rng } from "./engine.js";
import overview from "./films/overview.js";

const FILMS = { overview };

/** 一层很淡的噪点，压住深色渐变的色带 */
function grain() {
  const c = document.createElement("canvas");
  c.width = c.height = 270;
  const g = c.getContext("2d");
  const img = g.createImageData(270, 270);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (r() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

async function boot() {
  const stage = document.getElementById("stage");
  const name = new URLSearchParams(location.search).get("film") || "overview";
  const film = FILMS[name](stage);
  const gr = document.createElement("div");
  gr.className = "grain";
  gr.style.backgroundImage = `url(${grain()})`;
  stage.appendChild(gr);
  // 字体按字拆成了很多小文件：把片子里出现的字都点名加载一遍，再开始截图
  const text = stage.textContent;
  await Promise.all([400, 500, 700, 900].map((w) => document.fonts.load(`${w} 20px "Noto Sans SC"`, text)));
  await document.fonts.ready;
  film.render(0);
  window.__film = { id: film.id, title: film.title, duration: film.duration };
  window.__seek = (t) => film.render(t);
  // 直接用浏览器打开时按真实时间播放，方便预览
  if (!new URLSearchParams(location.search).has("render")) {
    const t0 = performance.now();
    const q = +new URLSearchParams(location.search).get("t") || 0;
    const loop = () => { film.render((q + (performance.now() - t0) / 1000) % film.duration); requestAnimationFrame(loop); };
    loop();
  }
  window.__ready = true;
}
boot();
