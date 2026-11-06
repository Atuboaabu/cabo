import type { Plugin, Connect } from "vite";
import { DemoService } from "./service";

// Local demo RPC only. No real CABO route or WebSocket format is assumed here.
export function mockPlugin(): Plugin {
  const service = new DemoService();
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== "/__cabo_demo") return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("{}");
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16000) throw new Error("Unavailable");
      }
      const { operation, session, payload } = JSON.parse(body);
      let data: unknown;
      switch (operation) {
        case "open":
          data = service.open(payload);
          break;
        case "read":
          data = service.read(session);
          break;
        case "command":
          data = service.command(session, payload);
          break;
        case "lookup":
          data = service.lookup(session, payload);
          break;
        case "reconnect":
          data = service.reconnect(session);
          break;
        case "control":
          data = service.control(session, payload);
          break;
        default:
          throw new Error("Unavailable");
      }
      res.end(JSON.stringify({ data }));
    } catch (error) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error:
            error instanceof Error &&
            ["TakenOver", "DemoComplete"].includes(error.message)
              ? error.message
              : "RequestFailed",
        }),
      );
    }
  };
  return {
    name: "cabo-local-demo",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
