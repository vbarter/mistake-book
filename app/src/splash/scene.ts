/** 开屏动效（three.js，Q 版卡通小人，约 14 秒）。
 *
 * 四幕：
 *   1. 0.0–3.3s  试卷从天而降堆成山，小人抱头、头变大、冒汗、头顶转星星
 *   2. 3.3–6.9s  掏出知错本「拍拍拍」，闪光一次，试卷飞进英语 / 数学 / 化学三个文件夹
 *   3. 6.9–10.1s 三张错题卡片逐张翻面，✗ 变 ✓，头顶亮灯泡
 *   4. 10.1–12.9s 镜头拉远，爸妈进场鼓掌冒爱心，老师举「真棒！」牌，彩纸飘落，小人蹦跳
 *   之后 12.9s 起由页面叠上 Logo（见 components/Splash.tsx）
 *
 * 只负责画面：render(t) 按时间直接算出每个物体的状态（无内部状态，可任意跳帧），字幕和跳过按钮在 React 层。
 */
import * as THREE from "three";

export const DURATION = 14.2;
export const LOGO_AT = 12.9;
export const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0.3, to: 3.3, text: "试卷堆成山，好头大……" },
  { from: 3.5, to: 6.8, text: "打开知错本，拍拍拍，自动归档分类" },
  { from: 7.0, to: 9.9, text: "错题逐个复习，搞懂一道勾一道" },
  { from: 10.2, to: 12.8, text: "知识掌握啦！爸妈表扬，老师称赞" },
];

// ---------------------------------------------------------------- 工具

const D = Math.PI / 180;
const INK = 0x2d3047;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const backOut = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
/** 0 → 1 → 0 的小脉冲，持续 len 秒 */
const pulse = (t: number, at: number, len: number) => (t < at || t > at + len ? 0 : Math.sin(((t - at) / len) * Math.PI));

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function drawCheck(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, width: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(x - s * 0.5, y);
  g.lineTo(x - s * 0.12, y + s * 0.38);
  g.lineTo(x + s * 0.55, y - s * 0.42);
  g.stroke();
}

function drawCross(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, width: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - s / 2, y - s / 2);
  g.lineTo(x + s / 2, y + s / 2);
  g.moveTo(x + s / 2, y - s / 2);
  g.lineTo(x - s / 2, y + s / 2);
  g.stroke();
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
}

// ---------------------------------------------------------------- 贴图

function paperTexture(variant: number) {
  return canvasTexture(192, 256, (g) => {
    roundRect(g, 4, 4, 184, 248, 14);
    g.fillStyle = "#fffdf6";
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#d9d2c3";
    g.stroke();
    g.fillStyle = ["#c7d4ff", "#ffd7c2", "#cdeedc"][variant % 3];
    roundRect(g, 22, 22, 110, 16, 8);
    g.fill();
    g.fillStyle = "#dfe2ea";
    for (let i = 0; i < 8; i++) {
      roundRect(g, 22, 56 + i * 22, 148 - ((i * 37) % 60), 8, 4);
      g.fill();
    }
    drawCross(g, 150, 80, 22, "#ef4444", 6);
    drawCross(g, 128, 168, 22, "#ef4444", 6);
    if (variant % 2) drawCross(g, 156, 212, 18, "#ef4444", 5);
    else drawCheck(g, 150, 124, 24, "#22a06b", 6);
  });
}

function cardTexture(front: boolean, n: number) {
  return canvasTexture(256, 320, (g) => {
    roundRect(g, 6, 6, 244, 308, 26);
    g.fillStyle = front ? "#ffffff" : "#f0fbf4";
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = front ? "#ffb4b4" : "#8fdcb0";
    g.stroke();
    g.fillStyle = "#3a3f5c";
    g.font = `bold 30px ${FONT}`;
    g.fillText(`第 ${n} 题`, 30, 56);
    g.fillStyle = "#e1e4ec";
    for (let i = 0; i < 3; i++) {
      roundRect(g, 30, 80 + i * 24, 196 - i * 40, 10, 5);
      g.fill();
    }
    if (front) {
      g.fillStyle = "#fff0f0";
      g.beginPath();
      g.arc(128, 222, 58, 0, Math.PI * 2);
      g.fill();
      drawCross(g, 128, 222, 60, "#ef4444", 16);
    } else {
      g.fillStyle = "#dcf5e6";
      g.beginPath();
      g.arc(128, 214, 58, 0, Math.PI * 2);
      g.fill();
      drawCheck(g, 128, 214, 72, "#1f9d5c", 16);
      g.fillStyle = "#1f9d5c";
      g.font = `bold 26px ${FONT}`;
      g.textAlign = "center";
      g.fillText("掌握啦", 128, 300);
    }
  });
}

