import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { autoTargetFolder } from "../lib/folders";
import { pickImages } from "../lib/native";
import { toastError } from "../store/banner";
import { useCapture } from "../store/capture";
import { useImport } from "../store/importer";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui";

/**
 * 唯一的录入入口：拍照（一页一页拍）或从相册一次选多张（进批量导入页）。
 * 不先问放哪个文件夹：传了 folderId 就放进去，没传就放进今天的文件夹（今天还没有就自动新建）。
 */
export function useAddPaper(folderId?: string) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { reset, setReturnTo } = useCapture();
  const setImport = useImport((s) => s.set);
  const [open, setOpen] = useState(false);

  const target = async () => folderId ?? (await autoTargetFolder())?.id ?? null;

  const camera = async () => {
    setOpen(false);
    const f = await target();
    reset();
    setReturnTo(pathname);
    nav("/capture", { state: { folderId: f, source: "camera" } });
  };

  const photos = async () => {
    setOpen(false);
    try {
      const list = await pickImages(0);
      if (!list.length) return;
      setImport(list, await target(), pathname);
      nav("/import");
    } catch (e) {
      toastError((e as Error).message === "permission_denied" ? new Error("需要相册权限，可以在系统设置里打开") : e);
    }
  };

  const sample = async () => {
    setOpen(false);
    const f = await target();
    reset();
    setReturnTo(pathname);
    nav("/capture", { state: { folderId: f, source: "sample" } });
  };

  const sheet = (
    <Sheet open={open} onClose={() => setOpen(false)} title="添加试卷">
      <div className="add-grid">
        <AddTile icon="camera" title="拍照" sub="一页一页拍，拍完自动识别" onClick={camera} />
        <AddTile icon="photo" title="相册导入" sub="一次选多张，自动排目录" onClick={photos} />
      </div>
      <button className="t-sub" style={{ color: "var(--brand)", minHeight: 40 }} onClick={sample}>没有试卷？用示例试卷试试</button>
    </Sheet>
  );

  return { open: () => setOpen(true), camera, photos, sheet };
}

function AddTile({ icon, title, sub, onClick }: { icon: IconName; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="add-tile" onClick={onClick}>
      <span className="add-tile__icon"><Icon name={icon} size={28} stroke={2} /></span>
      <span className="t-headline">{title}</span>
      <span className="t-cap c-sec">{sub}</span>
    </button>
  );
}
