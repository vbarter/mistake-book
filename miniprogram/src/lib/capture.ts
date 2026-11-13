/** 拍照 / 相册选图 → 存进本机 → 建试卷 → 提交扫描。相册多选时一张照片一张试卷（和 App 一致）。 */
import Taro from "@tarojs/taro";
import { errorText } from "./api";
import { ensureLogin } from "./auth";
import { addPaper, autoTargetFolderId, deleteFolder, deletePaper, getFolder, listFolders, savePhoto, updatePaper, type FolderPage } from "./store";
import { openCamera } from "./camera";
import { confirmPhoto } from "./confirm";
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
    // 这几种失败看起来都像「没权限」，但原因和解决办法完全不同，分开说，并带上微信的原话方便排查：
    // 1) 后台隐私保护指引没声明（errno 112，not declared）：用户做什么都没用，直接说明
    if (/not declared|privacy api banned/i.test(msg)) {
      void Taro.showModal({ title: "暂时用不了", content: errorText(e), showCancel: false });
      return [];
    }
    // 2) 用户没同意微信弹出的隐私保护指引（errno 103 / 104）：小程序「设置」里没有这个开关，去了也没用。
    //    再点一次会重新弹（距上次拒绝不足 10 秒不弹）
    if (/privacy/i.test(msg) || [103, 104].includes(Number((e as { errno?: number }).errno))) {
      void Taro.showModal({ title: "需要先同意隐私保护指引", content: `稍等几秒再点一次，在微信弹出的窗口里选「同意」就能用了。\n（${msg}）`, showCancel: false });
      return [];
    }
    // 3) 手机系统没让微信用相机 / 相册：要去手机的系统设置里开，小程序「设置」里也没有
    if (/system permission/i.test(msg)) {
      void Taro.showModal({ title: "微信没有相机 / 相册权限", content: `请在手机的系统设置里，允许微信使用相机和照片。\n（${msg}）`, showCancel: false });
      return [];
    }
    // 4) 在小程序里拒绝过授权：去小程序「设置」里打开
    if (/auth|deny|permission/i.test(msg)) {
      const r = await Taro.showModal({ title: "需要相机 / 相册权限", content: `去设置里打开权限后再试。\n（${msg}）`, confirmText: "去设置" });
      if (r.confirm) void Taro.openSetting();
      return [];
    }
    throw new Error(errorText(e)); // 微信抛的是 { errMsg } 对象，调用方直接 toast 会变成 [object Object]
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

/**
 * 拍照是连拍（和 App 一样）：在自己的拍照页（pages/camera，带对齐框、拍原图）里一张张拍，每张拍完先全屏确认
 * （上滑用这张 / 下滑重拍，可以左右转），点「完成」才停。返回转正后的临时文件。
 * single = 只拍一张。拍照页用不了时退回微信自带的拍照界面。
 */
async function shootSeries(single = false): Promise<string[]> {
  const taken = await openCamera(single);
  if (!taken) return shootSeriesSystem(single);
  const shots: string[] = [];
  for (const s of taken) shots.push(s.turns % 4 ? await rotateToTemp(s.path, s.turns) : s.path);
  return shots;
}

/** 退路：微信自带的拍照界面（没有对齐框），每张拍完确认，在相机里点取消才停 */
async function shootSeriesSystem(single: boolean): Promise<string[]> {
  const shots: string[] = [];
  for (;;) {
    const [path] = await choose("camera", 1);
    if (!path) break;
    const r = await confirmPhoto(path);
    if (!r) continue; // 不要这张：再拍一张
    shots.push(r.turns % 4 ? await rotateToTemp(path, r.turns) : path);
    if (single) break;
  }
  return shots;
}

/** 只选照片、不建试卷（学习计划里老师扫描作业、学生拍做完的作业用）：拍照是连拍 + 逐张确认，相册一次最多 9 张 */
export async function pickPhotos(source: Source): Promise<string[]> {
  return source === "camera" ? shootSeries() : choose("album", 9);
}

/**
 * 加试卷（唯一的录入入口）：拍照（连拍）或从相册一次选多张 → 存进本机 → 建试卷 → 提交扫描。
 * 不先问放哪个文件夹：传了 folderId 就放进去，没传就放进今天的文件夹（今天还没有就自动新建），和 App 一致。
 * 连拍了几张时问一句是同一份试卷的几页、还是每张一份；相册多选一张照片一张试卷。返回文件夹 id。
 */
