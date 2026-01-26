// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import keycloak from "./keycloak";
import "./index.css";

const isDev = import.meta.env.DEV;

function hasWebCrypto(): boolean {
  // Keycloak(PKCE) requires Web Crypto API (secure context).
  // On external plain HTTP origins, `crypto.subtle` is typically unavailable.
  return (
    typeof window !== "undefined" &&
    typeof window.crypto !== "undefined" &&
    typeof window.crypto.subtle !== "undefined"
  );
}

function renderWebCryptoRequired() {
  const href = typeof window !== "undefined" ? window.location.href : "";

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <div
        style={{
          padding: 24,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
          lineHeight: 1.5,
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <h2 style={{ margin: "0 0 12px" }}>HTTPS가 필요합니다</h2>
        <p style={{ margin: "0 0 12px" }}>
          이 페이지는 Keycloak 로그인을 위해 브라우저의 Web Crypto API가
          필요합니다. 외부에서 <code>http://</code> 로 접속하면 브라우저가 Web
          Crypto API를 비활성화해서 로그인 초기화가 실패할 수 있습니다.
        </p>
        <div style={{ margin: "0 0 12px" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>현재 주소</div>
          <code style={{ wordBreak: "break-all" }}>{href}</code>
        </div>
        <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
          <li>
            <b>권장</b>: 사이트를 <b>HTTPS</b> 로 노출하세요 (CloudFront 또는
            Ingress+ACM).
          </li>
          <li>
            <b>임시(로컬 확인)</b>: <code>kubectl port-forward</code> 후{" "}
            <code>http://localhost</code> 로 접속하면 정상 동작할 수 있습니다.
          </li>
        </ul>
        <p style={{ margin: 0, opacity: 0.8 }}>
          (개발자 콘솔에도 동일한 에러가 출력됩니다.)
        </p>
      </div>
    </React.StrictMode>,
  );
}

// Keycloak 초기화
const initOptions: Parameters<typeof keycloak.init>[0] = {
  onLoad: "login-required",
  checkLoginIframe: false,
  pkceMethod: hasWebCrypto() ? "S256" : (false as unknown as any),
};

if (!hasWebCrypto()) {
  const secure = typeof window !== "undefined" ? window.isSecureContext : false;
  if (isDev) {
    console.warn(
      "Web Crypto API not available; initializing Keycloak with PKCE disabled.",
      {
        isSecureContext: secure,
        href: typeof window !== "undefined" ? window.location.href : "",
      },
    );
  }
}

keycloak
  .init(initOptions)
  .then((authenticated) => {
    if (isDev) {
      console.log("Keycloak initialized. Authenticated:", authenticated);
    }

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>,
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
    // If it still fails (eg. older browsers / strict security), show a clear UI message.
    if (String(err).includes("Web Crypto API is not available")) {
      renderWebCryptoRequired();
    }
  });
