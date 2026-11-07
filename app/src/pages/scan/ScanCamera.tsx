import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { ScanViewer } from "../../components/ScanViewer";
import { Button, Sheet } from "../../components/ui";
import { DETECT_SIDE, detectQuad, QuadTracker, type Quad } from "../../lib/docDetect";
import { haptic, pickImages, releaseCanvas } from "../../lib/native";
import { canUseLiveCamera, coverMapping, openCamera, setTorch, stopCamera, torchSupported } from "../../lib/scanCamera";
import { toastError } from "../../store/banner";
import { useCapture } from "../../store/capture";
import { addAlbumPages, addShot, clearScan, loadScanPrefs, removeShot, restoreDraft, setAutoShoot, setEnhance, startScan, useScan } from "../../store/scan";

type EntryState = { folderId?: string | null; from?: string } | null;

/** 检测间隔（毫秒）：每秒约 8 次，够跟手，也不太费电 */
const DETECT_MS = 120;
/** 自动拍：绿框稳住多久按快门 */
const AUTO_HOLD_MS = 800;
/** 拍下来的原图最长边：再大没用（上传前会缩到 1568），还占内存 */
const RAW_MAX_SIDE = 3000;

/**
 * 连拍扫描的取景页：实时框出试卷，按快门就裁边拉正（后台做），接着拍；拍完点「完成」去整理。
 * 顶部：× 退出（照片留在本机）、闪光灯（安卓）、自动拍；⋯ 里有提亮开关、相册、系统相机。
 * 底部：撤回（删上一张）、快门、完成 N。右下角缩略图堆叠，点开逐张查看。
 */
