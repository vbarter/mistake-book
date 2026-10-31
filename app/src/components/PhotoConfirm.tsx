import { useEffect } from "react";
import { answerPhotoConfirm, usePhotoConfirm } from "../store/photoConfirm";
import { Icon } from "./Icon";

/** 拍完照的全屏确认：黑底居中显示照片，左上 × 重拍，右上 ✓ 加入队列 */
export function PhotoConfirmHost() {
  const src = usePhotoConfirm((s) => s.src);

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
      <img className="photo-confirm__img" src={src} alt="刚拍的照片" />
      <div className="photo-confirm__bar">
        <button className="photo-confirm__btn" aria-label="重拍" onClick={() => answerPhotoConfirm(false)}>
          <Icon name="xmark" size={30} stroke={2.2} />
        </button>
        <button className="photo-confirm__btn" aria-label="用这张，加入待扫描" onClick={() => answerPhotoConfirm(true)}>
          <Icon name="check" size={32} stroke={2.4} />
        </button>
      </div>
    </div>
  );
}
