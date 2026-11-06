import { describe, it, expect } from "vitest";
import { SessionController } from "../src/data/session";
import { DemoService } from "../mock/service";
import type { Gateway, Snapshot } from "../src/data/model";
function setup() {
  let time = 1000;
  const service = new DemoService(() => time);
  const id = service.open("initial");
  const gateway: Gateway = {
    read: async () => service.read(id),
    command: async (c) => service.command(id, c),
    lookup: async (c) => service.lookup(id, c),
    reconnect: async () => {
      service.reconnect(id);
    },
  };
  const client = new SessionController(gateway, () => time);
  return {
    client,
    service,
    id,
    gateway,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe("client authorization and recovery", () => {
  it("disconnection clears private values; reconnect keeps the original deadline", async () => {
    const { client, advance } = setup();
    await client.refresh();
    await client.send("confirm", 1);
    const deadline = client.state.snapshot!.reveal!.deadline;
    client.disconnect();
    expect(client.state.snapshot?.reveal).toBeUndefined();
    advance(5000);
    await client.reconnect();
    expect(client.state.snapshot?.reveal?.deadline).toBe(deadline);
  });
  it("local expiry clears private results without advancing authoritative game phase", async () => {
    const { client, advance } = setup();
    await client.refresh();
    await client.send("confirm", 1);
    advance(45000);
    client.tick();
    expect(client.state.snapshot?.reveal).toBeUndefined();
    expect(client.state.snapshot?.decision).toBeUndefined();
    expect(client.state.snapshot?.game?.phase).toBe("InitialReveal");
  });
  it("a late private response after deadline is never displayed", async () => {
    const { client, gateway, advance } = setup();
    await client.refresh();
    await client.send("confirm", 1);
    const original = await gateway.read();
    gateway.read = () =>
      new Promise((resolve) => {
        release = () => resolve(original);
      });
    let release: () => void = () => {};
    const pending = client.refresh();
    advance(46000);
    release();
    await pending;
    expect(client.state.snapshot?.reveal).toBeUndefined();
  });
  it("a response from before disconnect cannot restore private values", async () => {
    const { client, gateway } = setup();
    await client.refresh();
    await client.send("confirm", 1);
    const original = await gateway.read();
    let release!: (s: Snapshot) => void;
    gateway.read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = client.refresh();
    client.disconnect();
    release(original);
    await pending;
    expect(client.state.connection).toBe("disconnected");
    expect(client.state.snapshot?.reveal).toBeUndefined();
  });
  it("lost response queries same request result without executing again", async () => {
    const { client, service, id } = setup();
    await client.refresh();
    service.control(id, "lost-response");
    await client.send("confirm", 1);
    expect(client.state.pending?.action).toBe("confirm");
    await client.resolve();
    expect(client.state.result?.status).toBe("Accepted");
    expect(client.state.pending).toBeUndefined();
    expect(client.state.snapshot?.reveal?.cards).toHaveLength(1);
  });
  it("stale rejection refreshes decision and does not replay the selected position", async () => {
    const { client, service, id } = setup();
    await client.refresh();
    service.control(id, "stale");
    await client.send("confirm", 1);
    expect(client.state.result?.reason).toBe("StaleDecision");
    expect(client.state.snapshot?.reveal).toBeUndefined();
  });
  it("unknown required version stops related operations and removes secrets", async () => {
    const { client, service, id } = setup();
    await client.refresh();
    await client.send("confirm", 1);
    service.control(id, "incompatible");
    await client.refresh();
    expect(client.state.connection).toBe("incompatible");
    expect(client.state.snapshot?.reveal).toBeUndefined();
    expect(client.state.snapshot?.decision).toBeUndefined();
  });
});

it("an in-flight pre-End poll cannot resurrect authorization after Accepted End", async () => {
  const { client, gateway } = setup();
  await client.refresh();
  await client.send("confirm", 1);
  const beforeEnd = await gateway.read();
  const realRead = gateway.read;
  let release!: (s: Snapshot) => void;
  gateway.read = () => {
    gateway.read = realRead;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const oldPoll = client.refresh();
  await client.send("end");
  release(beforeEnd);
  await oldPoll;
  expect(client.state.result?.status).toBe("Accepted");
  expect(client.state.snapshot?.reveal).toBeUndefined();
  expect(
    client.state.snapshot?.game?.players.find((p) => p.id === "p1")?.finished,
  ).toBe(true);
});

it("a request that never arrived can be resent with the exact original identity", async () => {
  const { client, gateway } = setup();
  await client.refresh();
  const realCommand = gateway.command;
  let failedCommand: unknown;
  gateway.command = async (command) => {
    failedCommand = command;
    throw new Error("RequestFailed");
  };
  await client.send("confirm", 1);
  await client.resolve();
  expect(client.state.result?.status).toBe("NotYetDetermined");
  gateway.command = async (command) => {
    expect(command).toEqual(failedCommand);
    return realCommand(command);
  };
  await client.retry();
  expect(client.state.result?.status).toBe("Accepted");
  expect(client.state.snapshot?.reveal?.cards).toHaveLength(1);
});

it("Outside Scope only releases the old request after a new Decision is synchronized", async () => {
  const { client, gateway, service, id } = setup();
  await client.refresh();
  gateway.command = async () => {
    throw new Error("RequestFailed");
  };
  gateway.lookup = async () => ({
    version: "demo-result-1",
    status: "OutsideScope",
  });
  await client.send("confirm", 1);
  await client.resolve();
  await client.leaveOldRequest();
  expect(client.state.pending).toBeDefined();
  service.control(id, "stale");
  await client.leaveOldRequest();
  expect(client.state.pending).toBeUndefined();
  expect(client.state.snapshot?.reveal).toBeUndefined();
});

it("overlapping slow polls make progress instead of starving every response", async () => {
  const { client, gateway } = setup();
  const s = await gateway.read();
  const releases: Array<(s: Snapshot) => void> = [];
  gateway.read = () => new Promise((resolve) => releases.push(resolve));
  const first = client.refresh();
  const second = client.refresh();
  releases[0](s);
  await first;
  expect(client.state.connection).toBe("connected");
  releases[1](s);
  await second;
});
