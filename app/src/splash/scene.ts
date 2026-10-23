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

// ---------------------------------------------------------------- 卡通角色（Q 版大头，赛璐璐着色 + 描边，两段 IK 骨骼）
//
// 动画师的做法：不直接转关节角，而是摆「手 / 脚该在哪」（躯干坐标系里的目标点），
// 用两段式 IK 解出肩→肘→手、胯→膝→脚，肘往外后弯、膝往前弯，所以任何姿势都不会僵直穿模。
// 角色整体带一点 3/4 侧身，膝盖、手臂往前伸这些前后方向的动作才看得出来。

type V3 = [number, number, number];

/** 躯干坐标系里的手脚目标；le / re 是肘部朝向（不给用默认：往外、往下、略往后） */
interface Pose {
  lh: V3;
  rh: V3;
  lf: V3;
  rf: V3;
  le?: V3;
  re?: V3;
}

const UA = 0.4; // 上臂
const LA = 0.42; // 前臂（含拳头）
const UL = 0.36; // 大腿
const LL = 0.36; // 小腿
const HEAD_R = 0.74;
const HEAD_Y = 1.62; // 头心离胯部的高度
const SHOULDER: V3 = [0.33, 0.93, 0];
const HIP: V3 = [0.17, 0.12, 0];
const ANKLE_Y = -0.55; // 站立时脚踝高度（比伸直略高，膝盖微弯更自然）
const HIP_H = -ANKLE_Y + 0.2; // 胯部离地高度（含鞋底）
const OUT = 0.035; // 描边粗细

const FEET = { lf: [-0.21, ANKLE_Y, 0.04] as V3, rf: [0.21, ANKLE_Y, 0.04] as V3 };
const STAND: Pose = { lh: [-0.5, 0.24, 0.12], rh: [0.5, 0.24, 0.12], ...FEET };
// 抱头：手按在两侧太阳穴，手肘往外撑开，不挡脸
const HEADACHE: Pose = { lh: [-0.74, 1.4, 0.48], rh: [0.74, 1.4, 0.48], lf: [-0.25, ANKLE_Y, 0.06], rf: [0.25, ANKLE_Y, 0.06], le: [-1, -0.2, -0.3], re: [1, -0.2, -0.3] };
// 举手机：右手抬到脸侧前方，手肘往下
const PHONE: Pose = { lh: [-0.48, 0.3, 0.2], rh: [0.62, 1.22, 0.5], ...FEET, re: [1, -1, 0] };
// 欢呼：双手 V 字举过头
const CHEER: Pose = { lh: [-0.82, 1.72, 0.18], rh: [0.82, 1.72, 0.18], ...FEET };

function mixV(a: V3 | undefined, b: V3 | undefined, x: number): V3 | undefined {
  if (!a && !b) return undefined;
  const p = a ?? b!;
  const q = b ?? a!;
  return [lerp(p[0], q[0], x), lerp(p[1], q[1], x), lerp(p[2], q[2], x)];
}

