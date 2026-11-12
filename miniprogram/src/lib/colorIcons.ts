/**
 * 彩色图标集：48×48 网格，圆头圆角描边，白色主体加一两处强调色。两套主题各一份画法：
 * classic 校园蓝（深蓝细线）· pop 元气粉（粉色粗线、蓝色第二色、物件带小表情、背后垫色块）。
 * 这个文件 App 和小程序各放一份，内容保持一致（app/src/lib/colorIcons.ts ↔ miniprogram/src/lib/colorIcons.ts）。
 */
export type ThemeName = "classic" | "pop";
interface Palette { L: string; W: string; B: string; BT: string; R: string; RT: string; Y: string; YT: string; G: string; GT: string; GM: string; P: string; PT: string; X: string; K: number; board: string; pop?: boolean }
const CLASSIC: Palette = { L: "#1f3b73", W: "#ffffff", B: "#2f6fed", BT: "#dbe6fb", R: "#e2566a", RT: "#fde0e4", Y: "#ffb547", YT: "#ffe3b3", G: "#1e9e5a", GT: "#d3f2e1", GM: "#7fd6a8", P: "#5b37a8", PT: "#e9e0fb", X: "#d23a3a", K: 1, board: "#3aa57a" };
const POP: Palette = { L: "#fb7299", W: "#ffffff", B: "#00aeec", BT: "#d3f1fd", R: "#fb7299", RT: "#ffe3ec", Y: "#ffc53d", YT: "#ffeebd", G: "#00aeec", GT: "#d3f1fd", GM: "#9be3f9", P: "#00aeec", PT: "#d3f1fd", X: "#fb7299", K: 1.2, board: "#00aeec", pop: true };
/** 深色模式：深蓝线在深色卡片上看不见，换成浅蓝线；粉色线本来就够亮 */
const PALETTES: Record<string, Palette> = { classic: CLASSIC, "classic-dark": { ...CLASSIC, L: "#9db4ea" }, pop: POP, "pop-dark": POP };

