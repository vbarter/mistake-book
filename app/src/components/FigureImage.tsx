import { useEffect, useState } from "react";
import { CropCancelled, cropFigure, type FigureRef } from "../lib/figures";
import { MathText } from "./MathText";

/** 从原照片裁出来的插图；点一下放大 / 缩小。裁不出来时显示文字说明。
 *  带 label 的（图片选项、配对图）显示成小图并标字母；mark 标出正确答案（绿）和学生选错的（红） */
export function FigureImage({ fig, mark }: { fig: FigureRef; mark?: "right" | "wrong" }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    // 排到号时已经滑走（卸载）了就不裁；别处同一张图被取消、这里还在屏幕上的，重新排一次
    const load = (): Promise<void> =>
      cropFigure(fig, undefined, undefined, () => alive)
        .then((u) => { if (alive) setUrl(u); })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof CropCancelled) return load();
          setFailed(true);
        });
    void load();
    return () => {
      alive = false;
    };
  }, [fig.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const caption = fig.label ? `${fig.label}${mark === "right" ? " ✓ 正确" : mark === "wrong" ? " ✗ 所选" : ""}` : fig.title;
  return (
    <figure className={`fig${fig.label ? " fig--opt" : ""}${mark ? ` fig--${mark}` : ""}${zoom ? " fig--zoom" : ""}`}>
      {url ? (
        <img src={url} alt={fig.label || fig.title || "插图"} onClick={() => setZoom((v) => !v)} />
      ) : failed ? (
        <div className="fig__text"><MathText text={fig.text || "插图"} /></div>
      ) : (
        <div className="fig__placeholder" />
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** 一组插图：普通插图一张一行；连着的带 label 的图排成一行。right / chosen 是正确答案和学生作答里的标号 */
export function Figures({ figs, right = [], chosen = [] }: { figs: FigureRef[]; right?: string[]; chosen?: string[] }) {
  const groups: FigureRef[][] = [];
  for (const f of figs) {
    const last = groups[groups.length - 1];
    if (f.label && last && last[0].label) last.push(f);
    else groups.push([f]);
  }
  const markOf = (f: FigureRef) => {
    const l = f.label.toUpperCase();
    if (!l) return undefined;
    if (right.includes(l)) return "right" as const;
    if (chosen.includes(l)) return "wrong" as const;
    return undefined;
  };
  return (
    <>
      {groups.map((g) =>
        g[0].label ? (
          <div className="fig-row" key={g[0].key}>
            {g.map((f) => <FigureImage key={f.key} fig={f} mark={markOf(f)} />)}
          </div>
        ) : (
          <FigureImage key={g[0].key} fig={g[0]} />
        ),
      )}
    </>
  );
}
