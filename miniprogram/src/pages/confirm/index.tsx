import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useUnload } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { useMenuButton } from "../../components/ui";
import { answerConfirm, confirmingSrc } from "../../lib/confirm";
import { useShare } from "../../lib/share";

/**
 * 拍完照的全屏确认：黑底居中显示照片，左上 × 重拍，底下一排「向左转 / ✓ 用这张 / 向右转」。
 * 右上角是微信的胶囊按钮（··· 和关闭），✓ 放那儿会和胶囊叠在一起、误点到关闭，所以确认挪到底部操作区；
 * 顶栏只留 ×，和胶囊同一行垂直对齐，右侧给胶囊让位。
 */
/** 顶栏在胶囊上下各多留的高度；底部操作区高度（和 .confirm__tools 一致） */
const BAR_PAD = 12;
const TOOLS_H = 88;

export default function ConfirmPage() {
  useShare();
  const src = useMemo(() => confirmingSrc(), []);
  const mb = useMenuButton();
  const [turns, setTurns] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const sys = useMemo(() => Taro.getSystemInfoSync(), []);

  useEffect(() => {
    if (!src) {
      void Taro.navigateBack();
      return;
    }
    Taro.getImageInfo({ src })
      .then((i) => setSize({ w: i.width, h: i.height }))
      .catch(() => setSize({ w: 3, h: 4 }));
  }, [src]);

  // 结果在页面关掉时才交回去：拍照流程接着要起相机，得等这一页退出以后。没点 × / ✓ 就离开（返回键、侧滑）当作不要这张
  const result = useRef<{ turns: number } | null>(null);
  useUnload(() => {
    answerConfirm(result.current);
  });

  const done = (ok: boolean) => {
    if (leaving) return;
    setLeaving(true);
    result.current = ok ? { turns } : null;
    void Taro.navigateBack();
  };

  // 照片框：转了奇数次时宽高对调，按转过以后的样子塞进可用区域
  const stageW = sys.windowWidth;
  const barTop = Math.max(0, mb.top - BAR_PAD);
  const barH = mb.height + BAR_PAD * 2;
  const stageH = sys.windowHeight - (barTop + barH) - TOOLS_H - (sys.safeArea ? sys.screenHeight - sys.safeArea.bottom : 0);
  const odd = turns % 2 === 1;
  const box = size
    ? (() => {
        const s = odd ? Math.min(stageW / size.h, stageH / size.w) : Math.min(stageW / size.w, stageH / size.h);
        return { width: `${Math.round(size.w * s)}px`, height: `${Math.round(size.h * s)}px` };
      })()
    : { width: "0px", height: "0px" };

  return (
    <View className="confirm" catchMove>
      <View style={{ height: `${barTop}px` }} />
      <View className="confirm__bar" style={{ height: `${barH}px`, paddingRight: `${mb.right}px` }}>
        <View className="confirm__btn" hoverClass="confirm__btn--hover" onClick={() => done(false)}>
          <Icon name="xmark" size={28} color="#ffffff" stroke={2.2} />
        </View>
      </View>
      <View className="confirm__stage">
        {src && <Image className="confirm__img" src={src} mode="scaleToFill" style={{ ...box, transform: `rotate(${turns * 90}deg)` }} />}
      </View>
      <View className="confirm__tools">
        <View className="confirm__tool" hoverClass="confirm__tool--hover" onClick={() => setTurns((t) => (t + 3) % 4)}>
          <Icon name="rotate" size={22} color="#ffffff" stroke={2} style={{ transform: "scaleX(-1)" }} />
          <Text>向左转</Text>
        </View>
        <View className="confirm__ok" hoverClass="confirm__ok--hover" onClick={() => done(true)}>
          <Icon name="check" size={22} color="#000000" stroke={2.6} />
          <Text>用这张</Text>
        </View>
        <View className="confirm__tool" hoverClass="confirm__tool--hover" onClick={() => setTurns((t) => (t + 1) % 4)}>
          <Icon name="rotate" size={22} color="#ffffff" stroke={2} />
          <Text>向右转</Text>
        </View>
      </View>
    </View>
  );
}
