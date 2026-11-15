import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CoverView, Image, Text, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow, useUnload } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { useMenuButton } from "../../components/ui";
import { answerCamera, cameraSingle, type CameraShot } from "../../lib/camera";
import { confirmPhoto } from "../../lib/confirm";

/**
 * 拍试卷的拍照页：中间是 3:4 的取景（和拍出来的照片同一个比例，看到多少拍到多少），上面画四个角的对齐框；
 * 按快门拿原图 → 全屏确认（pages/confirm：上滑用这张 / 下滑重拍，可以转方向）→ 回到这里接着拍，点「完成」才走。
 * 顶部一行和微信胶囊对齐：左边 × 退出、补光灯。底部：刚拍的那张（带张数）、快门、完成。
 * 取景上面的东西（对齐框、提示）用 CoverView：<camera> 是原生组件，普通 View 在一部分手机上盖不上去；其它按钮都放在取景外面。
 * 相机起不来（没给权限等）时把 null 交回去，调用方退回微信自带的拍照界面。
 * 有的手机上相机起不来也不报错（系统没给微信相机权限、相机被占着），只是一片黑：等 INIT_TIMEOUT 还没就绪就当作起不来。
 * 去确认页时把 <camera> 拆掉、回来再建一个新的：iPhone 上页面被盖住时相机会被暂停，回来既不恢复画面也不发 stop，
 * 留着旧的就是一片黑、快门按了也拍不出来（连拍第二张黑屏就是这个）。
 */
/** 相机多久还没就绪算起不来（ms）。正常一秒内就绪 */
const INIT_TIMEOUT = 4000;
/** 回到这一页后等多久再建相机（ms）：iPhone 上旧相机还没放干净就建新的，新的也会黑 */
const REMOUNT_DELAY = 300;
/** 按快门后多久没回来算没拍成（ms），免得快门一直灰着 */
const TAKE_TIMEOUT = 5000;
/** 底部操作区高度（和 .cam__bottom 一致，不含底部安全区） */
const BOTTOM_H = 132;
/** 对齐框：离取景边缘多远、角标多长多粗（px） */
const FRAME_INSET = 22;
const CORNER_LEN = 30;
const CORNER_W = 3;
const HINT_W = 232;

type TakeOption = Parameters<Taro.CameraContext["takePhoto"]>[0];

