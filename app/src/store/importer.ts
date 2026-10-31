import { create } from "zustand";
import type { FullPage } from "../lib/folders";

/** 批量导入：相册里选好的照片（带原图和小图）先放这里，导入页整理好再建试卷、提交识别 */
interface ImportState {
  sources: FullPage[];
  folderId: string | null; // 放进哪个文件夹；null = 新建
  from: string; // 从哪个页面进来的，导入完能原路退回
  set: (sources: FullPage[], folderId: string | null, from: string) => void;
  remove: (index: number) => void;
  setFolder: (folderId: string | null) => void;
  clear: () => void;
}

export const useImport = create<ImportState>((set) => ({
  sources: [],
  folderId: null,
  from: "/home",
  set: (sources, folderId, from) => set({ sources, folderId, from }),
  remove: (index) => set((s) => ({ sources: s.sources.filter((_, i) => i !== index) })),
  setFolder: (folderId) => set({ folderId }),
  clear: () => set({ sources: [], folderId: null }),
}));
