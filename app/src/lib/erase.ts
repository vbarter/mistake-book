/**
 * 试卷一键擦除手写：一张一张把原照片发给服务器（POST /api/erase/page），擦好的照片另存一份在本机（folders.saveErased），
 * 原图不动，「恢复原图」就是删掉那一份。服务器不留照片。
 *
 * 擦除在这里跑而不是在页面里跑：中途离开预览页也会擦完，试卷卡片上的按钮据此显示进度。
 */
import { create } from "zustand";
import { api } from "../api/client";
import { loadPhoto, saveErased, type Paper } from "./folders";

interface Progress {
  done: number;
  total: number;
  current?: string; // 正在擦的照片 id
}

interface EraseState {
  running: Record<string, Progress>; // paperId → 进度
  warnings: Record<string, string>; // paperId → 最近一次擦除的提示（定位失败等）
  set: (paperId: string, p: Progress | null) => void;
}

export const useErasing = create<EraseState>((set) => ({
  running: {},
  warnings: {},
  set: (paperId, p) =>
    set((s) => {
      const running = { ...s.running };
      if (p) running[paperId] = p;
      else delete running[paperId];
      return { running };
    }),
}));

const inflight = new Map<string, Promise<void>>();

interface PageResult {
  image: string;
  marks: number;
  located: string[];
  warning?: string;
}

/**
 * 擦一张试卷的照片（pageIds 不传就是全部），每擦好一张就存下来并回调 onPage。
 * 同一张试卷已经在擦时返回正在跑的那一次。
 */
export function erasePaper(folderId: string, paper: Paper, opts: { pageIds?: string[]; onPage?: (pageId: string) => void } = {}): Promise<void> {
  const running = inflight.get(paper.id);
  if (running) return running;
  const pages = paper.pages.filter((pg) => !opts.pageIds || opts.pageIds.includes(pg.id));
  const store = useErasing.getState();
  const job = (async () => {
    let warning = "";
    try {
      for (const [i, pg] of pages.entries()) {
        store.set(paper.id, { done: i, total: pages.length, current: pg.id });
        const src = await loadPhoto(pg);
        if (!src) continue;
        const res = await api<PageResult>("/api/erase/page", { method: "POST", body: { image: src }, timeoutMs: 240000 });
        await saveErased(folderId, paper.id, pg.id, res.image);
        if (res.warning) warning = res.warning;
        opts.onPage?.(pg.id);
      }
    } finally {
      store.set(paper.id, null);
      useErasing.setState((s) => ({ warnings: { ...s.warnings, [paper.id]: warning } }));
      inflight.delete(paper.id);
    }
  })();
  inflight.set(paper.id, job);
  return job;
}

/** 这张试卷有没有擦过（至少一张照片） */
export const isErased = (paper: Paper) => paper.pages.some((pg) => pg.erased);

/** 每张照片都擦过了 */
export const isFullyErased = (paper: Paper) => paper.pages.length > 0 && paper.pages.every((pg) => pg.erased);