export default function ScanCamera() {
  const nav = useNavigate();
  const loc = useLocation();
  const entry = (loc.state as EntryState) ?? null;
  const shots = useScan((s) => s.shots);
  const autoShoot = useScan((s) => s.autoShoot);
  const enhance = useScan((s) => s.enhance);

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tracker = useRef(new QuadTracker());
  const quadRef = useRef<Quad | null>(null); // 视频像素坐标
  const armedRef = useRef(true); // 自动拍：拍完要等纸换了才再拍
  const lastShotQuad = useRef<Quad | null>(null);
  const shootingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<"denied" | "unavailable" | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [video, setVideo] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [torch, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [flash, setFlash] = useState(0);
  const [fly, setFly] = useState<{ src: string; from: { x: number; y: number; w: number; h: number }; go: boolean } | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 进来：读偏好和草稿，记下放进哪个文件夹
  useEffect(() => {
    void loadScanPrefs();
    void restoreDraft().then((n) => { if (n) showToast(`上次拍的 ${n} 张还在`); });
    startScan(entry?.folderId ?? null, entry?.from || "/home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (t: string) => {
    setToastText(t);
    window.setTimeout(() => setToastText((x) => (x === t ? null : x)), 1600);
  };

  // 打开相机；切到后台时关掉，回来再开
  const start = useCallback(async () => {
    if (!canUseLiveCamera()) {
      setError("unavailable");
      return;
    }
    try {
      const stream = await openCamera();
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { stopCamera(stream); return; }
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setHasTorch(torchSupported(stream));
      setError(null);
      setReady(true);
      setStarted(performance.now());
    } catch (e) {
      setError((e as Error).message === "permission_denied" ? "denied" : "unavailable");
    }
  }, []);

  useEffect(() => {
    void start();
    const onVis = () => {
      if (document.hidden) {
        stopCamera(streamRef.current);
        streamRef.current = null;
        setReady(false);
        setTorchOn(false);
      } else if (!streamRef.current) void start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [start]);

  // 取景区尺寸
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 找四边：每 DETECT_MS 取一帧缩小的画面
  const paused = viewer !== null || more || leaving;
  useEffect(() => {
    if (!ready || paused) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let timer = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && ctx && v.videoWidth && v.readyState >= 2) {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        setVideo((old) => (old && old.w === vw && old.h === vh ? old : { w: vw, h: vh }));
        const s = DETECT_SIDE / Math.max(vw, vh);
        const w = Math.round(vw * s);
        const h = Math.round(vh * s);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(v, 0, 0, w, h);
        const found = detectQuad(ctx.getImageData(0, 0, w, h).data, w, h);
        const t = performance.now();
        const q = tracker.current.update(found ? (found.map(([x, y]) => [x / s, y / s]) as Quad) : null, t, Math.hypot(vw, vh));
        quadRef.current = q;
        setQuad(q);
        setNow(t);
        // 自动拍：纸换了（框没了或者挪远了）才重新上膛
        if (!q) armedRef.current = true;
        else if (lastShotQuad.current && Math.max(...q.map((p, i) => Math.hypot(p[0] - lastShotQuad.current![i][0], p[1] - lastShotQuad.current![i][1]))) > Math.hypot(vw, vh) * 0.15) armedRef.current = true;
        if (useScan.getState().autoShoot && q && armedRef.current && t - tracker.current.stableSince > AUTO_HOLD_MS) void shootRef.current();
      }
      timer = window.setTimeout(tick, DETECT_MS);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      releaseCanvas(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, paused]);

  const map = video ? coverMapping(video.w, video.h, view.w, view.h) : null;

  /** 拍一张：整帧存下来，带上当前的绿框，后台拉正 */
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || shootingRef.current) return;
    shootingRef.current = true;
    try {
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const s = Math.min(1, RAW_MAX_SIDE / Math.max(vw, vh));
      const c = document.createElement("canvas");
      c.width = Math.round(vw * s);
      c.height = Math.round(vh * s);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const raw = c.toDataURL("image/jpeg", 0.92);
      releaseCanvas(c);
      const q = quadRef.current;
      const norm = q ? (q.map(([x, y]) => [Math.min(1, Math.max(0, x / vw)), Math.min(1, Math.max(0, y / vh))]) as Quad) : null;
      addShot(raw, Math.round(vw * s), Math.round(vh * s), norm);
      armedRef.current = false;
      lastShotQuad.current = q;
      void haptic.rigid();
      setFlash((n) => n + 1);
      // 飞进右下角：从绿框（没有框就是整个取景区）缩过去
      const m = coverMapping(vw, vh, view.w, view.h);
      let from = { x: 16, y: 16, w: view.w - 32, h: view.h - 32 };
      if (q) {
        const pts = q.map(([x, y]) => m.toView(x, y));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        from = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      setFly({ src: raw, from, go: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setFly((f) => (f ? { ...f, go: true } : f))));
      window.setTimeout(() => setFly(null), 520);
    } catch (e) {
      toastError(e);
    } finally {
      window.setTimeout(() => { shootingRef.current = false; }, 350);
    }
  };

  const shootRef = useRef(shoot);
  shootRef.current = shoot;

  const undo = () => {
    const last = useScan.getState().shots[useScan.getState().shots.length - 1];
    if (!last) return;
    removeShot(last.id);
    void haptic.light();
    showToast("已撤回 1 张");
  };

  const toggleTorch = async () => {
    const on = !torch;
    if (await setTorch(streamRef.current, on)) setTorchOn(on);
  };

  const exit = () => {
    if (window.history.length > 1 && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) nav(-1);
    else nav(useScan.getState().from || "/home", { replace: true });
  };

  const close = () => {
    if (useScan.getState().shots.length) setLeaving(true);
    else exit();
  };

  const finish = () => {
    if (!useScan.getState().shots.length) return;
    nav("/scan/arrange", { replace: true });
  };

  const fromAlbum = async () => {
    setMore(false);
    try {
      const list = await pickImages(0);
      if (!list.length) return;
      await addAlbumPages(list);
      nav("/scan/arrange", { replace: true });
    } catch (e) {
      toastError((e as Error).message === "permission_denied" ? new Error("需要相册权限，可以在系统设置里打开") : e);
    }
  };

  /** 退回系统相机的旧流程（录入页） */
  const systemCamera = () => {
    setMore(false);
    const cap = useCapture.getState();
    cap.reset();
    cap.setReturnTo(useScan.getState().from || "/home");
    nav("/capture", { replace: true, state: { folderId: useScan.getState().folderId, source: "camera" } });
  };

  // 拿不到页面内相机（不是用户拒绝）：直接走系统相机
  useEffect(() => {
    if (error === "unavailable") systemCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const n = shots.length;
  const last = shots[n - 1];
  const under = shots[n - 2];
  const busy = shots.some((s) => s.status === "busy");
  const failed = shots.some((s) => s.status === "fail");
  const searching = ready && now - started < 900 && !quad;
  const hint = !ready ? null : quad ? (autoShoot ? "拿稳，马上自动拍" : "框住了，拿稳别动") : searching ? "正在找试卷…" : "离远一点，让试卷四个角都露出来";
  const poly = quad && map ? quad.map(([x, y]) => map.toView(x, y)) : null;
  const thumb = (s: typeof last) => s?.page?.thumb ?? s?.raw;

  return (
    <div className="scan">
      <div className="scan__top">
        <button className="scan-btn" aria-label="退出" onClick={close}><Icon name="xmark" size={26} stroke={2.2} /></button>
        <div className="scan__top-mid">
          {hasTorch && (
            <button className={`scan-btn${torch ? " scan-btn--on" : ""}`} aria-label={torch ? "关闪光灯" : "开闪光灯"} onClick={toggleTorch}>
              <Icon name={torch ? "bolt" : "bolt-off"} size={23} stroke={1.9} />
            </button>
          )}
          <button className={`scan-auto${autoShoot ? " scan-auto--on" : ""}`} aria-pressed={autoShoot} onClick={() => setAutoShoot(!autoShoot)}>
            <Icon name="viewfinder" size={14} stroke={2.2} />自动拍
          </button>
        </div>
        <button className="scan-btn" aria-label="更多" onClick={() => setMore(true)}><Icon name="ellipsis" size={24} stroke={2.2} /></button>
      </div>

      <div className="scan__view" ref={viewRef}>
        <video ref={videoRef} className="scan__video" playsInline muted autoPlay />
        {poly ? (
          <svg className="scan__ov" viewBox={`0 0 ${view.w} ${view.h}`}>
            <polygon points={poly.map((p) => p.join(",")).join(" ")} fill="var(--scan-fill)" stroke="var(--scan)" strokeWidth={2.6} strokeLinejoin="round" />
            {poly.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5} fill="#fff" stroke="var(--scan)" strokeWidth={2.5} />)}
          </svg>
        ) : ready && !searching ? (
          <svg className="scan__ov" viewBox={`0 0 ${view.w} ${view.h}`}>
            <g fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={3} strokeLinecap="round">
              <path d={`M40 ${view.h * 0.15}v-30h30M${view.w - 40} ${view.h * 0.15}v-30h-30M40 ${view.h * 0.87}v30h30M${view.w - 40} ${view.h * 0.87}v30h-30`} />
            </g>
          </svg>
        ) : null}
        {hint && (
          <div className={`scan-hint${quad ? " scan-hint--ok" : ""}`}>
            <Icon name={quad ? "check" : searching ? "viewfinder" : "info"} size={15} stroke={2.4} />{hint}
          </div>
        )}
        {error === "denied" && (
          <div className="scan-msg">
            <Icon name="camera" size={40} stroke={1.8} />
            <span>需要相机权限才能拍试卷，可以在系统设置里打开。</span>
            <Button size="sm" variant="tinted" onClick={systemCamera}>用系统相机拍</Button>
            <Button size="sm" variant="plain" onClick={fromAlbum}>从相册选</Button>
          </div>
        )}
        {!ready && !error && <div className="scan-msg"><span className="spinner-ring" /></div>}
        {flash > 0 && <div key={flash} className="scan__flash" />}
        {fly && (
          <img
            className="scan-fly"
            src={fly.src}
            alt=""
            style={fly.go
              ? { left: view.w - 14 - 71, top: view.h - 14 - 22 - 6 - 88, width: 66, height: 88, transform: "rotate(-6deg)" }
              : { left: fly.from.x, top: fly.from.y, width: fly.from.w, height: fly.from.h }}
          />
        )}
        {n > 0 && (
          <button className="scan-stack" aria-label={`已拍 ${n} 张，点开逐张查看`} onClick={() => setViewer(n - 1)}>
            <span className="scan-stack__imgs">
              {under && <img className="under" src={thumb(under)} alt="" />}
              {last && <img src={thumb(last)} alt="" />}
              <span className="scan-stack__badge">{n}</span>
            </span>
            {busy ? (
              <span className="scan-stack__state"><i className="mini-spin" />调正中</span>
            ) : failed ? (
              <span className="scan-stack__state scan-stack__state--fail"><Icon name="warning" size={11} stroke={2.6} />有 1 张没处理好</span>
            ) : (
              <span className="scan-stack__state scan-stack__state--ok"><Icon name="check" size={11} stroke={3} />已调正</span>
            )}
          </button>
        )}
        {toastText && <div className="scan-toast">{toastText}</div>}
      </div>

      <div className="scan__bottom">
        <div className="scan__mode">扫描试卷</div>
        <div className="scan__ctl">
          <button className="scan-undo" disabled={!n} onClick={undo} aria-label="撤回上一张">
            <Icon name="undo" size={26} stroke={2} /><span>撤回</span>
          </button>
          <button className={`scan-shutter${quad ? " scan-shutter--ready" : ""}`} aria-label="拍照" disabled={!ready} onClick={() => void shoot()} />
          <button className="scan-done" disabled={!n} onClick={finish}>完成{n > 0 && <b>{n}</b>}</button>
        </div>
      </div>

      {viewer !== null && <ScanViewer start={viewer} onClose={() => setViewer(null)} />}

      <Sheet open={more} onClose={() => setMore(false)} title="拍照设置">
        <div className="group">
          <button className="row" style={{ minHeight: 56 }} onClick={() => setEnhance(!enhance)}>
            <span className="row__main"><span className="row__title">自动提亮</span><span className="row__sub">去掉阴影、底色拉白，字更清楚</span></span>
            <span className={`toggle${enhance ? " on" : ""}`} aria-hidden />
          </button>
          <button className="row" style={{ minHeight: 56 }} onClick={() => setAutoShoot(!autoShoot)}>
            <span className="row__main"><span className="row__title">自动拍</span><span className="row__sub">框住试卷、拿稳不到一秒就自动按快门</span></span>
            <span className={`toggle${autoShoot ? " on" : ""}`} aria-hidden />
          </button>
        </div>
        <div className="group">
          <button className="row" style={{ minHeight: 52 }} onClick={fromAlbum}>
            <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="photo" size={18} /></span>
            <span className="row__main"><span className="row__title">从相册选</span></span>
          </button>
          <button className="row" style={{ minHeight: 52 }} onClick={systemCamera}>
            <span className="row__icon" style={{ background: "var(--tertiary)" }}><Icon name="camera" size={18} /></span>
            <span className="row__main"><span className="row__title">用系统相机拍</span><span className="row__sub">这里的相机用不了时试试</span></span>
          </button>
        </div>
      </Sheet>

      <Sheet open={leaving} onClose={() => setLeaving(false)} title={`已拍 ${n} 张，还没识别`}>
        <Button onClick={() => { setLeaving(false); finish(); }}>去整理、开始识别</Button>
        <Button variant="tinted" onClick={() => { setLeaving(false); exit(); }}>先留着，下次接着拍</Button>
        <Button variant="danger" onClick={() => { setLeaving(false); clearScan(); exit(); }}>全部不要</Button>
      </Sheet>
    </div>
  );
}
