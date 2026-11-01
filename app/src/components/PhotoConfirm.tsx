import { useEffect, useState } from "react";
import { rotateImage } from "../lib/native";
import { answerPhotoConfirm, usePhotoConfirm } from "../store/photoConfirm";
import { Icon } from "./Icon";

/** 拍完照的全屏确认：黑底居中显示照片，左上 × 重拍，右上 ✓ 加入队列，底下左转 / 右转把横着或倒着拍的试卷摆正 */
export function PhotoConfirmHost() {
  const src = usePhotoConfirm((s) => s.src);
  const [turns, setTurns] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 换了一张照片：从没转过开始
  useEffect(() => {
    setTurns(0);
    setShown(src);
  }, [src]);

  // 每次都从原图转，转几次也只压缩一回
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setBusy(true);
    rotateImage(src, turns)
      .then((out) => { if (alive) setShown(out); })
      .catch(() => { if (alive) setTurns(0); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [src, turns]);

  // 打开时页面不跟着滚动
  useEffect(() => {
    if (!src) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [src]);

  if (!src) return null;
  return (
    <div className="photo-confirm" role="dialog" aria-modal="true" aria-label="确认这张照片">
      <img className="photo-confirm__img" src={shown ?? src} alt="刚拍的照片" />
      <div className="photo-confirm__bar">
        <button className="photo-confirm__btn" aria-label="重拍" onClick={() => answerPhotoConfirm(null)}>
          <Icon name="xmark" size={30} stroke={2.2} />
        </button>
        <button className="photo-confirm__btn" aria-label="用这张，加入待扫描" disabled={busy} onClick={() => answerPhotoConfirm(shown ?? src)}>
          <Icon name="check" size={32} stroke={2.4} />
        </button>
      </div>
      <div className="photo-confirm__tools">
        <button className="photo-confirm__tool" aria-label="向左转 90 度" disabled={busy} onClick={() => setTurns((t) => (t + 3) % 4)}>
          <Icon name="rotate" size={24} stroke={2} style={{ transform: "scaleX(-1)" }} />
          <span>向左转</span>
        </button>
        <button className="photo-confirm__tool" aria-label="向右转 90 度" disabled={busy} onClick={() => setTurns((t) => (t + 1) % 4)}>
          <Icon name="rotate" size={24} stroke={2} />
          <span>向右转</span>
        </button>
      </div>
    </div>
  );
}
