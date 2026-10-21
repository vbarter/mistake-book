import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_PROXY || "http://127.0.0.1:5001", changeOrigin: true },
    },
  },
  build: { target: "es2019", sourcemap: false },
});
