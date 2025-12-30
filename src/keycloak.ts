import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://k8s-argocd-keycloak-446de99eb5-6274bddb4987261a.elb.ap-northeast-2.amazonaws.com:8090",
  realm: "ctrlf",
  clientId: "web-app",
});

export default keycloak;
