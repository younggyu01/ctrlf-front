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
       * 교육 도메인 (education-service: 9002)
       * FE는 /api-edu/* 로 호출 → BE는 /* 로 받도록 rewrite
       * (주의) /education 을 API prefix로 쓰면 SPA 라우트(/education 페이지)와 충돌 가능
       */
      "/api-edu": {
        target: "http://localhost:9002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-edu/, ""),
      },

      /**
       * 인프라 도메인 (infra-service: 9003)
       * - S3 presigned: /api-infra/files/* → /infra/files/*
       * - S3 presigned (alternative): /api-infra/infra/* → /infra/*
       * - RAG documents: /api-infra/rag/* → /rag/*
       */
      "/api-infra/files": {
        target: "http://localhost:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/files/, "/infra/files"),
      },
      "/api-infra/infra": {
        target: "http://localhost:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/infra/, "/infra"),
      },
      "/api-infra/rag": {
        target: "http://localhost:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/rag/, "/rag"),
      },
      "/api-infra": {
        target: "http://localhost:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra/, ""),
      },

      /**
       * 채팅 도메인 (Chat Service: 9005)
       * Swagger 기준 실제 경로:
       * - /api/chat/sessions...
       * - /chat/messages...
       * - /chat/sessions/.../feedback ...
       * - /admin/dashboard/... (대시보드 API)
       */
      // 대시보드 API: /api/chat/admin/* → /admin/*
      "/api/chat/admin": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/chat\/admin/, "/admin"),
      },
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
       * FE: /api/faq/* → BE: /faq/*
       */
      "/api/faq": {
        target: "http://localhost:9005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/faq/, "/faq"),
      },

      /**
       * (선택) FAQ/ADMIN FAQ를 프론트에서 직접 호출할 경우를 대비한 프록시
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
