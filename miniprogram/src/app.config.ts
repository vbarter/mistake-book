export default defineAppConfig({
  pages: ["pages/papers/index", "pages/library/index", "pages/profile/index", "pages/login/index", "pages/folder/index", "pages/paper/index"],
  window: {
    backgroundTextStyle: "dark",
    navigationBarBackgroundColor: "#f2f2f7",
    navigationBarTitleText: "知错本",
    navigationBarTextStyle: "black",
    backgroundColor: "#f2f2f7",
  },
  tabBar: {
    color: "#8e8e93",
    selectedColor: "#2f6fed",
    backgroundColor: "#ffffff",
    borderStyle: "black",
    list: [
      { pagePath: "pages/papers/index", text: "试卷", iconPath: "assets/tab/papers.png", selectedIconPath: "assets/tab/papers-on.png" },
      { pagePath: "pages/library/index", text: "错题库", iconPath: "assets/tab/library.png", selectedIconPath: "assets/tab/library-on.png" },
      { pagePath: "pages/profile/index", text: "我的", iconPath: "assets/tab/profile.png", selectedIconPath: "assets/tab/profile-on.png" },
    ],
  },
  // 上传整页试卷、等大模型批改都比较久
  networkTimeout: { request: 600000, uploadFile: 600000, downloadFile: 120000 },
  lazyCodeLoading: "requiredComponents",
});
