import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://10.0.147.41:8090",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
