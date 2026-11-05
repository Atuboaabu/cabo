import { it, expect, vi, afterEach } from "vitest";
import { DemoGateway } from "../src/data/demoGateway";
afterEach(() => vi.unstubAllGlobals());
it("concurrent initial reads open only one demo session on a slow connection", async () => {
  let opens = 0;
  let release!: (r: unknown) => void;
  const sessions: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    if (request.operation === "open") {
      opens++;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    sessions.push(request.session);
    return { ok: true, json: async () => ({ data: {} }) };
  });
  const gateway = new DemoGateway("host");
  const first = gateway.read();
  const second = gateway.read();
  expect(opens).toBe(1);
  release({ ok: true, json: async () => ({ data: "single-session" }) });
  await Promise.all([first, second]);
  expect(sessions).toEqual(["single-session", "single-session"]);
});
