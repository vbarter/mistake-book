import { create } from "zustand";
import type { DigitizedResult } from "../api/types";

export interface CapturePage {
  id: string;
  src: string; // dataURL
  width: number;
  height: number;
}

/** 正在录入 / 查看的那张试卷（文件夹里的一张）。电子版与照片一一对应，照片增减后电子版作废。 */
interface CaptureState {
  folderId: string | null;
  paperId: string | null;
  paperName: string;
  pages: CapturePage[];
  digitized: DigitizedResult | null;
  returnTo: string;
  setReturnTo: (path: string) => void;
  setPaper: (folderId: string | null, paperId: string | null, name: string, pages: CapturePage[], digitized?: DigitizedResult | null) => void;
  setPaperName: (name: string) => void;
  setDigitized: (result: DigitizedResult | null) => void;
  addPage: (page: CapturePage) => void;
  removePage: (id: string) => void;
  reset: () => void;
}

export const useCapture = create<CaptureState>((set) => ({
  folderId: null,
  paperId: null,
  paperName: "",
  pages: [],
  digitized: null,
  returnTo: "/papers",
  setReturnTo: (path) => set({ returnTo: path }),
  setPaper: (folderId, paperId, name, pages, digitized = null) => set({ folderId, paperId, paperName: name, pages, digitized }),
  setPaperName: (name) => set({ paperName: name }),
  setDigitized: (result) => set({ digitized: result }),
  addPage: (page) => set((s) => ({ pages: [...s.pages, page], digitized: null })),
  removePage: (id) => set((s) => ({ pages: s.pages.filter((p) => p.id !== id), digitized: null })),
  reset: () => set({ folderId: null, paperId: null, paperName: "", pages: [], digitized: null }),
}));

export const MAX_PAGES = 4;
