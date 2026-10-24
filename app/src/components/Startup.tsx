import { useEffect, useState } from "react";
import "../styles/startup.css";

interface StartupProps {
  ready: boolean;
  error: boolean;
  onRetry: () => void;
  onDone: () => void;
}

/** 启动页只在初始化成功后退出，动效不代表虚构的加载百分比。 */
export default function Startup({ ready, error, onRetry, onDone }: StartupProps) {
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || !held || error) return;
    setLeaving(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduced ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [ready, held, error, onDone]);

  return (
    <main className={`startup${leaving ? " startup--leaving" : ""}`} aria-label="知错本启动页" aria-busy={!ready && !error}>
      <div className="startup__glow" aria-hidden="true" />
      <div className="startup__brand">
        <div className="startup__mark" aria-hidden="true">
          <svg viewBox="0 0 96 96" width="96" height="96" fill="none">
            <rect x="22" y="16" width="52" height="65" rx="11" fill="white" />
            <path d="M34 33h28M34 44h19" stroke="#B5CEFF" strokeWidth="5" strokeLinecap="round" />
            <path d="m36 61 9 9 18-21" stroke="#2F6FED" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M29 18v61" stroke="#E5EEFF" strokeWidth="2" />
          </svg>
        </div>
        <h1>知错本</h1>
        <p className="startup__tagline">每一次订正，都是进步</p>
      </div>
      <div className="startup__loading" role="status" aria-live="polite">
        {error ? (
          <>
            <p>启动遇到了一点问题</p>
            <button type="button" onClick={onRetry}>重新加载</button>
          </>
        ) : (
          <>
            <div className={`startup__track${ready ? " startup__track--ready" : ""}`} aria-hidden="true"><span /></div>
            <p>{ready ? "准备就绪，即将进入" : "正在准备你的学习空间…"}</p>
          </>
        )}
      </div>
      <footer className="startup__footer">收集错题 · 整理思路 · 看见成长</footer>
    </main>
  );
}
