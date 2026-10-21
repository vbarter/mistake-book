import { create } from "zustand";

export interface Banner {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

interface BannerState {
  banners: Banner[];
  show: (text: string, opts?: { kind?: Banner["kind"]; action?: Banner["action"]; duration?: number }) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useBanner = create<BannerState>((set, get) => ({
  banners: [],
  show(text, opts = {}) {
    const id = seq++;
    const banner: Banner = { id, text, kind: opts.kind ?? "info", action: opts.action };
    set((s) => ({ banners: [...s.banners.slice(-1), banner] }));
    setTimeout(() => get().dismiss(id), opts.duration ?? (opts.action ? 5000 : 2200));
  },
  dismiss(id) {
    set((s) => ({ banners: s.banners.filter((b) => b.id !== id) }));
  },
}));

export const toast = (text: string, kind: Banner["kind"] = "info") => useBanner.getState().show(text, { kind });
export const toastError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  useBanner.getState().show(msg || "出了点问题，请重试", { kind: "error", duration: 3000 });
};