function folderTexture(label: string, color: string, dark: string) {
  return canvasTexture(256, 210, (g) => {
    g.fillStyle = dark;
    roundRect(g, 10, 12, 110, 50, 16);
    g.fill();
    g.fillStyle = color;
    roundRect(g, 10, 36, 236, 164, 22);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(g, 10, 36, 236, 40, 22);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `bold 54px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 128, 128);
  });
}

function phoneTexture() {
  return canvasTexture(128, 232, (g) => {
    roundRect(g, 4, 4, 120, 224, 24);
    g.fillStyle = "#2d3047";
    g.fill();
    roundRect(g, 12, 16, 104, 200, 14);
    g.fillStyle = "#3b6cf6";
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 6;
    g.lineCap = "round";
    const c = (x: number, y: number, dx: number, dy: number) => {
      g.beginPath();
      g.moveTo(x, y + dy);
      g.lineTo(x, y);
      g.lineTo(x + dx, y);
      g.stroke();
    };
    c(30, 50, 18, 18);
    c(98, 50, -18, 18);
    c(30, 150, 18, -18);
    c(98, 150, -18, -18);
    g.fillStyle = "#ffffff";
    g.font = `bold 20px ${FONT}`;
    g.textAlign = "center";
    g.fillText("知错本", 64, 192);
  });
}

function signTexture() {
  return canvasTexture(300, 200, (g) => {
    roundRect(g, 8, 8, 284, 184, 30);
    g.fillStyle = "#ff5a5f";
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = "#ffffff";
    g.stroke();
    g.fillStyle = "#ffd84d";
    starPath(g, 62, 100, 40, 18);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `900 64px ${FONT}`;
    g.textBaseline = "middle";
    g.fillText("真棒!", 108, 104);
  });
}

function spriteTexture(kind: "star" | "heart" | "glow" | "sparkle") {
  return canvasTexture(128, 128, (g) => {
    if (kind === "star") {
      g.fillStyle = "#ffd84d";
      starPath(g, 64, 66, 56, 24);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = "#f5a524";
      g.stroke();
    } else if (kind === "heart") {
      g.fillStyle = "#ff6b8b";
      g.beginPath();
      g.moveTo(64, 112);
      g.bezierCurveTo(10, 76, 6, 30, 38, 22);
      g.bezierCurveTo(54, 18, 62, 30, 64, 40);
      g.bezierCurveTo(66, 30, 74, 18, 90, 22);
      g.bezierCurveTo(122, 30, 118, 76, 64, 112);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.ellipse(42, 44, 10, 6, -0.6, 0, Math.PI * 2);
      g.fill();
    } else if (kind === "glow") {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(255,236,140,0.95)");
      grd.addColorStop(0.45, "rgba(255,220,90,0.45)");
      grd.addColorStop(1, "rgba(255,220,90,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    } else {
      g.fillStyle = "#ffffff";
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = i % 2 ? 14 : 60;
        g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
  });
}

// ---------------------------------------------------------------- 卡通角色（Q 版大头，赛璐璐着色 + 描边）

/** 关节角度（度）：手臂 0 = 自然下垂，a 越大越往外上抬；e 是手肘弯曲；腿同理 */
interface Pose {
  la: number;
  le: number;
  ra: number;
  re: number;
  ll: number;
  lk: number;
  rl: number;
  rk: number;
}

const UA = 0.4; // 上臂
const LA = 0.36; // 前臂
const UL = 0.36; // 大腿
const LL = 0.34; // 小腿
const HEAD_R = 0.74;
const HEAD_Y = 1.62; // 头心离胯部的高度
const HIP_H = UL + LL + 0.2; // 胯部离地高度（含鞋）
const OUT = 0.035; // 描边粗细

const STAND: Pose = { la: 14, le: 8, ra: 14, re: 8, ll: 4, lk: 0, rl: 4, rk: 0 };
const HEADACHE: Pose = { la: 150, le: 18, ra: 150, re: 18, ll: 8, lk: 0, rl: 8, rk: 0 };
const PHONE: Pose = { la: 16, le: 10, ra: 118, re: 38, ll: 6, lk: 0, rl: 6, rk: 0 };
const CHEER: Pose = { la: 158, le: -12, ra: 158, re: -12, ll: 14, lk: 0, rl: 14, rk: 0 };

function mixPose(a: Pose, b: Pose, x: number): Pose {
  const o = { ...a };
  (Object.keys(a) as (keyof Pose)[]).forEach((k) => (o[k] = lerp(a[k], b[k], x)));
  return o;
}

type Kind = "kid" | "mom" | "dad" | "teacher";
type Mood = "sad" | "neutral" | "happy";

interface Look {
  skin: number;
  hair: number;
  hairStyle: "spiky" | "long" | "short" | "bun";
  shirt: number;
  longSleeve: boolean;
  pants: number;
  shorts: boolean;
  shoes: number;
  dress?: number;
  scarf?: boolean;
  tie?: number;
  glasses?: boolean;
}

const LOOKS: Record<Kind, Look> = {
  kid: { skin: 0xffe0c8, hair: 0x3b2a22, hairStyle: "spiky", shirt: 0x5b8def, longSleeve: false, pants: 0x2f3e6e, shorts: true, shoes: 0xff6b6b, scarf: true },
  mom: { skin: 0xffe3cf, hair: 0x6b3f2a, hairStyle: "long", shirt: 0xff8fb1, longSleeve: false, pants: 0xffe3cf, shorts: false, shoes: 0xd9466f, dress: 0xff8fb1 },
  dad: { skin: 0xf8d6bc, hair: 0x26262e, hairStyle: "short", shirt: 0x9ad0ff, longSleeve: true, pants: 0x4a5068, shorts: false, shoes: 0x3a3a46, tie: 0xe5484d },
  teacher: { skin: 0xffe3cf, hair: 0x8d8fa3, hairStyle: "bun", shirt: 0x5fbf8f, longSleeve: true, pants: 0x3f4a5c, shorts: false, shoes: 0x7a4b36, glasses: true },
};

interface Mats {
  ink: THREE.Material;
  outline: THREE.Material;
  toon: (color: number) => THREE.Material;
  basic: (color: number, opacity?: number) => THREE.Material;
}

/** 带描边的卡通零件：本体 + 反面朝外、略大一圈的墨色外壳 */
function part(m: Mats, make: (grow: number) => THREE.BufferGeometry, color: number, outline = true): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(make(0), m.toon(color)));
  if (outline) g.add(new THREE.Mesh(make(OUT), m.outline));
  return g;
}

class Chibi {
  root = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  arms: { up: THREE.Group; low: THREE.Group; hand: THREE.Object3D }[] = [];
  legs: { up: THREE.Group; low: THREE.Group }[] = [];
  eyesOpen: THREE.Group[] = [];
  eyesHappy: THREE.Object3D[] = [];
  brows: THREE.Object3D[] = [];
  smile: THREE.Object3D;
  grin: THREE.Object3D;
  frown: THREE.Object3D;
  blush: THREE.Mesh[] = [];
  sweat: THREE.Object3D;
  shadow: THREE.Mesh;

  constructor(m: Mats, kind: Kind) {
    const L = LOOKS[kind];
    const capsule = (r: number, len: number, color: number) => part(m, (o) => new THREE.CapsuleGeometry(r + o, len, 6, 16), color);
    const ball = (r: number, color: number, outline = true) => part(m, (o) => new THREE.SphereGeometry(r + o, 24, 16), color, outline);
    this.root.add(this.torso);

    // ---- 身体
    if (L.dress) {
      const dress = part(m, (o) => new THREE.CylinderGeometry(0.3 + o, 0.62 + o, 1.05 + o, 28), L.dress);
      dress.position.y = 0.45;
      this.torso.add(dress);
      const chest = capsule(0.3, 0.2, L.dress);
      chest.position.y = 0.9;
      this.torso.add(chest);
    } else {
      const body = capsule(0.38, 0.42, L.shirt);
      body.position.y = 0.62;
      this.torso.add(body);
      const hips = capsule(0.36, 0.04, L.pants);
      hips.position.y = 0.2;
      this.torso.add(hips);
    }
    if (L.scarf) {
      // 红领巾
      const tri = part(m, (o) => new THREE.ConeGeometry(0.2 + o, 0.42 + o, 3), 0xe63946);
      tri.rotation.z = Math.PI;
      tri.position.set(0, 0.86, 0.34);
      tri.scale.z = 0.35;
      const knot = ball(0.09, 0xe63946);
      knot.position.set(0, 1.04, 0.36);
      this.torso.add(tri, knot);
    }
    if (L.tie) {
      const tie = part(m, (o) => new THREE.ConeGeometry(0.11 + o, 0.5 + o, 4), L.tie);
      tie.rotation.z = Math.PI;
      tie.scale.z = 0.4;
      tie.position.set(0, 0.8, 0.37);
      this.torso.add(tie);
    }

    // ---- 头
    this.head.position.y = HEAD_Y;
    this.torso.add(this.head);
    const face = ball(HEAD_R, L.skin);
    face.scale.set(1.04, 0.94, 1);
    this.head.add(face);
    for (const s of [-1, 1]) {
      const ear = ball(0.14, L.skin);
      ear.position.set(s * 0.74, -0.04, 0);
      this.head.add(ear);
    }
    this.addHair(m, L, ball);

    for (const s of [-1, 1]) {
      // 大眼睛：黑色椭圆 + 两个高光
      const eye = new THREE.Group();
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), m.ink);
      pupil.scale.set(0.85, 1.2, 0.45);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), m.basic(0xffffff));
      hl.position.set(0.03, 0.06, 0.05);
      const hl2 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), m.basic(0xffffff));
      hl2.position.set(-0.035, -0.05, 0.05);
      eye.add(pupil, hl, hl2);
      eye.position.set(s * 0.26, -0.02, 0.67);
      eye.rotation.y = s * 0.36;
      this.head.add(eye);
      this.eyesOpen.push(eye);
      // 开心时眯成 ^ ^
      const happy = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 18, Math.PI), m.ink);
      happy.position.set(s * 0.26, -0.04, 0.68);
      happy.rotation.y = s * 0.36;
      this.head.add(happy);
      this.eyesHappy.push(happy);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.13, 3, 8), m.ink);
      brow.rotation.z = Math.PI / 2;
      brow.position.set(s * 0.26, 0.2, 0.66);
      this.head.add(brow);
      this.brows.push(brow);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), m.basic(0xff8fa3, 0.55));
      blush.scale.y = 0.65;
      blush.position.set(s * 0.44, -0.2, 0.56);
      blush.rotation.y = s * 0.66;
      this.head.add(blush);
      this.blush.push(blush);
    }
    if (L.glasses) {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 28), m.ink);
        ring.position.set(s * 0.26, -0.02, 0.73);
        ring.rotation.y = s * 0.36;
        this.head.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.07, 2, 6), m.ink);
      bridge.rotation.z = Math.PI / 2;
      bridge.position.set(0, 0.0, 0.76);
      this.head.add(bridge);
    }

    const arc = new THREE.TorusGeometry(0.1, 0.026, 8, 20, Math.PI);
    this.smile = new THREE.Mesh(arc, m.ink);
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, -0.22, 0.71);
    this.frown = new THREE.Mesh(arc, m.ink);
    this.frown.scale.set(0.8, 0.7, 1);
    this.frown.position.set(0, -0.34, 0.69);
    // 开心张嘴：红色半圆 + 舌头
    this.grin = new THREE.Group();
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24, Math.PI, Math.PI), m.basic(0x9b2c3c));
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16, Math.PI, Math.PI), m.basic(0xff7a8a));
    tongue.position.set(0, -0.07, 0.005);
    tongue.scale.y = 0.7;
    this.grin.add(mouth, tongue);
    this.grin.position.set(0, -0.19, 0.72);
    this.grin.rotation.x = -0.25;
    this.head.add(this.smile, this.frown, this.grin);

    const drop = ball(0.08, 0x7cc7ff);
    drop.scale.set(1, 1.45, 0.8);
    drop.position.set(0.62, 0.3, 0.38);
    this.sweat = drop;
    this.head.add(drop);

    // ---- 手臂（肩膀在身体两侧）
    for (const s of [-1, 1]) {
      const up = new THREE.Group();
      up.position.set(s * 0.3, 0.92, 0.05);
      const upper = capsule(0.12, UA, L.shirt);
      upper.position.y = -UA / 2;
      up.add(upper);
      const low = new THREE.Group();
      low.position.y = -UA;
      const lower = capsule(0.105, LA, L.longSleeve ? L.shirt : L.skin);
      lower.position.y = -LA / 2;
      const fist = ball(0.135, L.skin);
      fist.position.y = -LA - 0.04;
      low.add(lower, fist);
      up.add(low);
      const hand = new THREE.Object3D();
      hand.position.y = -LA - 0.06;
      low.add(hand);
      this.torso.add(up);
      this.arms.push({ up, low, hand });
    }

    // ---- 腿
    for (const s of [-1, 1]) {
      const up = new THREE.Group();
      up.position.set(s * 0.18, 0.12, 0);
      const thigh = capsule(0.14, UL, L.shorts || L.dress ? (L.dress ? L.skin : L.pants) : L.pants);
      thigh.position.y = -UL / 2;
      up.add(thigh);
      const low = new THREE.Group();
      low.position.y = -UL;
      const shin = capsule(0.12, LL, L.shorts || L.dress ? L.skin : L.pants);
      shin.position.y = -LL / 2;
      const shoe = ball(0.18, L.shoes);
      shoe.scale.set(1.05, 0.68, 1.35);
      shoe.position.set(0, -LL - 0.08, 0.07);
      low.add(shin, shoe);
      up.add(low);
      this.torso.add(up);
      this.legs.push({ up, low });
    }

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 28), m.basic(0x6b4a2a, 0.13));
    this.shadow.scale.y = 0.2;

    this.setMood("neutral");
    this.setPose(STAND);
  }

  private addHair(m: Mats, L: Look, ball: (r: number, c: number, o?: boolean) => THREE.Group) {
    const hairCap = (thetaLen: number, tilt: number) => {
      const cap = part(m, (o) => new THREE.SphereGeometry(HEAD_R + 0.06 + o, 32, 18, 0, Math.PI * 2, 0, thetaLen), L.hair);
      cap.rotation.x = tilt;
      cap.scale.set(1.04, 0.96, 1);
      this.head.add(cap);
      return cap;
    };
    if (L.hairStyle === "spiky") {
      hairCap(Math.PI * 0.42, -0.42);
      // 刘海 + 呆毛
      for (const [x, rot] of [[-0.3, 0.5], [-0.05, 0.15], [0.22, -0.35]] as const) {
        const bang = part(m, (o) => new THREE.ConeGeometry(0.17 + o, 0.42 + o, 10), L.hair);
        bang.position.set(x, 0.42, 0.5);
        bang.rotation.set(1.9, 0, rot);
        this.head.add(bang);
      }
      const ahoge = part(m, (o) => new THREE.ConeGeometry(0.09 + o, 0.42 + o, 8), L.hair);
      ahoge.position.set(0.08, 0.86, 0);
      ahoge.rotation.z = -0.45;
      this.head.add(ahoge);
    } else if (L.hairStyle === "long") {
      hairCap(Math.PI * 0.46, -0.32);
      const back = part(m, (o) => new THREE.CapsuleGeometry(0.62 + o, 0.5, 6, 18), L.hair);
      back.position.set(0, -0.3, -0.28);
      back.scale.z = 0.6;
      this.head.add(back);
      const bow = ball(0.13, 0xff5c8a);
      bow.position.set(0.5, 0.52, 0.3);
      this.head.add(bow);
    } else if (L.hairStyle === "short") {
      hairCap(Math.PI * 0.36, -0.3);
      const quiff = ball(0.22, L.hair);
      quiff.scale.set(1.6, 0.7, 1);
      quiff.position.set(0.12, 0.62, 0.32);
      this.head.add(quiff);
    } else {
      hairCap(Math.PI * 0.44, -0.3);
      const bun = ball(0.24, L.hair);
      bun.position.set(0, 0.82, -0.16);
      this.head.add(bun);
    }
  }

  setPose(p: Pose) {
    const [l, r] = this.arms;
    l.up.rotation.z = -p.la * D;
    l.low.rotation.z = -p.le * D;
    r.up.rotation.z = p.ra * D;
    r.low.rotation.z = p.re * D;
    const [ll, rl] = this.legs;
    ll.up.rotation.z = -p.ll * D;
    ll.low.rotation.z = p.lk * D;
    rl.up.rotation.z = p.rl * D;
    rl.low.rotation.z = -p.rk * D;
  }

  setMood(mood: Mood, blink = 1) {
    const happy = mood === "happy";
    this.eyesOpen.forEach((e) => {
      e.visible = !happy;
      e.scale.y = blink;
    });
    this.eyesHappy.forEach((e) => (e.visible = happy));
    this.grin.visible = happy;
    this.smile.visible = mood === "neutral";
    this.frown.visible = mood === "sad";
    this.sweat.visible = mood === "sad";
    this.brows.forEach((b, i) => {
      const s = i === 0 ? -1 : 1;
      b.rotation.z = Math.PI / 2 + (mood === "sad" ? s * 0.4 : happy ? -s * 0.12 : 0);
      b.position.y = mood === "sad" ? 0.24 : 0.22;
    });
    this.blush.forEach((b) => ((b.material as THREE.MeshBasicMaterial).opacity = happy ? 0.75 : 0.4));
  }

  /** 手臂离身体的前后距离：抱头时要挪到放大的头前面 */
  armZ(z: number) {
    this.arms.forEach((a) => (a.up.position.z = z));
  }

  /** 让挂在手上的道具保持竖直；offset 是屏幕方向的偏移 */
  upright(obj: THREE.Object3D, arm: number, offset?: [number, number]) {
    const a = this.arms[arm];
    const th = -(this.root.rotation.z + this.torso.rotation.z + a.up.rotation.z + a.low.rotation.z);
    obj.rotation.z = th;
    if (offset) obj.position.set(offset[0] * Math.cos(th) - offset[1] * Math.sin(th), offset[0] * Math.sin(th) + offset[1] * Math.cos(th), obj.position.z);
  }

  /** 头顶在世界坐标里的高度 */
  headTop(headScale = 1) {
    return this.root.position.y + (HEAD_Y + HEAD_R * headScale) * this.root.scale.y;
  }

  place(x: number, ground: number, scale: number, hop = 0) {
    this.root.scale.setScalar(scale);
    this.root.position.set(x, ground + HIP_H * scale + hop, this.root.position.z);
    this.shadow.position.set(x, ground + 0.02, -0.5);
    const s = scale * (1 - clamp(hop / 2.5) * 0.45);
    this.shadow.scale.set(s, s * 0.2, 1);
  }
}

// ---------------------------------------------------------------- 场景

export interface SplashScene {
  render(t: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function createSplash(canvas: HTMLCanvasElement): SplashScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const VIEW_H = 10;
  const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  cam.position.set(0, 0, 20);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3, 5, 8);
  scene.add(sun);

  const grad = new THREE.DataTexture(new Uint8Array([150, 210, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = THREE.NearestFilter;
  grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const textures: THREE.Texture[] = [grad];
  const tex = <T extends THREE.Texture>(t: T) => (textures.push(t), t);

  const m: Mats = {
    ink: new THREE.MeshToonMaterial({ color: INK, gradientMap: grad }),
    outline: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
    toon: (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad }),
    basic: (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }),
  };
  const flat = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.FrontSide });

  const GROUND = -3.3;

  // 背景：地面、云
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 10), m.basic(0xffe9c7));
  ground.position.set(0, GROUND - 5, -8);
  const groundEdge = new THREE.Mesh(new THREE.PlaneGeometry(80, 0.12), m.basic(0xf3d3a2));
  groundEdge.position.set(0, GROUND, -7.9);
  scene.add(ground, groundEdge);

  const clouds: THREE.Group[] = [];
  const cloudMat = m.toon(0xffffff);
  for (const [x, y, s] of [[-2.6, 3.9, 0.9], [2.4, 3.2, 0.7], [0.4, 6.4, 0.8], [-3.4, 7.2, 0.6], [3.6, 6.9, 0.75]] as const) {
    const c = new THREE.Group();
    for (const [dx, dy, r] of [[-0.45, 0, 0.38], [0, 0.18, 0.5], [0.48, 0, 0.36], [0.2, -0.12, 0.34], [-0.2, -0.12, 0.34]] as const) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), cloudMat);
      puff.position.set(dx, dy, 0);
      c.add(puff);
    }
    c.scale.set(s, s * 0.8, 0.3);
    c.position.set(x, y, -6);
    c.userData.base = x;
    clouds.push(c);
    scene.add(c);
  }

  // 角色
  const KID = 1.15; // 小主角的缩放
  const kid = new Chibi(m, "kid");
  const mom = new Chibi(m, "mom");
  const dad = new Chibi(m, "dad");
  const teacher = new Chibi(m, "teacher");
  for (const s of [kid, mom, dad, teacher]) scene.add(s.root, s.shadow);
  dad.root.position.z = -0.4;
  teacher.root.position.z = -0.2;

  // 第一幕：试卷
  const paperGeo = new THREE.PlaneGeometry(0.92, 1.22);
  const paperMats = [0, 1, 2, 3].map((v) => flat(tex(paperTexture(v))));
  const r = rng(11);
  const PAPERS = 15;
  const papers = Array.from({ length: PAPERS }, (_, i) => {
    const mesh = new THREE.Mesh(paperGeo, paperMats[i % 4]);
    const side = i % 2 ? 1 : -1;
    const layer = Math.floor(i / 2);
    const pile = new THREE.Vector3(side * (1.4 + r() * 0.65), GROUND + 0.55 + layer * 0.32 + r() * 0.1, 0.4 + i * 0.03);
    // 最后两张砸到头上又滑到肩头
    if (i >= PAPERS - 2) pile.set(side * 0.45, GROUND + (HIP_H + HEAD_Y + HEAD_R * 0.92) * KID + 0.35 - (i - PAPERS + 2) * 0.18, 1.6 + i * 0.02);
    const start = new THREE.Vector3(pile.x + (r() - 0.5) * 3, 6.5 + r() * 2.5, pile.z);
    scene.add(mesh);
    // 归档顺序：砸在头上的两张先收走，露出脸
    const rank = i >= PAPERS - 2 ? i - (PAPERS - 2) : i + 2;
    return { mesh, pile, start, rot: (r() - 0.5) * 1.1, spin: (r() - 0.5) * 8, fallAt: 0.15 + i * 0.13, folder: i % 3, fileAt: 3.95 + Math.floor(rank / 4) * 0.72 + (rank % 4) * 0.07 };
  });

  const dizzy = Array.from({ length: 3 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(spriteTexture("star")), transparent: true }));
    s.scale.setScalar(0.32);
    scene.add(s);
    return s;
  });

  // 第二幕：手机、闪光、文件夹
  const phone = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), flat(tex(phoneTexture())));
  phone.position.set(0, 0.3, 0.3);
  kid.arms[1].hand.add(phone);
  const flashSpark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(spriteTexture("sparkle")), transparent: true, depthTest: false }));
  scene.add(flashSpark);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), m.basic(0xffffff, 0));
  flash.position.z = 12;
  scene.add(flash);
  const FLASHES = [3.9, 4.62, 5.34, 6.06];

  const folders = (
    [
      ["英语", "#8b6cf0", "#6b4fd6"],
      ["数学", "#3b82f6", "#2563eb"],
      ["化学", "#22b07d", "#168a60"],
    ] as const
  ).map(([label, c, d], i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.03), flat(tex(folderTexture(label, c, d))));
    mesh.position.set((i - 1) * 1.45, 3.15, 0.2);
    scene.add(mesh);
    return mesh;
  });

  // 第三幕：错题卡片、灯泡
  const cardGeo = new THREE.PlaneGeometry(1.1, 1.38);
  const cards = [0, 1, 2].map((i) => {
    const g = new THREE.Group();
    const front = new THREE.Mesh(cardGeo, flat(tex(cardTexture(true, [7, 12, 18][i]))));
    const back = new THREE.Mesh(cardGeo, flat(tex(cardTexture(false, [7, 12, 18][i]))));
    back.rotation.y = Math.PI;
    g.add(front, back);
    g.position.set((i - 1) * 1.42, 2.35, 3);
    scene.add(g);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(spriteTexture("star")), transparent: true }));
    scene.add(spark);
    return { g, spark, flipAt: 7.75 + i * 0.68 };
  });

  const bulb = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 16), m.toon(0x9aa0b4));
  base.position.y = -0.36;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(spriteTexture("glow")), transparent: true, depthWrite: false }));
  glow.scale.setScalar(1.9);
  glow.position.z = -0.1;
  bulb.add(glow, glass, base);
  scene.add(bulb);

  // 第四幕：牌子、爱心、彩纸
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), flat(tex(signTexture())));
  sign.position.set(0, 0.6, 0.5);
  teacher.arms[0].hand.add(sign);

  const heartTex = tex(spriteTexture("heart"));
  const hearts = Array.from({ length: 6 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true }));
    scene.add(s);
    return { s, at: 11.0 + i * 0.28, x: (i % 2 ? -1.35 : -2.55) + (r() - 0.5) * 0.5 };
  });

  const CONFETTI = 110;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI);
  const palette = [0xff5a5f, 0xffd84d, 0x3b82f6, 0x22b07d, 0x8b6cf0, 0xff8fb1];
  const cf = Array.from({ length: CONFETTI }, (_, i) => {
    confetti.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    return { x: (r() - 0.5) * 9, delay: r() * 1.4, speed: 1.6 + r() * 1.6, sway: r() * Math.PI * 2, spin: 2 + r() * 6 };
  });
  scene.add(confetti);
  const dummy = new THREE.Object3D();

  // ---------------------------------------------------------------- 每帧

  function render(t: number) {
    // 镜头：第四幕拉远、上移，给爸妈和老师腾地方
    const zoomK = smooth(seg(t, 10.0, 10.75));
    cam.zoom = lerp(1, 0.6, zoomK);
    cam.position.y = lerp(0, 1.6, zoomK);
    cam.updateProjectionMatrix();

    clouds.forEach((c, i) => (c.position.x = c.userData.base + Math.sin(t * 0.25 + i) * 0.35));

    // ---------- 小人
    const blink = (t % 3.1) < 0.12 ? 0.15 : 1;
    let pose: Pose = STAND;
    let mood: Mood = "neutral";
    let hop = 0;
    let headScale = 1;
    kid.root.rotation.z = 0;
    kid.head.position.y = HEAD_Y;
    let armZ = 0.05;

    if (t < 3.3) {
      // 第一幕：先发愣，再抱头、头变大
      const k = smooth(seg(t, 1.0, 1.5));
      pose = mixPose(STAND, HEADACHE, k);
      armZ = lerp(0.05, 1.15, k);
      mood = t < 0.9 ? "neutral" : "sad";
      headScale = 1 + 0.3 * smooth(seg(t, 1.3, 2.0)) + 0.04 * Math.sin(t * 9) * seg(t, 1.6, 2.0);
      kid.root.rotation.z = Math.sin(t * 5) * 0.06 * seg(t, 1.2, 1.6);
    } else if (t < 6.9) {
      const k = smooth(seg(t, 3.3, 3.75));
      pose = mixPose(HEADACHE, PHONE, k);
      armZ = lerp(1.15, 0.35, k);
      headScale = lerp(1.3, 1, smooth(seg(t, 3.3, 3.7)));
      // 每次闪光手腕一抖
      const tap = FLASHES.reduce((a, f) => a + pulse(t, f - 0.08, 0.2), 0);
      pose = { ...pose, re: pose.re - tap * 18 };
      mood = t < 4.4 ? "neutral" : "happy";
    } else if (t < 10.1) {
      // 第三幕：指着正在翻面的卡片，点头
      const idx = t < 8.1 ? 0 : t < 8.8 ? 1 : 2;
      const pointL: Pose = { ...STAND, la: 145, le: -5 };
      const pointC: Pose = { ...STAND, ra: 158, re: 8 };
      const pointR: Pose = { ...STAND, ra: 128, re: 0 };
      const target = [pointL, pointC, pointR][idx];
      pose = mixPose(PHONE, target, smooth(seg(t, 6.9, 7.4)));
      if (t > 7.4) pose = target;
      kid.head.position.y = HEAD_Y + Math.abs(Math.sin(t * 6)) * 0.05;
      armZ = 0.3;
      mood = t > 9.3 ? "happy" : "neutral";
    } else {
      // 第四幕：欢呼蹦跳
      const k = smooth(seg(t, 10.1, 10.5));
      const wave = Math.sin(t * 10) * 14;
      pose = mixPose(STAND, { ...CHEER, la: CHEER.la + wave, ra: CHEER.ra - wave }, k);
      hop = t > 10.4 ? Math.abs(Math.sin((t - 10.4) * Math.PI * 1.7)) * 0.7 : 0;
      pose = { ...pose, ll: 12 + hop * 22, rl: 12 + hop * 22 };
      mood = "happy";
    }
    kid.setPose(pose);
    kid.armZ(armZ);
    kid.setMood(mood, blink);
    kid.head.scale.setScalar(headScale);
    kid.sweat.position.y = 0.3 - ((t * 0.6) % 0.25);
    kid.place(lerp(0, 0.2, zoomK), GROUND, KID, hop);

    // 小人头顶转星星
    const dz = seg(t, 1.5, 1.8) * (1 - seg(t, 3.2, 3.5));
    dizzy.forEach((s, i) => {
      const a = t * 3.2 + (i * Math.PI * 2) / 3;
      s.position.set(Math.cos(a) * 1.05, kid.headTop(headScale) + 0.3 + Math.sin(a) * 0.15, 2 + Math.sin(a));
      s.scale.setScalar(0.34 * dz);
    });

    // ---------- 试卷
    papers.forEach((p) => {
      const fall = seg(t, p.fallAt, p.fallAt + 0.55);
      const land = fall * fall;
      const pos = new THREE.Vector3().lerpVectors(p.start, p.pile, land);
      let rot = p.rot + (1 - fall) * p.spin;
      if (fall >= 1) {
        pos.y += pulse(t, p.fallAt + 0.55, 0.18) * 0.1;
      }
      let scale = fall > 0 ? 1 : 0;
      // 砸在头上的两张：头变大时被顶起
      if (p.pile.z > 1) pos.y += (headScale - 1) * HEAD_R * 2 * KID;

      // 第二幕：飞进文件夹
      const fly = smooth(seg(t, p.fileAt, p.fileAt + 0.5));
      if (fly > 0) {
        const to = folders[p.folder].position;
        const ctrl = new THREE.Vector3((p.pile.x + to.x) / 2, Math.max(p.pile.y, to.y) + 1.6, 2);
        const a = new THREE.Vector3().lerpVectors(p.pile, ctrl, fly);
        const b = new THREE.Vector3().lerpVectors(ctrl, new THREE.Vector3(to.x, to.y - 0.1, 2), fly);
        pos.lerpVectors(a, b, fly);
        rot = lerp(p.rot, 0, fly) + Math.sin(fly * Math.PI) * 0.6;
        scale = lerp(1, 0.25, fly);
        if (fly >= 1) scale = 0;
      }
      p.mesh.position.copy(pos);
      p.mesh.rotation.z = rot;
      p.mesh.scale.setScalar(scale);
    });

    // ---------- 手机与闪光
    const phoneK = backOut(seg(t, 3.4, 3.75)) * (1 - seg(t, 6.85, 7.1));
    phone.scale.setScalar(Math.max(0, phoneK));
    kid.upright(phone, 1, [0.08, 0.38]);
    phone.rotation.z += -0.15;
    const fl = FLASHES.reduce((a, f) => Math.max(a, pulse(t, f, 0.16)), 0);
    (flash.material as THREE.MeshBasicMaterial).opacity = fl * 0.55;
    kid.root.updateMatrixWorld(true);
    phone.getWorldPosition(flashSpark.position);
    flashSpark.position.z = 6;
    flashSpark.position.y += 0.2;
    flashSpark.scale.setScalar(fl * 1.6);
    flashSpark.material.rotation = t * 3;

    // ---------- 文件夹：出现、接纸时一跳、离场
    folders.forEach((f, i) => {
      const inK = backOut(seg(t, 3.45 + i * 0.1, 3.85 + i * 0.1));
      const outK = smooth(seg(t, 6.85, 7.25));
      const bump = papers.filter((p) => p.folder === i).reduce((a, p) => a + pulse(t, p.fileAt + 0.45, 0.22), 0);
      f.scale.setScalar(Math.max(0, inK * (1 - outK)) * (1 + 0.16 * Math.min(1, bump)));
      f.position.y = 3.15 + outK * 1.5;
    });

    // ---------- 错题卡片翻面
    cards.forEach((c, i) => {
      const inK = backOut(seg(t, 7.0 + i * 0.12, 7.45 + i * 0.12));
      const outK = smooth(seg(t, 9.9, 10.3));
      const flip = smooth(seg(t, c.flipAt, c.flipAt + 0.42));
      c.g.scale.setScalar(Math.max(0, inK) * (1 - outK) * (1 + 0.12 * pulse(t, c.flipAt + 0.3, 0.3)));
      c.g.rotation.y = flip * Math.PI;
      c.g.position.y = 2.35 + Math.sin(t * 2 + i) * 0.06 + outK * 2.2;
      const sp = pulse(t, c.flipAt + 0.35, 0.45);
      c.spark.position.set(c.g.position.x + 0.45, c.g.position.y + 0.6, 4);
      c.spark.scale.setScalar(sp * 0.55);
      c.spark.material.rotation = t * 2;
    });

    const bulbK = backOut(seg(t, 9.3, 9.6)) * (1 - seg(t, 10.0, 10.25));
    bulb.scale.setScalar(Math.max(0, bulbK));
    bulb.position.set(kid.root.position.x, kid.headTop() + 0.6, 2);
    glow.scale.setScalar(1.7 + Math.sin(t * 12) * 0.15);

    // ---------- 爸妈、老师
    const walk = (s: Chibi, from: number, to: number, a: number, b: number, scale: number) => {
      const k = seg(t, a, b);
      const x = lerp(from, to, smooth(k));
      const moving = k > 0 && k < 1;
      const ph = t * 11;
      s.place(x, GROUND, scale, moving ? Math.abs(Math.sin(ph)) * 0.08 : 0);
      return { moving, swing: moving ? Math.sin(ph) * 26 : 0 };
    };
    const show = t > 10.0;
    for (const s of [mom, dad, teacher]) {
      s.root.visible = show;
      s.shadow.visible = show;
    }
    if (show) {
      // 爸妈：走进来，然后举手挥舞欢呼
      const cheer = (s: Chibi, w: { moving: boolean; swing: number }, phase: number) => {
        const wave = Math.sin(t * 11 + phase) * 16;
        const p: Pose = w.moving ? { ...STAND, ll: 4 + w.swing, rl: 4 - w.swing, la: 14 - w.swing * 0.6, ra: 14 + w.swing * 0.6 } : { ...CHEER, la: 140 + wave, ra: 140 - wave, ll: 6, rl: 6 };
        s.setPose(p);
        s.setMood("happy", blink);
      };
      cheer(dad, walk(dad, -6.5, -2.55, 10.05, 10.95, 1.4), 0);
      cheer(mom, walk(mom, -6.0, -1.35, 10.15, 11.0, 1.28), 1.6);
      const tw = walk(teacher, 6.5, 2.4, 10.2, 11.05, 1.36);
      if (tw.moving) teacher.setPose({ ...STAND, ll: 4 + tw.swing, rl: 4 - tw.swing });
      else {
        const k = backOut(seg(t, 11.05, 11.4));
        teacher.setPose(mixPose(STAND, { ...STAND, la: 155, le: 10, ra: 40 + Math.sin(t * 6) * 10, re: 50 }, k));
      }
      teacher.setMood("happy", blink);
      teacher.root.updateMatrixWorld(true);
      sign.scale.setScalar(Math.max(0, backOut(seg(t, 11.1, 11.45))));
      teacher.upright(sign, 0, [-0.2, 0.55]);
      sign.rotation.z += Math.sin(t * 5) * 0.06;
    }

    hearts.forEach((h) => {
      const k = seg(t, h.at, h.at + 1.6);
      h.s.visible = k > 0 && k < 1;
      h.s.position.set(h.x + Math.sin(k * 6) * 0.15, GROUND + 4.9 + k * 2.2, 3);
      h.s.scale.setScalar(0.5 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * (1 - k * 0.5));
      h.s.material.opacity = 1 - smooth(seg(k, 0.7, 1));
    });

    cf.forEach((c, i) => {
      const k = t - 10.55 - c.delay;
      if (k < 0) {
        dummy.scale.setScalar(0);
      } else {
        dummy.position.set(c.x + Math.sin(k * 3 + c.sway) * 0.4, 9.5 - k * c.speed, 1 + (i % 5) * 0.4);
        dummy.rotation.set(k * c.spin, k * c.spin * 0.7, c.sway + k);
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    });
    confetti.instanceMatrix.needsUpdate = true;

    renderer.render(scene, cam);
  }

  function resize(w: number, h: number) {
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    // 竖屏手机至少保证 5 个单位宽，横屏 / 平板按高度 10 放
    const viewH = Math.max(VIEW_H, 5.2 / aspect);
    cam.left = (-viewH * aspect) / 2;
    cam.right = (viewH * aspect) / 2;
    cam.top = viewH / 2;
    cam.bottom = -viewH / 2;
    cam.updateProjectionMatrix();
  }

  function dispose() {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    textures.forEach((t) => t.dispose());
    renderer.dispose();
  }

  return { render, resize, dispose };
}
