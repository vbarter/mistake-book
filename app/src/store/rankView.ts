import { create } from "zustand";

/** 从榜单点进详情页时带过去的那一串题：按榜单顺序，详情页左右滑在这些题之间切换 */
export interface RankEntry {
  key: string; // ErrorItem.key
  rank: number; // 在榜上的名次（知识点榜里同一知识点的几道题名次相同）
  score: number;
  group: string; // 知识点榜等按知识点分组时的知识点名；易错题榜为空
}

export const useRankView = create<{ title: string; entries: RankEntry[]; set: (title: string, entries: RankEntry[]) => void }>((set) => ({
  title: "",
  entries: [],
  set: (title, entries) => set({ title, entries }),
}));
