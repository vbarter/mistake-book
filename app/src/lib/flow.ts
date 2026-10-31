import type { NavigateFunction } from "react-router-dom";

/**
 * 录入流程（拍照 / 批量导入）结束时回到文件夹。
 * 来时的页面就是这个文件夹（或其中的试卷），直接退回去，不在栈里再叠一层同样的页面，返回键才不会一层层退不完；
 * 否则用文件夹页替换掉当前页。
 */
export function finishFlow(nav: NavigateFunction, from: string | null | undefined, to: string) {
  const canBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  if (canBack && from && (from === to || from.startsWith(`${to}/`))) nav(-1);
  else nav(to, { replace: true });
}
