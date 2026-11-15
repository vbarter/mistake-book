import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_PROXY || "http://127.0.0.1:5001", changeOrigin: true },
      // 智能聊天的试卷知识库（eduction_rag，本机 8000）：后端 .env 里配 KB_PUBLIC_URL=/kb 时，网页开发经这里转过去
      "/kb": { target: process.env.KB_PROXY || "http://127.0.0.1:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/kb/, "") },
    },
  },
  build: { target: "es2019", sourcemap: false },
});
