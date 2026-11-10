import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Sheet } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { toPage, type FullPage } from "../../lib/folders";
import { pickImages, takePhoto } from "../../lib/native";
import type { PlanSubject } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { useAuth } from "../../store/auth";
import "../../styles/plans.css";

/** 学科方块：综合用中性色 */
export function PlanTile({ subject, size = "md" }: { subject: PlanSubject | null | undefined; size?: "lg" | "md" | "sm" | "xs" }) {
  return <SubjectTile subject={subject && subject !== "mixed" ? subject : null} size={size} />;
}

/** 扫描：拍照（可以连着拍）或从相册选，返回带原图的照片 */
export function useScanPick(onPages: (pages: FullPage[]) => void, title = "扫描") {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const fail = (e: unknown) => toastError((e as Error).message === "permission_denied" ? new Error("需要相机 / 相册权限，可以在系统设置里打开") : e);

  const camera = async () => {
    setOpen(false);
    try {
      const src = await takePhoto();
      if (!src) return;
      onPages([await toPage(src)]);
    } catch (e) {
      fail(e);
    }
  };
  const album = async () => {
    setOpen(false);
    try {
      const list = await pickImages(0);
      if (!list.length) return;
      setReading(true);
      const pages: FullPage[] = [];
      for (const src of list) pages.push(await toPage(src));
      onPages(pages);
    } catch (e) {
      fail(e);
    } finally {
      setReading(false);
    }
  };

  const sheet = (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="add-grid">
          <button className="add-tile" onClick={camera}>
            <span className="add-tile__icon"><Icon name="camera" size={28} stroke={2} /></span>
            <span className="t-headline">拍照</span>
            <span className="t-cap c-sec">一页一张，可以接着拍</span>
          </button>
          <button className="add-tile" onClick={album}>
            <span className="add-tile__icon"><Icon name="photo" size={28} stroke={2} /></span>
            <span className="t-headline">相册导入</span>
            <span className="t-cap c-sec">一次选多张</span>
          </button>
        </div>
      </Sheet>
      {reading && <Busy text="正在读取照片" />}
    </>
  );
  return { open: () => setOpen(true), sheet };
}

export function Busy({ text }: { text: string }) {
  return (
    <div className="hud" role="dialog" aria-live="polite">
      <div className="hud__card"><span className="spinner-ring" /><span className="t-sub">{text}</span></div>
    </div>
  );
}

/**
 * 起名字 / 改名字。改的是账号的称呼，所有学习计划里老师看到的名字跟着变。
 * required：刚注册的新用户加入计划前必须先起名字，不能关掉。
 */
export function NameSheet({ open, required, onClose, onDone }: { open: boolean; required?: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const { user, updateProfile } = useAuth();
  const current = user?.nickname && user.nickname !== "小同学" ? user.nickname : "";
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(current); }, [open, current]);
  const save = async () => {
    const value = name.trim();
    if (!value) return toast("写上你的名字，老师才知道是谁交的作业");
    setBusy(true);
    try {
      await updateProfile({ nickname: value });
      onDone(value);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={required ? () => undefined : onClose} title={required ? "先告诉老师你是谁" : "改名字"}>
      <p className="t-sub c-sec">写真实姓名，老师看作业时认得出你。以后可以在「我的」里改，改了这里跟着变。</p>
      <input className="input" value={name} maxLength={16} placeholder="你的名字" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      <Button onClick={save} disabled={busy || !name.trim()}>{required ? "确定，加入学习计划" : "保存"}</Button>
    </Sheet>
  );
}

/** 二次确认 */
export function ConfirmSheet({ open, title, text, action, danger, onClose, onConfirm }: { open: boolean; title: string; text?: string; action: string; danger?: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {text && <p className="t-sub c-sec">{text}</p>}
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{action}</Button>
      <Button variant="plain" onClick={onClose}>取消</Button>
    </Sheet>
  );
}
