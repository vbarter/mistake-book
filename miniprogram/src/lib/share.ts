import { useShareAppMessage, useShareTimeline } from "@tarojs/taro";

/**
 * 右上角菜单的"转发给朋友 / 分享到朋友圈"。
 * 微信要求页面实现 onShareAppMessage / onShareTimeline，否则两个按钮是灰的；
 * Taro 里还要在页面配置里打开 enableShareAppMessage / enableShareTimeline。
 *
 * 错题、试卷都只在本机，转发出去的链接一律落到首页，不带任何个人数据。
 */
export const SHARE_TITLE = "错误本：拍下试卷，自动整理错题";
const HOME = "/pages/home/index";

/** 转发给朋友：所有页面都调用 */
export function useShare() {
  useShareAppMessage(() => ({ title: SHARE_TITLE, path: HOME }));
}

/** 分享到朋友圈：只在 Tab 页调用（朋友圈打开的是当前页的"单页模式"，详情页单独打开没意义） */
export function useShareTimelineToo() {
  useShareTimeline(() => ({ title: SHARE_TITLE }));
}
