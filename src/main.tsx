import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import keycloak from "./keycloak";
import "./index.css";

// Keycloak 초기화
keycloak
  .init({
    onLoad: "login-required",
    checkLoginIframe: false, // Vite/localhost 환경에서는 필수
  })
  .then((authenticated) => {
    if (!authenticated) {
      window.location.reload();
      return;
    }

    console.log("Keycloak Authenticated:", authenticated);
    console.log("Access Token:", keycloak.token);

    // 초기화 완료 후 렌더링 시작
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

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
  })
  .catch((err) => {
    console.error("Keycloak initialization error ❌", err);
  });
