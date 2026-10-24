import { useEffect, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { cropFigure, type FigureRef } from "../lib/figures";
import { MathText } from "./ui";

/** 从原照片裁出来的插图；点一下全屏看（可双指放大）。裁不出来时显示图题和文字说明 */
export function FigureImage({ fig }: { fig: FigureRef }) {
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

  return (
    <View className="fig">
      {path ? (
        <Image className="fig__img" src={path} mode="widthFix" onClick={() => Taro.previewImage({ urls: [path], current: path })} />
      ) : failed ? (
        <View className="fig__text">
          <MathText text={fig.text || "插图"} />
        </View>
      ) : (
        <View className="fig__placeholder" />
      )}
      {fig.title && <Text className="fig__caption">{fig.title}</Text>}
    </View>
  );
}
