/**
 * 首页小喇叭「没扫出来」的已读记录：点开看过的那次失败不再提醒，同一张卷子再失败一次会重新提醒。
 * 只记在本机（扫描失败本身也只在本机，不跟云同步走），和小程序的 lib/scanNotice.ts 一个做法。
 */
import type { Paper } from "./folders";

const KEY = "zcb.scanNoticeSeen";
const MAX = 200;

/** 一次失败的记号：失败时间；老数据没有时间，用失败原因顶替 */
const mark = (p: Paper) => p.scanErrorAt ?? p.scanError ?? "";

function read(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function isScanErrorSeen(p: Paper): boolean {
  return read()[p.id] === mark(p);
}

export function markScanErrorSeen(p: Paper) {
  const seen = read();
  delete seen[p.id];
  seen[p.id] = mark(p);
  // 只留最近的 MAX 条：删掉的试卷不用专门清理
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX))) delete seen[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* 存不下就算了，最多再提醒一次 */
  }
}
