import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://localhost:8080",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
