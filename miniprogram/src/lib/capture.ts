/** 拍照 / 相册选图 → 存进本机 → 建试卷 → 提交扫描。相册多选时一张照片一张试卷（和 App 一致）。 */
import Taro from "@tarojs/taro";
import { errorText } from "./api";
import { addPaper, deleteFolder, deletePaper, getFolder, listFolders, savePhoto, updatePaper, type FolderPage } from "./store";
import { findPhotoMatches } from "./dedup";
import { submitScan } from "./jobs";
import { removeFigures } from "./figures";

export type Source = "camera" | "album";

async function choose(source: Source, count: number): Promise<string[]> {
  try {
    const res = await Taro.chooseMedia({ count, mediaType: ["image"], sourceType: [source], sizeType: ["original"], camera: "back" });
    return res.tempFiles.map((f) => f.tempFilePath);
  } catch (e) {
    const msg = String((e as { errMsg?: string }).errMsg || "");
    if (/cancel/i.test(msg)) return [];
    if (/auth|deny|permission/i.test(msg)) {
      const r = await Taro.showModal({ title: "需要相机 / 相册权限", content: "去设置里打开权限后再试。", confirmText: "去设置" });
      if (r.confirm) void Taro.openSetting();
      return [];
    }
    throw e;
  }
}

/** 提交扫描；失败把原因记在试卷上，让用户点开重扫 */
async function scan(folderId: string, paperId: string, pages: FolderPage[]) {
  try {
    await submitScan(folderId, paperId, pages);
  } catch (e) {
    updatePaper(folderId, paperId, { scanError: errorText(e) });
    Taro.eventCenter.trigger("jobs");
  }
}

/** 往文件夹里加试卷并开始扫描；返回文件夹 id（没有文件夹时会新建） */
export async function captureInto(folderId: string | null, source: Source): Promise<string | null> {
  const paths = await choose(source, source === "camera" ? 1 : 9);
  if (paths.length === 0) return null;
  Taro.showLoading({ title: paths.length > 1 ? `上传 ${paths.length} 张…` : "上传中…", mask: true });
  let fid = folderId;
  try {
    const created: { paperId: string; pages: FolderPage[] }[] = [];
    for (const p of paths) {
      const page = await savePhoto(p);
      const { folder, paper } = addPaper(fid, [page]);
      fid = folder.id;
      created.push({ paperId: paper.id, pages: [page] });
    }
    // 之前导入过的照片：问一下要不要再扫一次（再扫要等几十秒，结果也一样）
    const matches = findPhotoMatches(listFolders(), created.flatMap((c) => c.pages), created.map((c) => c.paperId));
    const dupPapers = created.filter((c) => c.pages.every((pg) => matches.has(pg.id)));
    let todo = created;
    if (dupPapers.length) {
      const first = [...matches.values()][0];
      Taro.hideLoading();
      const r = await Taro.showModal({
        title: dupPapers.length === created.length && created.length === 1 ? "这张照片之前导入过" : `有 ${dupPapers.length} 张照片之前导入过`,
        content: `在「${first.folderName}」的「${first.paperName}」里。再扫一次结果也一样。`,
        confirmText: "跳过",
        cancelText: "仍然扫描",
      });
      if (r.confirm) {
        for (const c of dupPapers) deletePaper(fid!, c.paperId);
        todo = created.filter((c) => !dupPapers.includes(c));
        // 刚为这几张新建的文件夹空了：删掉，带用户去原来那份所在的文件夹
        if (!folderId && !getFolder(fid!)?.papers.length) {
          deleteFolder(fid!);
          fid = first.folderId;
        }
      }
      if (todo.length) Taro.showLoading({ title: "上传中…", mask: true });
    }
    Taro.eventCenter.trigger("jobs");
    for (const c of todo) await scan(fid!, c.paperId, c.pages);
  } finally {
    Taro.hideLoading();
  }
  return fid;
}

/** 重拍：用新选的照片（可多张，作为同一张试卷的几页）替换原照片并重新扫描 */
export async function retake(folderId: string, paperId: string, source: Source): Promise<boolean> {
  const paths = await choose(source, source === "camera" ? 1 : 9);
  if (paths.length === 0) return false;
  Taro.showLoading({ title: "上传中…", mask: true });
  try {
    const old = getFolder(folderId)?.papers.find((p) => p.id === paperId);
    const pages: FolderPage[] = [];
    for (const p of paths) pages.push(await savePhoto(p));
    const fs = Taro.getFileSystemManager();
    old?.pages.forEach((pg) => {
      try {
        fs.unlinkSync(pg.src);
      } catch {
        /* ignore */
      }
    });
    removeFigures(paperId);
    updatePaper(folderId, paperId, { pages, digitized: undefined, scannedAt: undefined, gradedAt: undefined, scanError: undefined });
    await scan(folderId, paperId, pages);
  } finally {
    Taro.hideLoading();
  }
  return true;
}
