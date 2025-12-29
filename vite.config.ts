import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      /**
       * 교육 도메인(기존 유지)
       */
      "/api-edu": {
        target: "http://localhost:9002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-edu/, ""),
      },

      /**
       * 채팅 도메인 (Chat Service: 9005)
       * Swagger 기준 실제 경로:
       * - /api/chat/sessions...
       * - /chat/messages...
       * - /chat/sessions/.../feedback ...
       */
      "/api/chat": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
      },
      "/chat": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
        ws: true,
      },

      /**
       * FAQ (중요)
       * 프론트에서 /api/faq/* 로 호출 중인데,
       * 백엔드 명세는 /faq/* 이므로 rewrite로 맞춰준다.
       *
       * 예)
       * - FE:  GET /api/faq/home          -> BE: GET /faq/home
       * - FE:  GET /api/faq?domain=SEC... -> BE: GET /faq?domain=SEC...
       * - FE:  GET /api/faq/dashboard/... -> BE: GET /faq/dashboard/...
       */
      "/api/faq": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/faq/, "/faq"),
      },

      /**
       * (선택) FAQ/ADMIN FAQ를 프론트에서 직접 호출할 경우를 대비한 프록시
       * 프론트가 /faq/* 를 직접 호출하면 아래 규칙이 탄다.
       */
      "/faq": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
      },
      "/admin/faq": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
      },
      "/admin/faqs": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
