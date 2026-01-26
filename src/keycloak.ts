import Keycloak from "keycloak-js";

function defaultKeycloakUrl(): string {
  if (typeof window === "undefined") return "http://localhost:8090";

  // Local dev: backend/keycloak typically runs on localhost:8090 without /auth
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:8090";
  }

  // Deployed: Keycloak is exposed under the same LB via Nginx proxy at /auth
  return `${window.location.origin}/auth`;
}

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? defaultKeycloakUrl();
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM ?? "ctrlf";
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "web-app";

const keycloak = new Keycloak({
  url: KEYCLOAK_URL,
  realm: KEYCLOAK_REALM,
  clientId: KEYCLOAK_CLIENT_ID,
});

export default keycloak;
