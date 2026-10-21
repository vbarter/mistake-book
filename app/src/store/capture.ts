import { create } from "zustand";
import type { RecognizedItem } from "../api/types";
import type { Box } from "../lib/boxes";

export interface CapturePage {
  id: string;
  src: string; // dataURL
  width: number;
  height: number;
  boxes: Box[];
}

interface CaptureState {
  pages: CapturePage[];
  items: RecognizedItem[];
  returnTo: string;
  setReturnTo: (path: string) => void;
  addPage: (page: CapturePage) => void;
  removePage: (id: string) => void;
  setBoxes: (pageId: string, boxes: Box[]) => void;
  setItems: (items: RecognizedItem[]) => void;
  updateItem: (index: number, patch: Partial<RecognizedItem>) => void;
  removeItem: (index: number) => void;
  reset: () => void;
}

export const useCapture = create<CaptureState>((set) => ({
  pages: [],
  items: [],
  returnTo: "/today",
  setReturnTo: (path) => set({ returnTo: path }),
  addPage: (page) => set((s) => ({ pages: [...s.pages, page] })),
  removePage: (id) => set((s) => ({ pages: s.pages.filter((p) => p.id !== id) })),
  setBoxes: (pageId, boxes) => set((s) => ({ pages: s.pages.map((p) => (p.id === pageId ? { ...p, boxes } : p)) })),
  setItems: (items) => set({ items }),
  updateItem: (index, patch) => set((s) => ({ items: s.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })),
  removeItem: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
  reset: () => set({ pages: [], items: [] }),
}));

export const totalBoxes = (pages: CapturePage[]) => pages.reduce((n, p) => n + p.boxes.length, 0);
export const MAX_BOXES = 6;
