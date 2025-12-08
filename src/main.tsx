// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import keycloak from "./keycloak";
import "./index.css";

// Keycloak 초기화
keycloak
  .init({
    onLoad: "login-required", // 앱 진입 시 무조건 로그인 요구
    pkceMethod: "S256",
    checkLoginIframe: false, // Vite/localhost 환경에서 권장
  })
  .then((authenticated) => {
    console.log("Keycloak initialized. Authenticated:", authenticated);
    console.log("Access Token:", keycloak.token);

    // 초기화 완료 후 렌더링 시작
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>
    );

    // 로그인된 경우에만 토큰 자동 갱신
    if (authenticated) {
      // 토큰 자동 갱신 (만료 60초 전 갱신)
      setInterval(() => {
        keycloak
          .updateToken(60)
          .then((refreshed) => {
            if (refreshed) {
              console.log("Token was refreshed ✔");
            }
          })
          .catch(() => {
            console.error("Failed to refresh token ❌");
          });
      }, 10000);
    }
  })
  .catch((err) => {
    console.error("Keycloak initialization error ❌", err);
  });
