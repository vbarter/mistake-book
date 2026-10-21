import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, Empty, InlineNav, Sheet } from "../../components/ui";
import { autoSegment } from "../../lib/boxes";
import { isNative, loadImage, pickImage } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useCapture } from "../../store/capture";

/** 录题第 0 步：拍摄 / 选图，可多页；每页自动分段后进入框选。 */
export default function Capture() {
  const nav = useNavigate();
  const loc = useLocation();
  const { pages, addPage, removePage, reset, returnTo } = useCapture();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const autoStarted = useRef(false);

  const pick = async (source: "camera" | "photos" | "sample") => {
    setBusy(true);
    try {
      const src = source === "sample" ? `${import.meta.env.BASE_URL}sample-paper.svg` : await pickImage(source);
      if (!src) return;
      const img = await loadImage(src);
      const boxes = await autoSegment(src, 6);
      addPage({ id: `p${Date.now()}`, src, width: img.naturalWidth, height: img.naturalHeight, boxes });
      if (boxes.length === 0) toast("没找到题目分段，请手动框选");
    } catch (e) {
      if ((e as Error).message === "permission_denied") setDenied(true);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // 从今天页点「拍照 / 从相册选」直接进入时，自动打开一次
  useEffect(() => {
    const state = loc.state as { source?: "camera" | "photos"; first?: boolean } | null;
    if (!autoStarted.current && pages.length === 0 && state && (state.source || (state.first && isNative))) {
      autoStarted.current = true;
      void pick(state.source ?? "camera");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    nav(returnTo, { replace: true });
    reset();
  };

  return (
    <div className="screen">
      <InlineNav
        title="拍摄试卷"
        subtitle={pages.length ? `已拍 ${pages.length} 页` : "可以拍多页"}
        right={<button className="nav-btn" onClick={() => (pages.length ? setConfirmLeave(true) : leave())}>取消</button>}
      />
      <div className="screen__content screen__content--modal" style={{ gap: 16 }}>
        {denied ? (
          <Empty
            icon="camera"
            title="需要使用相机"
            text="拍试卷需要相机权限，可以在系统设置里打开。也可以先从相册选图。"
            action={<Button size="sm" variant="tinted" onClick={() => pick("photos")}>从相册选</Button>}
          />
        ) : pages.length === 0 ? (
          <Empty
            icon="camera"
            title="把试卷平放，对准整页拍"
            text="光线均匀、避免阴影；拍完会自动把题目分段，再由你确认哪些是错题。"
            action={<Button size="xs" variant="plain" onClick={() => pick("sample")} disabled={busy}>没有试卷？用示例试卷试试</Button>}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {pages.map((p, i) => (
              <div key={p.id} className="card" style={{ padding: 8, gap: 6, position: "relative" }}>
                <img src={p.src} alt={`第 ${i + 1} 页`} style={{ width: "100%", aspectRatio: `${p.width} / ${p.height}`, objectFit: "cover", borderRadius: 8, maxHeight: 220 }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="t-foot c-sec">第 {i + 1} 页 · 分出 {p.boxes.length} 块</span>
                  <button className="icon-btn" style={{ width: 32, height: 32, color: "var(--wrong)" }} aria-label="删除这页" onClick={() => removePage(p.id)}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="tinted" icon="camera" onClick={() => pick("camera")} disabled={busy} style={{ flex: 1 }}>{pages.length ? "再拍一页" : "拍照"}</Button>
            <Button variant="tinted" icon="photo" onClick={() => pick("photos")} disabled={busy} style={{ flex: 1 }}>从相册选</Button>
          </div>
          <Button onClick={() => nav("/capture/crop")} disabled={pages.length === 0 || busy}>
            {busy ? "处理中…" : "下一步：框选错题"}
          </Button>
        </div>
      </div>
      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="放弃这次录题？">
        <p className="t-sub c-sec">已拍的 {pages.length} 页会被丢弃。</p>
        <Button variant="danger" onClick={leave}>丢弃并退出</Button>
        <Button variant="plain" onClick={() => setConfirmLeave(false)}>继续录题</Button>
      </Sheet>
    </div>
  );
}
