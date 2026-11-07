/// <reference lib="webworker" />
import { processPixels, type ProcessJob } from "./warp";

/** 后台拉正、提亮：拍下一张就丢过来，主线程不卡，可以马上拍下一张 */
self.onmessage = (e: MessageEvent<{ id: number; job: ProcessJob }>) => {
  const { id, job } = e.data;
  try {
    const out = processPixels(job);
    (self as unknown as Worker).postMessage({ id, out }, [out.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message || err) });
  }
};