function mixPose(a: Pose, b: Pose, x: number): Pose {
  return { lh: mixV(a.lh, b.lh, x)!, rh: mixV(a.rh, b.rh, x)!, lf: mixV(a.lf, b.lf, x)!, rf: mixV(a.rf, b.rf, x)!, le: mixV(a.le, b.le, x), re: mixV(a.re, b.re, x) };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** 两段 IK：up 挂在 origin，low 挂在 up 的末端；把末端送到 target，弯曲方向朝 pole */
function solveTwoBone(up: THREE.Object3D, low: THREE.Object3D, origin: V3, target: V3, pole: V3, a: number, b: number) {
  _o.set(...origin);
  _d.set(...target).sub(_o);
  const dist = clamp(_d.length(), Math.abs(a - b) + 0.01, a + b - 0.005);
  _d.normalize();
  const angA = Math.acos(clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1));
  _p.set(...pole);
  _p.sub(_u.copy(_d).multiplyScalar(_p.dot(_d)));
  if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1);
  _p.normalize();
  _u.copy(_d).multiplyScalar(Math.cos(angA)).addScaledVector(_p, Math.sin(angA)).normalize();
  up.quaternion.setFromUnitVectors(DOWN, _u);
  // 肘 / 膝位置 → 末端方向
  _e.copy(_o).addScaledVector(_u, a);
  _t.copy(_o).addScaledVector(_d, dist).sub(_e).normalize();
  _q.setFromUnitVectors(DOWN, _t);
  low.quaternion.copy(up.quaternion).invert().multiply(_q);
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
  arms: { up: THREE.Group; low: THREE.Group; hand: THREE.Object3D; origin: V3 }[] = [];
  legs: { up: THREE.Group; low: THREE.Group; foot: THREE.Group; origin: V3 }[] = [];
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

    // ---- 身体：上窄下宽的「梨形」，比直筒更像 Q 版
    if (L.dress) {
      const dress = part(m, (o) => new THREE.CylinderGeometry(0.3 + o, 0.62 + o, 1.05 + o, 28), L.dress);
      dress.position.y = 0.45;
      this.torso.add(dress);
      const chest = capsule(0.3, 0.2, L.dress);
      chest.position.y = 0.9;
      this.torso.add(chest);
    } else {
      const body = part(m, (o) => new THREE.SphereGeometry(0.42 + o, 28, 20), L.shirt);
      body.scale.set(1, 1.18, 0.9);
      body.position.y = 0.62;
      this.torso.add(body);
      const hips = capsule(0.35, 0.04, L.pants);
      hips.scale.z = 0.88;
      hips.position.y = 0.2;
      this.torso.add(hips);
    }
    const neck = capsule(0.13, 0.12, L.skin);
    neck.position.y = 1.08;
    this.torso.add(neck);
    if (L.scarf) {
      // 红领巾：领口一圈 + 胸前三角
      const collar = part(m, (o) => new THREE.TorusGeometry(0.2, 0.06 + o, 10, 24), 0xe63946);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 1.02;
      const tri = part(m, (o) => new THREE.ConeGeometry(0.18 + o, 0.4 + o, 3), 0xe63946);
      tri.rotation.z = Math.PI;
      tri.scale.z = 0.3;
      tri.position.set(0, 0.8, 0.36);
      const knot = ball(0.08, 0xe63946);
      knot.position.set(0, 0.97, 0.3);
      this.torso.add(collar, tri, knot);
    }
    if (L.tie) {
      const tie = part(m, (o) => new THREE.ConeGeometry(0.11 + o, 0.5 + o, 4), L.tie);
      tie.rotation.z = Math.PI;
      tie.scale.z = 0.4;
      tie.position.set(0, 0.78, 0.38);
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

    // ---- 手臂：肩、肘都有圆球关节，弯起来没有断口
    const sx = L.dress ? 0.28 : SHOULDER[0];
    for (const s of [-1, 1]) {
      const origin: V3 = [s * sx, SHOULDER[1], SHOULDER[2]];
      const up = new THREE.Group();
      up.position.set(...origin);
      const shoulder = ball(0.135, L.dress ?? L.shirt);
      const upper = capsule(0.115, UA, L.dress ?? L.shirt);
      upper.position.y = -UA / 2;
      up.add(shoulder, upper);
      const low = new THREE.Group();
      low.position.y = -UA;
      const lowColor = L.longSleeve ? L.shirt : L.skin;
      const elbow = ball(0.1, lowColor);
      const lower = capsule(0.1, LA - 0.16, lowColor);
      lower.position.y = -(LA - 0.16) / 2;
      const fist = ball(0.135, L.skin);
      fist.position.y = -LA + 0.04;
      low.add(elbow, lower, fist);
      up.add(low);
      const hand = new THREE.Object3D();
      hand.position.y = -LA;
      low.add(hand);
      this.torso.add(up);
      this.arms.push({ up, low, hand, origin });
    }

    // ---- 腿：膝盖往前弯，鞋子始终贴地放平
    for (const s of [-1, 1]) {
      const origin: V3 = [s * HIP[0], HIP[1], HIP[2]];
      const up = new THREE.Group();
      up.position.set(...origin);
      const bare = L.shorts || Boolean(L.dress);
      const thigh = capsule(0.14, UL, bare && L.dress ? L.skin : L.pants);
      thigh.position.y = -UL / 2;
      up.add(thigh);
      const low = new THREE.Group();
      low.position.y = -UL;
      const knee = ball(0.125, bare ? L.skin : L.pants);
      const shin = capsule(0.12, LL, bare ? L.skin : L.pants);
      shin.position.y = -LL / 2;
      const foot = new THREE.Group();
      foot.position.y = -LL;
      const shoe = ball(0.18, L.shoes);
      shoe.scale.set(1.05, 0.68, 1.4);
      shoe.position.set(0, -0.08, 0.08);
      foot.add(shoe);
      low.add(knee, shin, foot);
      up.add(low);
      this.torso.add(up);
      this.legs.push({ up, low, foot, origin });
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
    solveTwoBone(l.up, l.low, l.origin, p.lh, p.le ?? [-1, -0.7, -0.45], UA, LA);
    solveTwoBone(r.up, r.low, r.origin, p.rh, p.re ?? [1, -0.7, -0.45], UA, LA);
    this.legs.forEach((leg, i) => {
      const s = i === 0 ? -1 : 1;
      solveTwoBone(leg.up, leg.low, leg.origin, i === 0 ? p.lf : p.rf, [s * 0.15, 0, 1], UL, LL);
      // 鞋子反向转回来，保持脚底平行地面、脚尖朝前
      leg.foot.quaternion.copy(leg.up.quaternion).multiply(leg.low.quaternion).invert();
    });
  }

  /** 把世界坐标的点换成躯干坐标（用来让手指向某个东西） */
  toTorso(world: THREE.Vector3): V3 {
    this.root.updateMatrixWorld(true);
    const v = this.torso.worldToLocal(world.clone());
    return [v.x, v.y, v.z];
  }

  /** 从肩膀朝某个躯干坐标点伸直手臂（指向） */
  reachToward(arm: number, at: V3, reach = 0.95): V3 {
    const o = this.arms[arm].origin;
    const v = new THREE.Vector3(at[0] - o[0], at[1] - o[1], at[2] - o[2]).normalize();
    // Q 版手短头大：手臂朝外斜上方伸直（别往正上方指），往前带一点，才不会被大头挡住
    const side = arm === 0 ? -1 : 1;
    if (v.x * side < 0.85) v.x = side * 0.85;
    v.y = clamp(v.y, -0.3, 0.5); // 最多斜向上约 30°，手才落在大头外面
    v.z = Math.max(v.z, 0.25);
    v.normalize().multiplyScalar((UA + LA) * reach);
    return [o[0] + v.x, o[1] + v.y, o[2] + v.z];
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

  /** 让挂在手上的道具正对镜头、保持竖直（可加一点倾斜）；offset 是相对手的屏幕方向偏移 */
  upright(obj: THREE.Object3D, arm: number, offset: [number, number] = [0, 0], tilt = 0) {
    this.root.updateMatrixWorld(true);
    const inv = this.arms[arm].hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    obj.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    obj.position.set(offset[0], offset[1], 0.3).applyQuaternion(inv);
  }

  /** 头顶在世界坐标里的高度 */
  headTop(headScale = 1) {
    return this.root.position.y + (HEAD_Y + HEAD_R * headScale) * this.root.scale.y;
  }

  /** 站位；hop 是离地高度；breathe 让身体轻微起伏 */
  place(x: number, ground: number, scale: number, hop = 0, t = 0) {
    this.root.scale.setScalar(scale);
    this.root.position.set(x, ground + HIP_H * scale + hop, this.root.position.z);
    this.torso.scale.set(1, 1 + Math.sin(t * 3.2) * 0.012, 1);
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
  const tmpV = new THREE.Vector3();

  // ---------------------------------------------------------------- 每帧

  function render(t: number) {
    // 镜头：第四幕拉远、上移，给爸妈和老师腾地方
    const zoomK = smooth(seg(t, 10.0, 10.75));
    cam.zoom = lerp(1, 0.6, zoomK);
    cam.position.y = lerp(0, 1.6, zoomK);
    cam.updateProjectionMatrix();

    clouds.forEach((c, i) => (c.position.x = c.userData.base + Math.sin(t * 0.25 + i) * 0.35));

    // ---------- 小主角
    const blink = t % 3.1 < 0.12 ? 0.15 : 1;
    let pose: Pose = STAND;
    let mood: Mood = "neutral";
    let hop = 0;
    let headScale = 1;
    kid.root.rotation.set(0, 0.22, 0); // 3/4 侧身，前后方向的动作才看得出
    kid.torso.rotation.set(0, 0, 0);
    kid.head.rotation.set(0, 0, 0);
    kid.head.position.y = HEAD_Y;

    if (t < 3.3) {
      // 第一幕：抬头看纸往下掉 → 双手按住太阳穴、手肘撑开、摇头，头胀大一圈
      const k = smooth(seg(t, 1.0, 1.45));
      pose = mixPose(STAND, HEADACHE, k);
      mood = t < 0.9 ? "neutral" : "sad";
      headScale = 1 + 0.12 * smooth(seg(t, 1.3, 1.9));
      kid.head.rotation.x = lerp(-0.25, 0.1, smooth(seg(t, 0.6, 1.2)));
      kid.head.rotation.z = Math.sin(t * 7) * 0.13 * seg(t, 1.5, 1.9);
      kid.torso.rotation.x = 0.1 * k;
      kid.root.rotation.y = lerp(0.22, 0, k);
    } else if (t < 6.9) {
      // 第二幕：掏手机，每次拍照手往前一顶，眼睛看着手机
      const k = smooth(seg(t, 3.3, 3.75));
      pose = mixPose(HEADACHE, PHONE, k);
      headScale = lerp(1.12, 1, k);
      const tap = FLASHES.reduce((a, f) => a + pulse(t, f - 0.08, 0.2), 0);
      pose.rh = [pose.rh[0], pose.rh[1] + tap * 0.05, pose.rh[2] + tap * 0.12];
      pose.lf = [-0.21, ANKLE_Y + pulse(t, 4.5, 0.25) * 0.08, 0.04];
      kid.head.rotation.set(0, 0.28 * k, -0.08 * k);
      mood = t < 4.4 ? "neutral" : "happy";
    } else if (t < 10.1) {
      // 第三幕：真正「指向」正在翻面的卡片，换卡片时手臂平滑转过去，边看边点头
      const pointAt = (i: number): Pose => {
        const at = kid.toTorso(tmpV.copy(cards[i].g.position));
        return i === 0 ? { ...STAND, lh: kid.reachToward(0, at) } : { ...STAND, rh: kid.reachToward(1, at), lh: [-0.42, 0.42, 0.2] };
      };
      const idx = t < 8.1 ? 0 : t < 8.8 ? 1 : 2;
      const sw = [6.9, 8.1, 8.8][idx];
      const prev = idx === 0 ? PHONE : pointAt(idx - 1);
      pose = mixPose(prev, pointAt(idx), smooth(seg(t, sw, sw + 0.3)));
      const card = cards[idx].g.position;
      kid.head.rotation.set(-0.2 + Math.abs(Math.sin(t * 6)) * 0.08, (card.x - kid.root.position.x) * 0.18, 0);
      kid.torso.rotation.z = -(card.x - kid.root.position.x) * 0.03;
      mood = t > 9.3 ? "happy" : "neutral";
    } else {
      // 第四幕：V 字举手挥舞，起跳时收腿、落地屈膝
      const k = smooth(seg(t, 10.1, 10.45));
      const wave = Math.sin(t * 10) * 0.16;
      const ch: Pose = { ...CHEER, lh: [CHEER.lh[0] - wave, CHEER.lh[1], CHEER.lh[2]], rh: [CHEER.rh[0] + wave, CHEER.rh[1], CHEER.rh[2]] };
      pose = mixPose(STAND, ch, k);
      if (t > 10.4) {
        const ph = ((t - 10.4) * 1.7) % 1;
        hop = Math.sin(ph * Math.PI) * 0.75;
        const tuck = hop / 0.75;
        const land = ph < 0.12 ? 1 - ph / 0.12 : 0; // 落地瞬间屈膝缓冲
        pose.lf = [-0.24, ANKLE_Y + tuck * 0.22 + land * 0.1, 0.04 - tuck * 0.2];
        pose.rf = [0.24, ANKLE_Y + tuck * 0.22 + land * 0.1, 0.04 - tuck * 0.2];
        hop -= land * 0.1;
      }
      kid.head.rotation.z = Math.sin(t * 5) * 0.08;
      mood = "happy";
    }
    kid.setPose(pose);
    kid.setMood(mood, blink);
    kid.head.scale.setScalar(headScale);
    kid.sweat.position.y = 0.3 - ((t * 0.6) % 0.25);
    kid.place(lerp(0, 0.2, zoomK), GROUND, KID, hop, t);

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
    kid.upright(phone, 1, [0.04, 0.34], -0.12);
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
    const show = t > 10.0;
    for (const s of [mom, dad, teacher]) {
      s.root.visible = show;
      s.shadow.visible = show;
    }
    if (show) {
      /** 侧身走进来（迈腿、摆臂、身体上下颠），到位后转向小主角 */
      const stroll = (s: Chibi, from: number, to: number, a: number, b: number, scale: number, face: number) => {
        const k = seg(t, a, b);
        const moving = k > 0 && k < 1;
        const dir = Math.sign(to - from);
        const ph = t * 9.5;
        s.root.rotation.set(0, moving ? dir * 1.0 : lerp(dir * 1.0, face, smooth(seg(t, b, b + 0.3))), 0);
        s.place(lerp(from, to, smooth(k)), GROUND, scale, moving ? Math.abs(Math.sin(ph)) * 0.06 : 0, t);
        const sw = Math.sin(ph);
        const walkPose: Pose = {
          lh: [-0.46, 0.28, 0.1 - sw * 0.26],
          rh: [0.46, 0.28, 0.1 + sw * 0.26],
          lf: [-0.2, ANKLE_Y + Math.max(0, sw) * 0.14, 0.04 + sw * 0.22],
          rf: [0.2, ANKLE_Y + Math.max(0, -sw) * 0.14, 0.04 - sw * 0.22],
        };
        return { moving, walkPose };
      };
      // 爸妈：走到位后在胸前鼓掌
      const clap = (s: Chibi, w: { moving: boolean; walkPose: Pose }, phase: number, at: number) => {
        const c = Math.sin(t * 14 + phase) * 0.5 + 0.5;
        const clapPose: Pose = { lh: [-(0.05 + 0.2 * c), 1.0, 0.55], rh: [0.05 + 0.2 * c, 1.0, 0.55], ...FEET, le: [-1, -0.5, -0.2], re: [1, -0.5, -0.2] };
        s.setPose(w.moving ? w.walkPose : mixPose(w.walkPose, clapPose, smooth(seg(t, at, at + 0.25))));
        s.head.rotation.set(0, 0, Math.sin(t * 4 + phase) * 0.06);
        s.setMood("happy", blink);
      };
      clap(dad, stroll(dad, -6.5, -2.55, 10.05, 10.95, 1.4, 0.45), 0, 10.95);
      clap(mom, stroll(mom, -6.0, -1.35, 10.15, 11.0, 1.28, 0.4), 1.6, 11.0);
      // 老师：走到位后左手举牌，右手叉腰
      const tw = stroll(teacher, 6.5, 2.4, 10.2, 11.05, 1.36, -0.45);
      if (tw.moving) teacher.setPose(tw.walkPose);
      else {
        const k = smooth(seg(t, 11.05, 11.35));
        const raise: Pose = { lh: [-0.42, 1.78, 0.35], rh: [0.42, 0.55, -0.02], ...FEET, le: [-1, -0.4, -0.2], re: [1, 0.1, -0.6] };
        teacher.setPose(mixPose(tw.walkPose, raise, k));
      }
      teacher.head.rotation.set(0, 0, -0.08 + Math.sin(t * 4) * 0.04);
      teacher.setMood("happy", blink);
      sign.scale.setScalar(Math.max(0, backOut(seg(t, 11.1, 11.45))));
      teacher.upright(sign, 0, [0, 0.5], Math.sin(t * 5) * 0.06);
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
