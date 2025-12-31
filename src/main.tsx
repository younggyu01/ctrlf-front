// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import keycloak from "./keycloak";
import "./index.css";

const isDev = import.meta.env.DEV;

// Keycloak 초기화
keycloak
  .init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  })
  .then((authenticated) => {
    if (isDev) {
      console.log("Keycloak initialized. Authenticated:", authenticated);
    }

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>
    );

    // 로그인된 경우에만 토큰 자동 갱신
    if (authenticated) {
      // 만료 60초 전 갱신 시도
      setInterval(() => {
        keycloak
          .updateToken(60)
          .then((refreshed) => {
            if (isDev && refreshed) {
              console.log("Token was refreshed ✔");
            }
          })
          .catch(() => {
            console.error("Failed to refresh token ❌");
          });
      }, 30_000);
    }
  })
  .catch((err) => {
    console.error("Keycloak initialization error ❌", err);
  });
