import Keycloak from "keycloak-js";

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://k8s-argocd-ctrlfing-24d9f59895-1823150137.ap-northeast-2.elb.amazonaws.com/auth:8090";
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM ?? "ctrlf";
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "web-app";

const keycloak = new Keycloak({
  url: "http://k8s-argocd-ctrlfing-24d9f59895-1823150137.ap-northeast-2.elb.amazonaws.com/auth",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
