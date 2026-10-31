import { Component, type ReactNode } from "react";

/** 页面渲染出错时兜底：显示一句话和两个按钮，不让整个 App 白屏（白屏在手机上看起来就是闪退） */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[App] 页面出错", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen" style={{ justifyContent: "center", alignItems: "center", gap: 14, padding: 32, textAlign: "center", minHeight: "100vh", background: "var(--bg)" }}>
        <h2 className="t-title3">这一页出了点问题</h2>
        <p className="t-sub c-sec">试卷和照片都还在手机上，没有丢。</p>
        <button className="btn btn--tinted" style={{ minWidth: 200 }} onClick={() => window.location.replace("/home")}>回到首页</button>
        <button className="t-sub" style={{ color: "var(--brand)", minHeight: 40 }} onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }
}
