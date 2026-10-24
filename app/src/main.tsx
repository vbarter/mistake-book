import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/base.css";
import "./styles/v2.css";
import "./styles/tablet.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// 启动页画出来以后，页面底色恢复成 App 自己的（index.html 里的 booting 只管脚本加载前那一下）
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("booting")));
