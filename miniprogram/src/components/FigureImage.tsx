import { useEffect, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { cropFigure, type FigureRef } from "../lib/figures";
import { MathText } from "./ui";

/** 从原照片裁出来的插图；点一下全屏看（可双指放大）。裁不出来时显示文字说明。
 *  带 label 的（图片选项、配对图）显示成小图并标字母；mark 标出正确答案（绿）和学生选错的（红） */
export function FigureImage({ fig, mark }: { fig: FigureRef; mark?: "right" | "wrong" }) {
  const [path, setPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    cropFigure(fig)
      .then((p) => alive && setPath(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fig.key]);

  const caption = fig.label ? `${fig.label}${mark === "right" ? " ✓ 正确" : mark === "wrong" ? " ✗ 所选" : ""}` : fig.title;
  return (
    <View className={`fig${fig.label ? " fig--opt" : ""}${mark ? ` fig--${mark}` : ""}`}>
      {path ? (
        <Image className="fig__img" src={path} mode="widthFix" onClick={() => Taro.previewImage({ urls: [path], current: path })} />
      ) : failed ? (
        <View className="fig__text">
          <MathText text={fig.text || "插图"} />
        </View>
      ) : (
        <View className="fig__placeholder" />
      )}
      {caption && <Text className="fig__caption">{caption}</Text>}
    </View>
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
          <View className="fig-row" key={g[0].key}>
            {g.map((f) => (
              <FigureImage key={f.key} fig={f} mark={markOf(f)} />
            ))}
          </View>
        ) : (
          <FigureImage key={g[0].key} fig={g[0]} />
        ),
      )}
    </>
  );
}
