import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://keycloak:8090",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