export default function CameraPage() {
  const single = useMemo(() => cameraSingle(), []);
  const mb = useMenuButton();
  const sys = useMemo(() => Taro.getSystemInfoSync(), []);
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // 换一个 key 就是把 <camera> 拆掉重建一个
  const [camKey, setCamKey] = useState(0);
  const [visible, setVisible] = useState(true);
  // 页面在前台、<camera> 挂着：去确认页时拆掉，回来稍等一下再挂
  const [mounted, setMounted] = useState(true);
  const mountedRef = useRef(true);

  // 结果在页面关掉时才交回去（和确认页一样）：调用方接着要弹框 / 上传，得等这一页退出以后
  const shotsRef = useRef<CameraShot[]>([]);
  const failed = useRef(false);
  const closing = useRef(false);
  useUnload(() => {
    answerCamera(failed.current && !shotsRef.current.length ? null : shotsRef.current);
  });

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Taro.navigateBack().catch(() => {
      closing.current = false;
    });
  };

  /** 拍一张原图；个别基础库不认 original 时退到 high。每次现取相机上下文，对上重建后的那个 <camera>；超时不回来也算没拍成 */
  const take = (quality: "original" | "high") =>
    new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), TAKE_TIMEOUT);
      Taro.createCameraContext().takePhoto({
        quality,
        success: (r: { tempImagePath: string }) => {
          clearTimeout(t);
          resolve(r.tempImagePath);
        },
        fail: (e: unknown) => {
          clearTimeout(t);
          reject(e);
        },
      } as unknown as TakeOption);
    });

  const shoot = async () => {
    if (busy || !ready || closing.current) return;
    setBusy(true);
    try {
      void Taro.vibrateShort({ type: "medium" }).catch(() => undefined);
      const path = await take("original").catch(() => take("high"));
      const r = await confirmPhoto(path);
      if (r) {
        shotsRef.current = [...shotsRef.current, { path, turns: r.turns }];
        setShots(shotsRef.current);
        // 只拍一张的：确认完就走。确认页刚开始退出，等它退完再关这一页
        if (single) setTimeout(close, 350);
      }
    } catch {
      void Taro.showToast({ title: "没拍成，再按一次", icon: "none" });
    } finally {
      setBusy(false);
    }
  };

  const onError = () => {
    failed.current = true;
    if (shotsRef.current.length) void Taro.showToast({ title: "相机出了点问题", icon: "none" });
    else close();
  };

  /** 换一个新的 <camera>，重新等它就绪 */
  const rebuild = () => {
    setReady(false);
    setCamKey((k) => k + 1);
  };

  // 相机在前台被系统停掉（被别的应用占用等）：画面会停住或变黑，重建一个
  const visibleRef = useRef(true);
  const onStop = () => {
    if (visibleRef.current) rebuild();
  };
  // 不在前台（去确认页、切后台）就把 <camera> 拆掉；回来等旧的放干净再建新的。第一次进来也会走 show，那时相机本来就挂着，不动
  const remountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDidShow(() => {
    visibleRef.current = true;
    setVisible(true);
    if (mountedRef.current) return;
    if (remountTimer.current) clearTimeout(remountTimer.current);
    remountTimer.current = setTimeout(() => {
      remountTimer.current = null;
      if (!visibleRef.current) return;
      mountedRef.current = true;
      setMounted(true);
      rebuild();
    }, REMOUNT_DELAY);
  });
  useDidHide(() => {
    visibleRef.current = false;
    setVisible(false);
    if (remountTimer.current) clearTimeout(remountTimer.current);
    remountTimer.current = null;
    mountedRef.current = false;
    setMounted(false);
    setReady(false);
    setTorch(false);
  });

  // 页面在前台、相机却迟迟不就绪也不报错：不让人对着黑屏干等。还没拍的退回微信自带的拍照界面，拍过的把已拍的交回去
  useEffect(() => {
    if (ready || !visible || !mounted) return;
    const t = setTimeout(() => {
      if (closing.current) return;
      failed.current = true;
      if (shotsRef.current.length) void Taro.showToast({ title: "相机没起来，先用拍好的这几张", icon: "none" });
      close();
    }, INIT_TIMEOUT);
    return () => clearTimeout(t);
  }, [ready, visible, mounted, camKey]);

  // 取景：宽度占满，高度按 3:4；屏幕矮放不下时压矮一点
  const topH = mb.bottom + 8;
  const safeBottom = sys.safeArea ? Math.max(0, sys.screenHeight - sys.safeArea.bottom) : 0;
  const camW = sys.windowWidth;
  const camH = Math.round(Math.min((camW * 4) / 3, sys.windowHeight - topH - BOTTOM_H - safeBottom));
  const n = shots.length;
  const last = shots[n - 1];

  const bar = (left: number | null, top: number | null, w: number, h: number) => ({
    position: "absolute" as const,
    width: `${w}px`,
    height: `${h}px`,
    background: "#ffffff",
    borderRadius: "2px",
    ...(left === null ? { right: `${FRAME_INSET}px` } : { left: `${left}px` }),
    ...(top === null ? { bottom: `${FRAME_INSET}px` } : { top: `${top}px` }),
  });

  return (
    <View className="cam" catchMove>
      <View className="cam__top" style={{ height: `${topH}px`, paddingTop: `${mb.top}px` }}>
        <View className="cam__btn" style={{ width: `${mb.height + 8}px`, height: `${mb.height}px` }} hoverClass="cam__btn--hover" onClick={close}>
          <Icon name="xmark" size={24} color="#ffffff" stroke={2.2} />
        </View>
        <View className={`cam__torch${torch ? " cam__torch--on" : ""}`} style={{ height: `${mb.height}px` }} onClick={() => setTorch(!torch)}>
          <Icon name="sun" size={16} color={torch ? "#000000" : "#ffffff"} stroke={2.2} />
          <Text>补光</Text>
        </View>
      </View>

      <View className="cam__view" style={{ width: `${camW}px`, height: `${camH}px` }}>
        {mounted && (
        <Camera
          key={camKey}
          className="cam__camera"
          style={{ width: `${camW}px`, height: `${camH}px` }}
          mode="normal"
          devicePosition="back"
          resolution="high"
          flash={torch ? "torch" : "off"}
          onInitDone={() => setReady(true)}
          onStop={onStop}
          onError={onError}
        >
          {/* 对齐框：四个角，每个角一横一竖 */}
          <CoverView style={bar(FRAME_INSET, FRAME_INSET, CORNER_LEN, CORNER_W)} />
          <CoverView style={bar(FRAME_INSET, FRAME_INSET, CORNER_W, CORNER_LEN)} />
          <CoverView style={bar(null, FRAME_INSET, CORNER_LEN, CORNER_W)} />
          <CoverView style={bar(null, FRAME_INSET, CORNER_W, CORNER_LEN)} />
          <CoverView style={bar(FRAME_INSET, null, CORNER_LEN, CORNER_W)} />
          <CoverView style={bar(FRAME_INSET, null, CORNER_W, CORNER_LEN)} />
          <CoverView style={bar(null, null, CORNER_LEN, CORNER_W)} />
          <CoverView style={bar(null, null, CORNER_W, CORNER_LEN)} />
          <CoverView className="cam__hint" style={{ left: `${Math.round((camW - HINT_W) / 2)}px`, top: `${FRAME_INSET + 14}px`, width: `${HINT_W}px` }}>
            把试卷放进框里，四个角都拍到
          </CoverView>
        </Camera>
        )}
      </View>

      <View className="cam__bottom" style={{ paddingBottom: `${safeBottom}px` }}>
        <View className="cam__side">
          {last && (
            <View className="cam__thumb">
              <Image className="cam__thumb-img" src={last.path} mode="aspectFill" style={{ transform: `rotate(${last.turns * 90}deg)` }} />
              <Text className="cam__badge">{n}</Text>
            </View>
          )}
        </View>
        <View className={`cam__shutter${busy || !ready ? " cam__shutter--busy" : ""}`} hoverClass="cam__shutter--hover" onClick={() => void shoot()}>
          <View className="cam__shutter-in" />
        </View>
        <View className="cam__side">
          {!single && n > 0 && (
            <View className="cam__done" hoverClass="cam__done--hover" onClick={close}>
              <Text>完成</Text>
              <Text className="cam__done-n">{n}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
