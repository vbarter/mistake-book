import { create } from "zustand";
import type { DigitizedResult, RecognizedItem } from "../api/types";
import type { Box } from "../lib/boxes";

export interface CapturePage {
  id: string;
  src: string; // dataURL
  width: number;
  height: number;
  boxes: Box[];
}

interface CaptureState {
  folderId: string | null;
  folderName: string;
  pages: CapturePage[];
  digitized: DigitizedResult | null;
  items: RecognizedItem[];
  returnTo: string;
  setReturnTo: (path: string) => void;
  setFolder: (id: string | null, name: string, pages: CapturePage[], digitized?: DigitizedResult | null) => void;
  setFolderName: (name: string) => void;
  setDigitized: (result: DigitizedResult | null) => void;
  addPage: (page: CapturePage) => void;
  removePage: (id: string) => void;
  setBoxes: (pageId: string, boxes: Box[]) => void;
  setItems: (items: RecognizedItem[]) => void;
  updateItem: (index: number, patch: Partial<RecognizedItem>) => void;
  removeItem: (index: number) => void;
  reset: () => void;
}

export const useCapture = create<CaptureState>((set) => ({
  folderId: null,
  folderName: "",
  pages: [],
  digitized: null,
  items: [],
  returnTo: "/today",
  setReturnTo: (path) => set({ returnTo: path }),
  setFolder: (id, name, pages, digitized = null) => set({ folderId: id, folderName: name, pages, digitized }),
  setFolderName: (name) => set({ folderName: name }),
  setDigitized: (result) => set({ digitized: result }),
  // 页面增减后电子版不再与页面对应，需重新扫描
  addPage: (page) => set((s) => ({ pages: [...s.pages, page], digitized: null })),
  removePage: (id) => set((s) => ({ pages: s.pages.filter((p) => p.id !== id), digitized: null })),
  setBoxes: (pageId, boxes) => set((s) => ({ pages: s.pages.map((p) => (p.id === pageId ? { ...p, boxes } : p)) })),
  setItems: (items) => set({ items }),
  updateItem: (index, patch) => set((s) => ({ items: s.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })),
  removeItem: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
  reset: () => set({ folderId: null, folderName: "", pages: [], digitized: null, items: [] }),
}));

export const totalBoxes = (pages: CapturePage[]) => pages.reduce((n, p) => n + p.boxes.length, 0);
export const MAX_BOXES = 6;
export const MAX_PAGES = 4;
