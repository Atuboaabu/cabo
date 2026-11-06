import { describe, it, expect } from "vitest";
import { DemoService } from "../mock/service";

function setup(scenario = "initial") {
  let time = 1000;
  const service = new DemoService(() => time);
  const session = service.open(scenario);
  return {
    service,
    session,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function request(
  service: DemoService,
  session: string,
  action: string,
  position?: number,
  id = crypto.randomUUID(),
) {
  const s = service.read(session);
  return {
    id,
    scope: s.decision!.scope,
    action,
    ...(position === undefined ? {} : { position }),
  };
}
describe("Phase 4 mock boundary", () => {
  it("F01: a Ready disconnected member does not block host Start", () => {
    const { service, session } = setup("host");
    expect(
      service.command(session, request(service, session, "start")).status,
    ).toBe("Accepted");
    expect(service.read(session).game?.phase).toBe("InitialReveal");
  });
  it("F03: two different confirms keep original window, reject third, no secrets in ordinary view", () => {
    const { service, session } = setup();
    const deadline = service.read(session).game!.initialDeadline;
    for (const position of [1, 3])
      expect(
        service.command(session, request(service, session, "confirm", position))
          .status,
      ).toBe("Accepted");
    const s = service.read(session);
    expect(s.game?.phase).toBe("InitialReveal");
    expect(s.game?.initialDeadline).toBe(deadline);
    expect(s.reveal?.cards.map((c) => c.position)).toEqual([1, 3]);
    expect(
      s.game?.players
        .flatMap((p) => p.cards)
        .every((c) => !("value" in c) && !("cardId" in c)),
    ).toBe(true);
    expect(
      service.command(session, request(service, session, "confirm", 2)).status,
    ).toBe("Rejected");
  });
  it("duplicate positions are rejected and same identity is idempotent", () => {
    const { service, session } = setup();
    const r = request(service, session, "confirm", 1);
    const original = service.command(session, r);
    expect(service.command(session, r)).toEqual(original);
    expect(service.command(session, { ...r, position: 2 }).reason).toBe(
      "IdentityConflict",
    );
    expect(
      service.command(session, request(service, session, "confirm", 1)).status,
    ).toBe("Rejected");
    expect(service.read(session).reveal?.cards).toHaveLength(1);
  });
  it("F04: reconnect after shared deadline never restores secret or starts another 45s", () => {
    const { service, session, advance } = setup();
    service.command(session, request(service, session, "confirm", 2));
    advance(45000);
    service.reconnect(session);
    expect(service.read(session).reveal).toBeUndefined();
    expect(service.read(session).game?.phase).toBe("Playing");
    expect(service.read(session).game?.turn?.deadline).toBe(136000);
  });
  it("personal End removes authorization, waits for peers, all End starts turn", () => {
    const { service, session } = setup();
    service.command(session, request(service, session, "confirm", 1));
    service.command(session, request(service, session, "end"));
    expect(service.read(session).reveal).toBeUndefined();
    expect(service.read(session).game?.phase).toBe("InitialReveal");
    service.control(session, "peers-end");
    expect(service.read(session).game?.phase).toBe("Playing");
  });
  it("takeover rejects new work but preserves Accepted history and deadline", () => {
    const { service, session } = setup();
    const r = request(service, session, "confirm", 1);
    const result = service.command(session, r);
    const next = request(service, session, "confirm", 2);
    const deadline = service.read(session).game!.initialDeadline;
    service.control(session, "takeover");
    expect(() => service.read(session)).toThrow("TakenOver");
    expect(service.command(session, next).status).toBe("Rejected");
    service.reconnect(session);
    expect(service.lookup(session, r)).toEqual(result);
    expect(service.read(session).game?.initialDeadline).toBe(deadline);
  });
  it("stale Decision cannot target same position in a new context", () => {
    const { service, session } = setup();
    const r = request(service, session, "confirm", 1);
    service.control(session, "stale");
    expect(service.command(session, r).reason).toBe("StaleDecision");
  });
});

it("canonical request identity ignores JSON property order", () => {
  const { service, session } = setup();
  const original = request(service, session, "confirm", 1);
  const result = service.command(session, original);
  const reordered = {
    position: original.position,
    action: original.action,
    scope: Object.fromEntries(
      Object.entries(original.scope).reverse(),
    ) as typeof original.scope,
    id: original.id,
  };
  expect(service.command(session, reordered)).toEqual(result);
  expect(service.lookup(session, reordered)).toEqual(result);
});

it("display-only Turn fixture stops serving snapshots at its boundary instead of inventing timeout rules", () => {
  const { service, session, advance } = setup("table");
  advance(90000);
  expect(() => service.read(session)).toThrow("DemoComplete");
});
