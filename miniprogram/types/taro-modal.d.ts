import "@tarojs/taro";

/** 基础库 2.17 起 wx.showModal 支持输入框，Taro 的类型还没有 */
declare module "@tarojs/taro" {
  namespace showModal {
    interface Option {
      editable?: boolean;
      placeholderText?: string;
    }
    interface SuccessCallbackResult {
      content?: string;
    }
  }
}

export {};
