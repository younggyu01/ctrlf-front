import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  // 빌드 시 자산(assets) 경로를 상대 경로로 설정하여 
  // 인그레스 경로가 꼬여도 파일을 찾을 수 있게 합니다.
  base: "./", 
  plugins: [react()],
  server: {
    port: 5173,
    // open: true, // CI/CD 환경이나 컨테이너에서는 false로 두는 것이 에러 방지에 좋습니다.
    proxy: {
      /**
       * 교육 도메인 (education-service: 9002)
       * FE는 /api-edu/* 로 호출 → BE는 /* 로 받도록 rewrite
       */
      "/api-edu": {
        target: "http://education-service:9002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-edu/, ""),
      },

      /**
       * 인프라 도메인 (infra-service: 9003)
       */
      "/api-infra/files": {
        target: "http://infra-service:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/files/, "/infra/files"),
      },
      "/api-infra/infra": {
        target: "http://infra-service:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/infra/, "/infra"),
      },
      "/api-infra/rag": {
        target: "http://infra-service:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra\/rag/, "/rag"),
      },
      "/api-infra": {
        target: "http://infra-service:9003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infra/, ""),
      },

      /**
       * 채팅 도메인 (Chat Service: 9005)
       */
      "/api/chat/admin": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/chat\/admin/, "/admin"),
      },
      "/api/chat": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
      },
      "/chat": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
        ws: true,
      },

      /**
       * FAQ
       */
      "/api/faq": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/faq/, "/faq"),
      },

      "/faq": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
      },
      "/admin/faq": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
      },
      "/admin/faqs": {
        target: "http://chat-service:9005",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});