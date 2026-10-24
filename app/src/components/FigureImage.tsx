import { useEffect, useState } from "react";
import { cropFigure, type FigureRef } from "../lib/figures";
import { MathText } from "./MathText";

/** 从原照片裁出来的插图；点一下放大 / 缩小。裁不出来时显示图题和文字说明 */
export function FigureImage({ fig }: { fig: FigureRef }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    cropFigure(fig)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fig.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className={`fig${zoom ? " fig--zoom" : ""}`}>
      {url ? (
        <img src={url} alt={fig.title || "插图"} onClick={() => setZoom((v) => !v)} />
      ) : failed ? (
        <div className="fig__text"><MathText text={fig.text || "插图"} /></div>
      ) : (
        <div className="fig__placeholder" />
      )}
      {fig.title && <figcaption>{fig.title}</figcaption>}
    </figure>
  );
}