type Group = [string, [string, string, string][]];
function build(T: Palette): Group[] {
const { L, W, B, BT, R, RT, Y, YT, G, GT, GM, P, PT } = T;
const s = (c = L, w = 2.5) => `stroke="${c}" stroke-width="${+(w * T.K).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"`;
const p = (d: string, fill = "none", c = L, w = 2.5, extra = "") => `<path d="${d}" fill="${fill}" ${s(c, w)} ${extra}/>`;
const r = (x: number, y: number, w: number, h: number, rx: number, fill = W, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${s()} ${extra}/>`;
const c = (cx: number, cy: number, rad: number, fill = W, stroke = true) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}" ${stroke ? s() : ""}/>`;
const ln = (d: string, col = L, w = 2.5, o = 1) => `<path d="${d}" fill="none" ${s(col, w)} opacity="${o}"/>`;
const star = (x: number, y: number, k: number, col = Y) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0-8l2.2 5.8L8 0 2.2 2.2 0 8l-2.2-5.8L-8 0l5.8-2.2z" fill="${col}"/>`;
const pencil = (cx: number, cy: number, deg: number, col: string) => `<g transform="rotate(${deg} ${cx} ${cy})">${r(cx - 3.5, cy - 14, 7, 20, 2, col)}${p(`M${cx - 3.5} ${cy + 6}l3.5 7 3.5-7z`, W)}</g>`;

const GROUPS: Group[] = [
 ["底部导航", [
  ["home", "首页", p("M10 21L24 9l14 12v17a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z", W) + p("M20 41V31a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v10", R) + ln("M6 23L24 8l18 15")],
  ["papers", "试卷", r(15, 6, 24, 30, 4, BT) + r(9, 12, 24, 30, 4) + ln("M15 21h12M15 28h12M15 35h7", L, 2.5, .3)],
  ["camera", "拍照", p("M17 14l2.5-4.5a2 2 0 0 1 1.7-1h5.6a2 2 0 0 1 1.7 1L31 14", W) + r(6, 14, 36, 26, 6) + c(24, 27, 7.5, BT) + c(24, 27, 3, B, false) + c(36, 20, 1.7, Y, false)],
  ["analysis", "分析", r(8, 24, 8, 17, 2.5, BT) + r(20, 9, 8, 32, 2.5, B) + r(32, 17, 8, 24, 2.5, R) + ln("M4 42h40")],
  ["me", "我的", p("M9 42c0-8 6.5-13 15-13s15 5 15 13z", BT) + c(24, 17, 8.5) + `<path d="M24 30l-2.6 3 2.6 7.5 2.6-7.5z" fill="${R}"/>`],
 ]],
 ["错题与试卷", [
  ["collect", "错题收集", `<g transform="rotate(6 24 23)">${r(13, 8, 22, 30, 4)}${ln("M18 15h12", L, 2.5, .3)}</g>` + c(24.5, 28, 5.5, RT, false) + ln("M22 25.5l5 5M27 25.5l-5 5", T.X, 2.6) + ln("M6 14v-4a4 4 0 0 1 4-4h4M34 6h4a4 4 0 0 1 4 4v4M42 34v4a4 4 0 0 1-4 4h-4M14 42h-4a4 4 0 0 1-4-4v-4", B, 2.8)],
  ["album", "相册导入", r(6, 9, 36, 30, 5) + c(16, 19, 3.5, Y, false) + p("M6 35l10-9 7 6 7-8 12 11a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", BT)],
  ["erase", "试卷擦除", r(7, 7, 24, 33, 4) + ln("M12 15h14", L, 2.5, .3) + ln("M12 24c2.2-4 3.6 4 6 0s3.6 4 6 0", B, 2.4, .6) + `<g transform="rotate(-38 32 32)">${r(20, 26, 23, 12, 3.5, R)}${p("M28.5 26v12")}<rect x="21.6" y="27.6" width="5.4" height="8.8" rx="2.2" fill="${W}"/></g>` + star(40, 11, .7)],
  ["scan", "识别中", r(12, 7, 24, 34, 4) + `<path d="M13.3 24V11a2.7 2.7 0 0 1 2.7-2.7h16a2.7 2.7 0 0 1 2.7 2.7v13z" fill="${B}" opacity=".16"/>` + ln("M17 15h14M17 32h14M17 37h8", L, 2.5, .3) + ln("M5 24h38", B, 3)],
  ["wrong", "错题", r(8, 7, 26, 34, 4) + ln("M14 15h14M14 22h8", L, 2.5, .3) + c(32, 32, 9.5, R) + ln("M28.3 28.3l7.4 7.4M35.7 28.3l-7.4 7.4", W, 2.8)],
  ["ranking", "错题榜", r(4, 26, 13.5, 15, 2.5, BT) + r(17.3, 17, 13.5, 24, 2.5, Y) + r(30.5, 31, 13.5, 10, 2.5, RT) + `<path transform="translate(24 8.5) scale(.62)" d="M0-10l3.1 6.3 6.9 1-5 4.9 1.2 6.9L0 5.8l-6.2 3.3L-5 2.2l-5-4.9 6.9-1z" fill="${R}" ${s(L, 3.4)}/>`],
  ["knowledge", "知识点", p("M24 6a12 12 0 0 0-7 21.7V31a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.3A12 12 0 0 0 24 6z", Y) + ln("M19 38h10M21.5 42.5h5") + ln("M20.5 19l3.5 3.5 3.5-3.5M24 22.5V33", L, 2.2, .75)],
  ["export", "导出错题本", r(14, 5, 20, 13, 2.5) + r(6, 16, 36, 19, 5, BT) + r(13, 27, 22, 16, 2.5) + ln("M18 33h12M18 38h7", L, 2.5, .3) + c(36, 22, 1.7, R, false)],
  ["folder", "文件夹", p("M6 14a4 4 0 0 1 4-4h8l4 5h16a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", YT) + p("M6 22h36v14a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", Y)],
  ["file", "文件", p("M11 5h17l11 11v24a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z", W) + p("M28 5v8a3 3 0 0 0 3 3h8z", BT) + ln("M14 25h18M14 32h18M14 38h9", L, 2.5, .3)],
  ["video", "讲解视频", r(5, 8, 38, 27, 5) + p("M20 15.5l10 6-10 6z", R) + ln("M15 42h18M24 35v7")],
  ["retry", "重新识别", ln("M39 24a15 15 0 1 1-4.6-10.8", B, 3.2) + ln("M39.5 6.5v8.5H31", L, 3.2) + star(24, 24, .8)],
  // 小喇叭：首页的通知条用（24 左右），所以画得粗、不垫色块
  ["horn", "通知", ln("M13 30.5v7a3 3 0 0 0 6 0v-6", L, 3) + p("M18 17.5L31 9v30L18 30.5z", W, L, 3) + r(6, 17.5, 12, 13, 3.5, R, "") + ln("M36.5 19a7 7 0 0 1 0 10", Y, 3.2) + ln("M40.5 13.5a14 14 0 0 1 0 21", Y, 3.2, .55)],
 ]],
 ["学习计划", [
  ["plan", "学习计划", r(9, 9, 30, 34, 5) + r(17, 5, 14, 8, 3, B) + ln("M15 23l2.6 2.6 4.2-4.8M15 33.5l2.6 2.6 4.2-4.8", G, 2.8) + ln("M26.5 23.5h7.5M26.5 34h7.5", L, 2.5, .3)],
  ["plan-new", "新建计划", r(7, 9, 28, 33, 5) + r(14, 5, 14, 8, 3, BT) + ln("M13 22h14M13 29h8", L, 2.5, .3) + c(34, 34, 9.5, B) + ln("M34 29.5v9M29.5 34h9", W, 2.8)],
  ["homework", "作业", r(7, 7, 27, 35, 4) + ln("M13.5 7v35") + ln("M19 16h10M19 23h10", L, 2.5, .3) + pencil(36, 27, 30, Y)],
  ["submit", "交作业", r(11, 5, 26, 30, 4) + ln("M24 27V13M18 18.5l6-6 6 6", G, 3.2) + p("M5 31h9l2.5 5h15l2.5-5h9v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z", GT)],
  ["review", "批阅", r(7, 8, 27, 34, 4) + ln("M12.5 26l5 5 9.5-11.5", R, 3.6) + pencil(37, 24, 28, R)],
  ["deadline", "截止时间", ln("M9.5 12.5l6-5M38.5 12.5l-6-5", R, 4) + ln("M14 38l-3.5 4M34 38l3.5 4") + c(24, 26, 14.5) + ln("M24 17.5V26l5.5 3.5", R, 3)],
  ["done", "已完成", c(24, 24, 18, GT) + ln("M15 24.5l6.2 6.2L33 17.5", G, 4.2)],
  ["teacher", "老师布置", r(5, 6, 38, 26, 4, T.board) + ln("M11 14h11M11 20h6", W, 2.6) + ln("M27 23l3-7.5 3 7.5M28.2 20.5h3.6", Y, 2.2) + ln("M24 32v5M15 43l9-6 9 6")],
  ["members", "成员", p("M23 38c0-6.5 4-10 10-10s10 3.5 10 10z", RT) + c(33, 17, 6, Y) + p("M4 42c0-8.5 5.5-13 13.5-13S31 33.5 31 42z", BT) + c(17.5, 19, 7.5)],
  ["invite", "邀请", p("M43 5L5 20.500l14 6.500L25.5 41z", W) + p("M19 27l6.5 14 4.3-10.200z", BT) + ln("M43 5L19 27")],
 ]],
 ["学科", [
  ["chinese", "语文", ln("M5 41c5.5-3.5 11-3.5 17 0", L, 3.6) + `<g transform="rotate(38 27 22)">${r(24, 2, 6, 21, 2, "#e0a070")}${r(22.5, 22, 9, 5.5, 1.5, Y)}${p("M22.5 27.500h9c0 6-2 10-4.5 13-2.5-3-4.5-7-4.5-13z", L)}</g>`],
  ["math", "数学", r(6, 6, 36, 36, 8) + ln("M24 6v36M6 24h36", L, 2.5, .25) + ln("M11.5 15h7M15 11.500v7", B, 2.8) + ln("M29.5 15h7", R, 2.8) + ln("M12.2 30.200l5.6 5.600M17.8 30.200l-5.6 5.6", R, 2.8) + ln("M29.5 30.500h7M29.5 35.500h7", B, 2.8)],
  ["english", "英语", p("M8 7h32a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H23l-9.5 8.500V34H8a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4z", PT) + ln("M12.5 27.500l5.5-14 5.5 14M14.5 23h7", P, 2.8) + `<circle cx="31.5" cy="23.5" r="3.8" fill="none" ${s(P, 2.8)}/>` + ln("M35.5 19.500v8", P, 2.8)],
  ["science", "科学", `<ellipse cx="24" cy="25" rx="20" ry="6.5" fill="none" ${s()} transform="rotate(-22 24 25)"/>` + c(24, 25, 10.5, Y) + `<path d="M5.6 32.4a20 6.5 -22 0 0 36.8-14.8" fill="none" ${s()}/>` + star(39, 9, .7, B) + star(8, 11, .5)],
  ["physics", "物理", [0, 60, 120].map((a) => `<ellipse cx="24" cy="24" rx="19" ry="7.5" fill="none" ${s(L, 2.3)} transform="rotate(${a} 24 24)"/>`).join("") + c(24, 24, 4, R) + c(41.5, 20.5, 2.2, B, false)],
  ["chemistry", "化学", p("M21 6v12L9.5 37.500a3.5 3.5 0 0 0 3 5.500h23a3.5 3.5 0 0 0 3-5.500L27 18V6", W) + p("M15 28.500h18l5.3 9a3.5 3.5 0 0 1-3 5.500H12.700a3.5 3.5 0 0 1-3-5.500z", GM) + ln("M18.5 6h11") + c(20.5, 36, 1.8, W, false) + c(27.5, 33.5, 1.3, W, false)],
  ["biology", "生物", p("M41 7C22 6 8 14.5 8 29c0 3 .800 6 2 8.500C25 39.5 41 31 41 7z", GM) + ln("M7 42c6-11 14-19 25-26.5") + ln("M17.5 30.500v-8M24.5 23.500v-6.5", L, 2.2, .7)],
  ["history", "历史", r(10, 10, 28, 28, 0, "#fff3dc") + ln("M16 20h16M16 26h16M16 31h9", L, 2.5, .3) + r(5, 5, 38, 8.5, 4.250, Y) + r(5, 34.5, 38, 8.5, 4.250, Y)],
  ["geography", "地理", c(24, 24, 18, "#c4e2ff") + p("M11 15c4-3 9.5-2 10.5 1.500s-2.5 5-1.5 8.5-2.5 6-6 5-6-5.5-6-9.500c0-2 1-4 3-5.500z", GM, L, 2) + p("M29 25c3.5-1.5 8 .500 8 4s-3 6.5-6.5 5.5-3.5-7.5-1.5-9.500z", GM, L, 2) + `<circle cx="24" cy="24" r="18" fill="none" ${s()}/>`],
  ["politics", "道法", ln("M24 10v30M14.5 42h19M8.5 15h31") + p("M8.5 15L3 27.500a6 6 0 0 0 11 0z", Y) + p("M39.5 15L34 27.500a6 6 0 0 0 11 0z", Y) + c(24, 8.5, 3, R)],
 ]],
 ["我的与通用", [
  ["grade", "年级", p("M12 22v10c0 3.5 6 6.5 12 6.500s12-3 12-6.500V22", BT) + p("M3.5 18L24 8l20.5 10L24 28z", B) + ln("M40.5 20v9") + c(40.5, 32, 2.3, Y)],
  ["privacy", "隐私", p("M24 4.500l15.5 5.500v12c0 10-6.5 17.5-15.5 21.500C15 39.5 8.5 32 8.5 22V10z", GT) + ln("M17 23.500l5 5 9.5-10.5", G, 3.4)],
  ["account", "账号", r(4.5, 9.5, 39, 29, 5) + c(16, 20.5, 4.2, BT) + ln("M9.5 32.500c0-3.3 2.7-5.5 6.5-5.500s6.5 2.2 6.5 5.5") + ln("M28.5 19.500h9M28.5 26.500h6", L, 2.5, .3)],
  ["service", "联系客服", ln("M9 27v-4.500a15 15 0 0 1 30 0V27") + ln("M39 37c0 3.5-4 5.5-10 5.5") + r(4.5, 24.5, 8.5, 13.5, 3.5, R) + r(35, 24.5, 8.5, 13.5, 3.5, R) + c(27, 42.5, 2.3, L, false)],
  ["about", "关于", c(24, 24, 18, BT) + ln("M24 22v11.5", L, 3.6) + c(24, 15, 2.3, L, false)],
  ["settings", "设置", ln("M7 14h34M7 24h34M7 34h34") + c(17, 14, 4.5, B) + c(31, 24, 4.5, Y) + c(20, 34, 4.5, R)],
  ["bell", "提醒", p("M24 6a11 11 0 0 0-11 11v8.500L8.5 34h31L35 25.500V17A11 11 0 0 0 24 6z", Y) + ln("M19.5 38.500a4.5 4.5 0 0 0 9 0") + c(35.5, 10.5, 4.5, R)],
  ["search", "搜索", c(21, 21, 13, BT) + ln("M30.5 30.500L41.5 41.5", L, 4.2) + ln("M14.5 20a7 7 0 0 1 5.5-5.5", W, 2.6)],
  ["star", "已掌握", p("M24 4.500l5.8 11.8 13 1.9-9.4 9.2 2.2 13L24 34.200l-11.6 6.2 2.2-13-9.4-9.2 13-1.900z", Y)],
  ["trash", "删除", p("M11.5 15l2 24.500a3 3 0 0 0 3 2.800h15a3 3 0 0 0 3-2.800l2-24.500z", RT) + ln("M7.5 15h33M18.5 15v-5a2.5 2.5 0 0 1 2.5-2.500h6a2.5 2.5 0 0 1 2.5 2.500v5") + ln("M20 22v13.500M28 22v13.5", R, 2.6)],
  ["todo", "待办", r(6.5, 6.5, 35, 35, 7) + r(12.5, 13.5, 8, 8, 2.5, GT) + ln("M14.5 17.500l1.8 1.8 3-3.5", G, 2.2) + r(12.5, 26.5, 8, 8, 2.5) + ln("M25.5 17.500h10M25.5 30.500h10", L, 2.5, .3)],
  ["pomodoro", "番茄钟", c(24, 27.5, 15.5, R) + ln("M13.5 25a11 11 0 0 1 5-7", W, 2.6, .8) + p("M24 14.500l-7-4.5 5.5-.500L24 4.500l1.5 5 5.5.500z", "#3aa57a")],
 ]],
 // 计划行里的小图标（18 左右）：插旗是我建的，进门是我加入的。太小，元气粉也不垫色块
 ["计划身份", [
  ["plan-mine", "我建的", ln("M11 43h12") + p("M17 8h23l-6 8 6 8H17z", R) + ln("M22 16h7", W, 2.5, .9) + ln("M17 5.5V43", L, 3)],
  ["plan-joined", "我加入的", r(7, 5, 23, 38, 4, BT) + c(13.5, 24, 1.8, L, false) + ln("M27 26H23", W, 7.5) + ln("M44 26H23M29.5 19.5L23 26l6.5 6.5", G, 3.4)],
 ]],
 // 学习计划页头部的圆按钮（22 左右）：出门是退出（和「进门」相反：门敞开、箭头往外），旗子打叉是解散（和「插旗」相对）
 ["计划操作", [
  ["plan-quit", "退出学习计划", `<path d="M25 6H13a5 5 0 0 0-5 5v26a5 5 0 0 0 5 5h12z" fill="${RT}"/>` + ln("M25 6H13a5 5 0 0 0-5 5v26a5 5 0 0 0 5 5h12") + ln("M19 24h24", W, 7.5) + ln("M19.5 24H42M34.5 16.5L42 24l-7.5 7.5", R, 3.4)],
  ["plan-dissolve", "解散学习计划", ln("M8 43h12") + p("M14 8h23l-6 8 6 8H14z", RT) + ln("M14 5.5V43", L, 3) + c(34.5, 34.5, 9.5, R) + ln("M31 31l7 7M38 31l-7 7", W, 2.8)],
 ]],
];
const NO_BLOB = ["horn", "plan-mine", "plan-joined", "plan-quit", "plan-dissolve"];
if (T.pop) {
  // 小表情：两只眼睛加一个笑
  const face = (x: number, y: number, k = 1, col = L) => `<g transform="translate(${x} ${y}) scale(${k})"><circle cx="-4" cy="0" r="1.7" fill="${col}"/><circle cx="4" cy="0" r="1.7" fill="${col}"/><path d="M-2.6 3.6q2.6 2.4 5.2 0" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/></g>`;
  const blush = (x: number, y: number, d = 7) => `<circle cx="${x - d}" cy="${y}" r="1.8" fill="${R}" opacity=".35"/><circle cx="${x + d}" cy="${y}" r="1.8" fill="${R}" opacity=".35"/>`;
  const O: Record<string, string> = {
    home: p("M10 21L24 9l14 12v17a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z", W) + ln("M6 23L24 8l18 15") + face(24, 27, 1.05) + blush(24, 30.5),
    papers: r(15, 6, 24, 30, 5, BT) + r(9, 12, 24, 30, 5) + face(21, 25) + blush(21, 28.5, 7) + ln("M16 35h10", L, 2.5, .3),
    camera: p("M17 14l2.5-4.5a2 2 0 0 1 1.7-1h5.6a2 2 0 0 1 1.7 1L31 14", W) + r(6, 14, 36, 26, 7) + c(24, 27, 8, BT) + face(24, 26, .8, B) + c(36, 20, 1.7, Y, false),
    me: p("M9 42c0-8 6.5-13 15-13s15 5 15 13z", BT, B) + c(24, 17, 9) + face(24, 16.5, .9) + blush(24, 19.5, 6),
    folder: p("M6 14a4 4 0 0 1 4-4h8l4 5h16a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", YT, Y) + p("M6 22h36v14a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", "#fff6dc", Y) + face(24, 29.5, 1, "#e89a00"),
    file: p("M11 5h17l11 11v24a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z", W) + p("M28 5v8a3 3 0 0 0 3 3h8z", BT, B) + face(23, 27) + ln("M17 37h12", L, 2.5, .3),
    plan: r(9, 9, 30, 34, 6) + `<rect x="17" y="5" width="14" height="8" rx="3.5" fill="${B}" ${s(B)}/>` + face(24, 24) + blush(24, 27.5) + ln("M17 36l2.4 2.4 4-4.6", B, 2.6) + ln("M27 36.5h5", L, 2.5, .3),
    knowledge: p("M24 6a12 12 0 0 0-7 21.7V31a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.3A12 12 0 0 0 24 6z", YT, Y) + ln("M19 38h10M21.5 42.5h5", Y) + face(24, 17.5, 1, "#e89a00") + ln("M6 12l3 2M42 12l-3 2M24 1.5V3", Y, 2.2),
    star: p("M24 4.5l5.8 11.8 13 1.9-9.4 9.2 2.2 13L24 34.2l-11.6 6.2 2.2-13-9.4-9.2 13-1.9z", YT, Y) + face(24, 23, 1, "#e89a00"),
    pomodoro: c(24, 27.5, 15.5, RT) + face(24, 27, 1.1) + blush(24, 31, 8) + p("M24 14.5l-7-4.5 5.5-.5L24 4.5l1.5 5 5.5.5z", B, B),
    done: `<circle cx="24" cy="24" r="18" fill="${BT}" ${s(B)}/>` + ln("M15 24.5l6.2 6.2L33 17.5", B, 4.2),
    wrong: r(8, 7, 26, 34, 5) + face(21, 20) + c(32, 32, 9.5, R) + ln("M28.3 28.3l7.4 7.4M35.7 28.3l-7.4 7.4", W, 2.8),
    bell: p("M24 6a11 11 0 0 0-11 11v8.5L8.5 34h31L35 25.5V17A11 11 0 0 0 24 6z", YT, Y) + ln("M19.5 38.5a4.5 4.5 0 0 0 9 0", Y) + face(24, 21, 1, "#e89a00") + c(35.5, 10.5, 4.5, R),
    about: `<circle cx="24" cy="24" r="18" fill="${BT}" ${s(B)}/>` + ln("M24 22v11.5", B, 3.6) + c(24, 15, 2.3, B, false),
    search: `<circle cx="21" cy="21" r="13" fill="${BT}" ${s(B)}/>` + ln("M30.5 30.5L41.5 41.5", L, 4.2) + ln("M14.5 20a7 7 0 0 1 5.5-5.5", W, 2.6),
    privacy: p("M24 4.5l15.5 5.5v12c0 10-6.5 17.5-15.5 21.5C15 39.5 8.5 32 8.5 22V10z", BT, B) + ln("M17 23.5l5 5 9.5-10.5", B, 3.4),
    "plan-mine": ln("M11 43h12") + p("M17 8h23l-6 8 6 8H17z", R) + face(25.5, 15, .8, W) + ln("M17 5.5V43", L, 3),
    "plan-joined": `<rect x="7" y="5" width="23" height="38" rx="4" fill="${BT}" ${s(B)}/>` + face(18, 15, .8, B) + ln("M27 26H23", W, 7.5) + ln("M44 26H23M29.5 19.5L23 26l6.5 6.5", R, 3.4),
    "plan-quit": `<path d="M25 6H13a5 5 0 0 0-5 5v26a5 5 0 0 0 5 5h12z" fill="${BT}"/>` + ln("M25 6H13a5 5 0 0 0-5 5v26a5 5 0 0 0 5 5h12", B) + ln("M19 24h24", W, 7.5) + ln("M19.5 24H42M34.5 16.5L42 24l-7.5 7.5", R, 3.4),
    "plan-dissolve": ln("M8 43h12") + p("M14 8h23l-6 8 6 8H14z", RT, B) + ln("M14 5.5V43", B, 3) + `<circle cx="34.5" cy="34.5" r="9.5" fill="${R}" ${s(R)}/>` + ln("M31 31l7 7M38 31l-7 7", W, 2.3),
  };
  // 背后错开的色块，粉蓝交替
  let i = 0;
  for (const [, list] of GROUPS) for (const it of list) {
    if (O[it[0]]) it[2] = O[it[0]];
    if (NO_BLOB.includes(it[0])) continue;
    const blob = i++ % 2 ? BT : RT;
    it[2] = `<path d="M27 8c9-1 16 5 17 14s-4 18-13 20-19-2-22-10 0-17 6-21 8-2.5 12-3z" fill="${blob}" opacity=".75" transform="rotate(${(i * 47) % 360} 26 26)"/>` + it[2];
  }
}
return GROUPS;
}

const cache: Record<string, Record<string, string>> = {};
function table(key: string): Record<string, string> {
  if (!cache[key]) {
    const t: Record<string, string> = {};
    for (const [, list] of build(PALETTES[key])) for (const [name, , inner] of list) t[name] = inner;
    cache[key] = t;
  }
  return cache[key];
}
export type ColorIconName =
  | "home" | "papers" | "camera" | "analysis" | "me"
  | "collect" | "album" | "erase" | "scan" | "wrong" | "ranking" | "knowledge" | "export" | "folder" | "file" | "video" | "retry" | "horn"
  | "plan" | "plan-new" | "homework" | "submit" | "review" | "deadline" | "done" | "teacher" | "members" | "invite"
  | "chinese" | "math" | "english" | "science" | "physics" | "chemistry" | "biology" | "history" | "geography" | "politics"
  | "grade" | "privacy" | "account" | "service" | "about" | "settings" | "bell" | "search" | "star" | "trash" | "todo" | "pomodoro"
  | "plan-mine" | "plan-joined" | "plan-quit" | "plan-dissolve";
/** 图标的 SVG 内容（不含外层 <svg>），viewBox 是 0 0 48 48 */
export function colorIconInner(name: ColorIconName, theme: ThemeName, dark = false): string {
  return table(dark ? `${theme}-dark` : theme)[name] ?? "";
}
export function colorIconSvg(name: ColorIconName, theme: ThemeName, dark = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">${colorIconInner(name, theme, dark)}</svg>`;
}
