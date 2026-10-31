import { create } from "zustand";

/** 批量导入：相册里选好的照片（dataURL）先放这里，导入页整理好再建试卷、提交识别 */
interface ImportState {
  sources: string[];
  folderId: string | null; // 放进哪个文件夹；null = 新建
  set: (sources: string[], folderId: string | null) => void;
  remove: (index: number) => void;
  setFolder: (folderId: string | null) => void;
  clear: () => void;
}

export const useImport = create<ImportState>((set) => ({
  sources: [],
  folderId: null,
  set: (sources, folderId) => set({ sources, folderId }),
  remove: (index) => set((s) => ({ sources: s.sources.filter((_, i) => i !== index) })),
  setFolder: (folderId) => set({ folderId }),
  clear: () => set({ sources: [], folderId: null }),
}));
