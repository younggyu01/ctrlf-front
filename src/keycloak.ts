import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://58.127.241.84:8090",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
