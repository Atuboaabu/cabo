import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DemoGateway } from "./data/demoGateway";
import { SessionController } from "./data/session";
import "./styles.css";
const scene = new URLSearchParams(location.search).get("scene") ?? "host";
const demo = new DemoGateway(
  ["host", "member", "initial", "table"].includes(scene) ? scene : "host",
);
createRoot(document.getElementById("root")!).render(
  <App client={new SessionController(demo)} demo={demo} />,
);
