/** 导出 PDF：服务器生成，写进本机后用系统预览打开，右上角可转发给微信好友 / 打印 / 存到手机 */
import Taro from "@tarojs/taro";
import { apiBinary, errorText } from "./api";
import { toBookItems, type ErrorItem } from "./errors";
import { formatDateTime } from "./format";
import { figureAt, figurePayload } from "./figures";
import { validDigitized } from "./logic";
import type { Paper } from "./store";

async function openPdf(buf: ArrayBuffer, filename: string) {
  const safe = filename.replace(/[\\/:*?"<>|\s]+/g, "_");
  const path = `${Taro.env.USER_DATA_PATH}/${safe}`;
  Taro.getFileSystemManager().writeFileSync(path, buf, "binary");
  await Taro.openDocument({ filePath: path, fileType: "pdf", showMenu: true });
}

/** 错题本：横向打印，左边空白重做、右边错题修正 */
export async function exportBook(title: string, subtitle: string | undefined, errors: ErrorItem[], withWrong: boolean, withBlank: boolean): Promise<void> {
  const chosen = errors.filter((e) => (e.kind === "未作答" ? withBlank : withWrong));
  const books = toBookItems(chosen);
  if (books.length === 0) {
    void Taro.showToast({ title: "这个范围里没有错题", icon: "none" });
    return;
  }
  const typeLabel = withWrong && withBlank ? "错题 + 未作答" : withBlank ? "只含未作答" : "只含错题";
  await run(async () => {
    // 插图从原照片裁好一起发给服务器排版
    const items = await Promise.all(books.map(async (b) => ({ ...b, figures: await Promise.all(b.figures.map(figurePayload)) })));
    const buf = await apiBinary("/api/digitize/book", { body: { title: `${title} 错题本`, subtitle: [subtitle, `${chosen.length} 题`, typeLabel].filter(Boolean).join(" · "), items } });
    await openPdf(buf, `${title} 错题本.pdf`);
  });
}

/** 原始电子试卷：干净原卷 + 作答对照表 */
export async function exportPapers(title: string, papers: Paper[]): Promise<void> {
  const scanned = papers.filter((p) => validDigitized(p.digitized));
  if (scanned.length === 0) {
    void Taro.showToast({ title: "还没有扫描过的试卷", icon: "none" });
    return;
  }
  await run(async () => {
    const papersBody = await Promise.all(
      scanned.map(async (p) => {
        const d = validDigitized(p.digitized)!;
        const pages = await Promise.all(
          d.pages.map(async (s, si) => ({
            ...s,
            blocks: await Promise.all(
              s.blocks.map(async (b, bi) => {
                const f = b.type === "figure" ? figureAt(p, si, bi) : null;
                return f ? { ...b, image: (await figurePayload(f)).image } : b;
              }),
            ),
          })),
        );
        return { title: `${title} · ${p.name}`, scannedAt: p.scannedAt ? formatDateTime(p.scannedAt) : "", pages, questions: d.questions };
      }),
    );
    const body = { title, papers: papersBody };
    const buf = await apiBinary("/api/digitize/pdf", { body });
    await openPdf(buf, `${title} 电子试卷.pdf`);
  });
}

async function run(fn: () => Promise<void>) {
  Taro.showLoading({ title: "生成 PDF…", mask: true });
  try {
    await fn();
    Taro.hideLoading();
  } catch (e) {
    Taro.hideLoading();
    void Taro.showModal({ title: "导出失败", content: errorText(e), showCancel: false });
  }
}