export async function captureInto(folderId: string | null, source: Source): Promise<string | null> {
  if (!(await ensureLogin("扫描试卷"))) return null;
  const paths = source === "camera" ? await shootSeries() : await choose("album", 9);
  if (paths.length === 0) return null;
  let together = false;
  if (source === "camera" && paths.length > 1) {
    const r = await Taro.showModal({ title: `拍了 ${paths.length} 张`, content: "是同一份试卷的几页，还是每张各是一份？", confirmText: "同一份", cancelText: "每张一份" });
    together = r.confirm;
  }
  Taro.showLoading({ title: paths.length > 1 ? `上传 ${paths.length} 张…` : "上传中…", mask: true });
  let fid = folderId ?? autoTargetFolderId();
  const autoFolder = !folderId;
  try {
    const saved: FolderPage[] = [];
    for (const p of paths) saved.push(await savePhoto(p));
    // 转正时写的临时文件：已经存进用户目录了，删掉
    const fs = Taro.getFileSystemManager();
    for (const p of paths.filter((x) => x.includes("/rotate_"))) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    const groups = together ? [saved] : saved.map((pg) => [pg]);
    const created: { paperId: string; pages: FolderPage[] }[] = [];
    for (const pages of groups) {
      const { folder, paper } = addPaper(fid, pages);
      fid = folder.id;
      created.push({ paperId: paper.id, pages });
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
        if (autoFolder && !getFolder(fid!)?.papers.length) {
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
  if (!(await ensureLogin("重新扫描"))) return false;
  const paths = source === "camera" ? await shootSeries(true) : await choose("album", 9);
  if (paths.length === 0) return false;
  Taro.showLoading({ title: "上传中…", mask: true });
  try {
    const old = getFolder(folderId)?.papers.find((p) => p.id === paperId);
    const pages: FolderPage[] = [];
    for (const p of paths) pages.push(await savePhoto(p));
    const fs = Taro.getFileSystemManager();
    // 转正时写的临时文件：已经存进用户目录了，删掉
    for (const p of paths.filter((x) => x.includes("/rotate_"))) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
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

/** 再扫一次：照片不动，原样重新提交（服务器忙、网络断了这类失败，不用重拍） */
export async function rescan(folderId: string, paperId: string): Promise<boolean> {
  if (!(await ensureLogin("重新扫描"))) return false;
  const paper = getFolder(folderId)?.papers.find((p) => p.id === paperId);
  if (!paper?.pages.length) return false;
  Taro.showLoading({ title: "上传中…", mask: true });
  try {
    updatePaper(folderId, paperId, { scanError: undefined });
    await scan(folderId, paperId, paper.pages);
  } finally {
    Taro.hideLoading();
  }
  return true;
}

/** 照片转向后存的最长边：和 App 一致，离屏画布太大有的手机画不出来 */
const ROTATE_MAX_SIDE = 2400;

type RotateCanvas = {
  getContext: (t: "2d") => { fillStyle: string; fillRect: (...a: number[]) => void; translate: (x: number, y: number) => void; rotate: (r: number) => void; drawImage: (...a: unknown[]) => void };
  createImage: () => { src: string; onload: () => void; onerror: (e: unknown) => void };
  toDataURL: (type: string, q: number) => string;
};

/** 把一张照片顺时针转 turns 个 90°，写成临时文件，返回路径（调用方存好后自己删） */
export async function rotateToTemp(src: string, turns: number): Promise<string> {
  const t = ((turns % 4) + 4) % 4;
  const info = await Taro.getImageInfo({ src });
  const scale = Math.min(1, ROTATE_MAX_SIDE / Math.max(info.width, info.height));
  const w = Math.round(info.width * scale);
  const h = Math.round(info.height * scale);
  const cw = t % 2 ? h : w;
  const ch = t % 2 ? w : h;
  const canvas = Taro.createOffscreenCanvas({ type: "2d", width: cw, height: ch }) as unknown as RotateCanvas;
  const img = canvas.createImage();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  const b64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  if (!b64) throw new Error("这台手机转不了照片，可以点「重新扫描 / 改照片」重拍一张");
  const tmp = `${Taro.env.USER_DATA_PATH}/rotate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
  Taro.getFileSystemManager().writeFileSync(tmp, b64, "base64");
  return tmp;
}

/** 把一张照片顺时针转 turns 个 90°，存成新文件，返回新的照片记录 */
async function rotatePhoto(page: FolderPage, turns: number): Promise<FolderPage> {
  const tmp = await rotateToTemp(page.src, turns);
  try {
    return await savePhoto(tmp);
  } finally {
    try {
      Taro.getFileSystemManager().unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** 试卷照片横着 / 倒着拍的：每张都转 turns 个 90°（顺时针为正），替换原照片后重新扫描 */
export async function rotateAndRescan(folderId: string, paperId: string, turns: number): Promise<boolean> {
  if (!(await ensureLogin("重新扫描"))) return false;
  const old = getFolder(folderId)?.papers.find((p) => p.id === paperId);
  if (!old?.pages.length) return false;
  Taro.showLoading({ title: "转正中…", mask: true });
  try {
    const pages: FolderPage[] = [];
    for (const pg of old.pages) pages.push(await rotatePhoto(pg, turns));
    const fs = Taro.getFileSystemManager();
    old.pages.forEach((pg) => {
      try {
        fs.unlinkSync(pg.src);
      } catch {
        /* ignore */
      }
    });
    removeFigures(paperId);
    updatePaper(folderId, paperId, { pages, digitized: undefined, scannedAt: undefined, gradedAt: undefined, scanError: undefined });
    Taro.showLoading({ title: "上传中…", mask: true });
    await scan(folderId, paperId, pages);
    return true;
  } catch (e) {
    Taro.hideLoading();
    void Taro.showModal({ title: "没转成", content: errorText(e), showCancel: false });
    return false;
  } finally {
    Taro.hideLoading();
  }
}
