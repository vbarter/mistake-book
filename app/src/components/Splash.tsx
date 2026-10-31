/** 开屏动效：three.js 画面 + 字幕 + 跳过 + 结尾 Logo。three.js 按需加载，不拖慢首屏。 */
import { useCallback, useEffect, useRef, useState } from "react";

export default function Splash({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState(-1);
  const [captions, setCaptions] = useState<string[]>([]);
  const [logo, setLogo] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  // 只在挂载时启动一次动画；父组件重渲染换了 onDone 也不重启
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onDoneRef.current(), 420);
  }, []);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onDoneRef.current();
      return;
    }
    let raf = 0;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import("../splash/scene")
      .then(({ createSplash, CAPTIONS, DURATION, LOGO_AT }) => {
        const canvas = canvasRef.current;
        if (disposed || !canvas) return;
        let s: ReturnType<typeof createSplash>;
        try {
          s = createSplash(canvas);
        } catch {
          onDoneRef.current(); // 没有 WebGL：直接进 App
          return;
        }
        setCaptions(CAPTIONS.map((c) => c.text));
        const fit = () => s.resize(canvas.clientWidth, canvas.clientHeight);
        fit();
        window.addEventListener("resize", fit);
        // 开发时 /splash?t=11.8 定格在某一秒，方便逐帧看效果
        const tParam = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("t") : null;
        const freeze = tParam ? Number(tParam) : NaN;
        const start = performance.now() - (Number.isFinite(freeze) ? freeze * 1000 : 0);
        let lastCap = -2;
        let lastLogo = false;
        const loop = () => {
          const t = Number.isFinite(freeze) ? freeze : (performance.now() - start) / 1000;
          s.render(Math.min(t, DURATION));
          const cap = CAPTIONS.findIndex((c) => t >= c.from && t < c.to);
          if (cap !== lastCap) setCaption((lastCap = cap));
          const lg = t >= LOGO_AT;
          if (lg !== lastLogo) setLogo((lastLogo = lg));
          if (t >= DURATION && !Number.isFinite(freeze)) finish();
          else raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener("resize", fit);
          s.dispose();
        };
      })
      .catch(() => onDoneRef.current());
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [finish]);

  return (
    <div className={`splash${leaving ? " splash--leaving" : ""}`}>
      <canvas ref={canvasRef} className="splash__canvas" />
      <button className="splash__skip" onClick={finish}>跳过</button>
      <div className="splash__captions" aria-live="polite">
        {captions.map((text, i) => (
          <p key={i} className={`splash__caption${caption === i ? " on" : ""}`}>{text}</p>
        ))}
      </div>
      <div className={`splash__logo${logo ? " on" : ""}`}>
        <div className="splash__icon">
          <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
            <rect x="12" y="8" width="40" height="48" rx="8" fill="#fff" />
            <path d="M22 24h20M22 32h14" stroke="#b9c6ff" strokeWidth="4" strokeLinecap="round" />
            <path d="M24 44l6 6 12-14" stroke="#22b07d" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="splash__name">知错本</span>
      </div>
    </div>
  );
}
