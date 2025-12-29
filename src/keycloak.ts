import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://192.168.0.112:8090",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
