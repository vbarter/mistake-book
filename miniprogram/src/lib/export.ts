/**
 * 导出 PDF（和 App 一致）：错题本 / 电子试卷 / 原题空白卷交给服务器后台排版（POST /api/exports），
 * 不用守在导出面板上；生成好了弹窗提醒，「我的 › 我的导出」里 7 天内随时能再打开。
 * 打开 = 下载到本机后用系统预览，右上角可以转发给微信好友、打印或存到手机。
 * 服务器还没有后台导出时（404）退回老办法：当场生成、当场打开。
 */
import Taro from "@tarojs/taro";
import { ApiError, api, apiBinary, errorText } from "./api";
import { ensureLogin } from "./auth";
import { toBookItems, type ErrorItem } from "./errors";
import { formatDateTime } from "./format";
import { figureAt, figurePayload } from "./figures";
import { validDigitized } from "./logic";
import { setLastExportAt } from "./prefs";
import type { Paper } from "./store";

export interface ExportJob {
  id: string;
  kind: "book" | "paper" | "clean" | "blank";
  title: string;
  detail: string;
  status: "queued" | "running" | "done" | "failed";
  error: string;
  pages: number;
  size: number;
  createdAt: string;
}

export const isPending = (j: ExportJob) => j.status === "queued" || j.status === "running";

/** 导出列表有变化（提交、完成、删除）时通知「我的导出」页 */
export const EXPORTS_EVENT = "exports";

async function openPdf(buf: ArrayBuffer, filename: string) {
  const safe = filename.replace(/[\\/:*?"<>|\s]+/g, "_");
  const path = `${Taro.env.USER_DATA_PATH}/${safe}`;
  Taro.getFileSystemManager().writeFileSync(path, buf, "binary");
  await Taro.openDocument({ filePath: path, fileType: "pdf", showMenu: true });
}

/** 下载后的文件名：标题里的斜杠等不能做文件名的字符换掉 */
export function exportFilename(job: ExportJob): string {
  const name = (job.title || { book: "错题本", paper: "电子试卷", clean: "空白卷", blank: "空白卷" }[job.kind]).replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60);
  return `${name}${job.kind === "paper" && !name.includes("试卷") ? " 电子试卷" : ""}.pdf`;
}

/** 下载生成好的 PDF 并打开 */
export async function openExport(job: ExportJob): Promise<void> {
  Taro.showLoading({ title: "下载中…", mask: true });
  try {
    const buf = await apiBinary(`/api/exports/${job.id}/file`, { method: "GET", timeoutMs: 120000 });
    Taro.hideLoading();
    await openPdf(buf, exportFilename(job));
  } catch (e) {
    Taro.hideLoading();
    if (!/cancel/i.test(String((e as { errMsg?: string }).errMsg || (e as Error).message))) void Taro.showModal({ title: "打开失败", content: errorText(e), showCancel: false });
  }
}

export async function listExports(): Promise<ExportJob[]> {
  const { items } = await api<{ items: ExportJob[] }>("/api/exports");
  return items;
}

export async function removeExport(id: string): Promise<void> {
  await api(`/api/exports/${id}`, { method: "DELETE" });
  Taro.eventCenter.trigger(EXPORTS_EVENT);
}

// ---------------------------------------------------------------- 提交后等它生成好

const watching = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify(job: ExportJob) {
  if (job.status === "done") {
    void Taro.showModal({ title: `「${job.title}」已生成`, content: "可以转发给微信好友、打印或存到手机。「我的 › 我的导出」里 7 天内都能再打开。", confirmText: "打开", cancelText: "稍后" }).then((r) => {
      if (r.confirm) void openExport(job);
    });
  } else {
    void Taro.showModal({ title: "导出没有成功", content: job.error || "可以在「我的 › 我的导出」里看看，或者重新导出", showCancel: false });
  }
}

async function poll() {
  timer = null;
  if (!watching.size) return;
  try {
    const items = await listExports();
    for (const j of items) {
      if (watching.has(j.id) && !isPending(j)) {
        watching.delete(j.id);
        notify(j);
      }
    }
    // 列表里已经找不到的（被删了）不再等
    for (const id of [...watching]) if (!items.some((j) => j.id === id)) watching.delete(id);
    Taro.eventCenter.trigger(EXPORTS_EVENT);
  } catch {
    /* 网络问题，下一轮再问 */
  }
  if (watching.size) timer = setTimeout(poll, 2500);
}

/** 提交后台导出；服务器还是旧版本（没有 /exports）时返回 null */
export async function submitExport(body: Record<string, unknown>): Promise<ExportJob | null> {
  let job: ExportJob;
  try {
    job = await api<ExportJob>("/api/exports", { method: "POST", body, timeoutMs: 120000 });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
  Taro.eventCenter.trigger(EXPORTS_EVENT);
  if (isPending(job)) {
    watching.add(job.id);
    if (!timer) timer = setTimeout(poll, 2500);
  } else notify(job);
  return job;
}

// ---------------------------------------------------------------- 请求体

/** 错题本：已按知识点排好的题 + 从原照片裁好的插图 */
export async function bookBody(title: string, subtitle: string, chosen: ErrorItem[]) {
  const books = toBookItems(chosen);
  const items = await Promise.all(books.map(async (b) => ({ ...b, figures: await Promise.all(b.figures.map(figurePayload)) })));
  return { title: `${title} 错题本`, subtitle, items };
}

/** 电子试卷：扫描结果原样 + 插图 */
export async function paperBody(title: string, papers: Paper[]) {
  const scanned = papers.filter((p) => validDigitized(p.digitized));
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
  return { title, papers: papersBody };
}

/**
 * 导出：交给服务器后台生成，马上返回；服务器不支持后台导出时当场生成并打开。
 * 成功提交返回 true（调用方关面板）。
 */
export async function runExport(kind: "book" | "paper", build: () => Promise<Record<string, unknown>>, filename: string): Promise<boolean> {
  if (!(await ensureLogin("导出 PDF"))) return false;
  Taro.showLoading({ title: "正在提交…", mask: true });
  try {
    const body = await build();
    const job = await submitExport({ kind, ...body });
    if (job) {
      if (kind === "book") setLastExportAt();
      Taro.hideLoading();
      if (isPending(job)) void Taro.showToast({ title: "正在后台生成，好了会提醒你", icon: "none", duration: 2500 });
      return true;
    }
    // 老服务器：当场生成
    Taro.showLoading({ title: "生成 PDF…", mask: true });
    const buf = await apiBinary(kind === "book" ? "/api/digitize/book" : "/api/digitize/pdf", { body, timeoutMs: 180000 });
    if (kind === "book") setLastExportAt();
    Taro.hideLoading();
    await openPdf(buf, filename);
    return true;
  } catch (e) {
    Taro.hideLoading();
    void Taro.showModal({ title: "导出失败", content: errorText(e), showCancel: false });
    return false;
  }
}
