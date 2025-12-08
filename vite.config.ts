import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api-edu": {
        target: "http://localhost:9002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-edu/, ""),
      },
    },
  },
});
