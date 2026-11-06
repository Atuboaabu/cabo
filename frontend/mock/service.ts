// Node only. Never import this file from src/. This is a bounded demo, not a CABO engine.
import { randomUUID } from "node:crypto";
import {
  versions,
  type Snapshot,
  type Command,
  type Result,
  type Card,
  type Scope,
} from "../src/data/model";

type Demo = {
  snapshot: Snapshot;
  active: boolean;
  decision: number;
  ended: boolean;
  confirmed: number[];
  history: Map<string, { command: string; result: Result }>;
  fault?: string;
};
export class DemoService {
  private sessions = new Map<string, Demo>();
  constructor(private now: () => number = Date.now) {}
  open(scenario: string) {
    const session = randomUUID();
    const self = scenario === "member" ? "p2" : "p1";
    const snapshot: Snapshot = {
      serverNow: this.now(),
      revision: 1,
      self,
      room: {
        version: versions.room,
        id: "DEMO-042",
        epoch: randomUUID(),
        progress: 1,
        host: "p1",
        members: [
          { id: "p1", name: "林间", ready: false, presence: "Connected" },
          {
            id: "p2",
            name: "你的小伙伴",
            ready: scenario !== "member",
            presence: "Connected",
          },
          { id: "p3", name: "晚风", ready: true, presence: "Disconnected" },
        ],
      },
    };
    const demo: Demo = {
      snapshot,
      active: true,
      decision: 1,
      ended: false,
      confirmed: [],
      history: new Map(),
    };
    this.sessions.set(session, demo);
    if (scenario === "initial" || scenario === "table") this.start(demo);
    if (scenario === "table") {
      this.turn(demo, this.now());
      // A later, independently loaded public table fixture (not an InitialReveal outcome).
      demo.snapshot.game!.players[1].cards = [
        { position: 1, face: "up", value: 3 },
        { position: 2, face: "down" },
        { position: 3, face: "down" },
      ];
      demo.snapshot.game!.drawCount = 34;
      demo.snapshot.game!.discard = { count: 7, top: 9 };
    }
    return session;
  }
  private get(session: string) {
    const d = this.sessions.get(session);
    if (!d) throw new Error("Unavailable");
    this.advance(d);
    return d;
  }
  private bump(d: Demo) {
    d.snapshot.revision++;
    d.snapshot.room.progress++;
    if (d.snapshot.game) d.snapshot.game.progress++;
  }
  private start(d: Demo) {
    d.snapshot.game = {
      version: versions.game,
      id: randomUUID(),
      round: randomUUID(),
      roundNumber: 1,
      progress: 1,
      phase: "InitialReveal",
      initialDeadline: this.now() + 45000,
      drawCount: 39,
      discard: { count: 1, top: 6 },
      players: d.snapshot.room.members.map((p) => ({
        id: p.id,
        name: p.name,
        cards: [1, 2, 3, 4].map(
          (position) => ({ position, face: "down" }) as Card,
        ),
        confirmed: [],
        finished: false,
      })),
    };
    d.decision++;
    this.bump(d);
  }
  private turn(d: Demo, at: number) {
    const g = d.snapshot.game!;
    g.phase = "Playing";
    g.initialDeadline = undefined;
    g.players.forEach((p) => {
      p.finished = true;
    });
    g.turn = { id: randomUUID(), actor: "p1", deadline: at + 90000 };
    d.ended = true;
    d.confirmed = [];
    d.decision++;
    this.bump(d);
  }
  private advance(d: Demo) {
    const g = d.snapshot.game;
    if (g?.phase === "InitialReveal" && this.now() >= g.initialDeadline!)
      this.turn(d, g.initialDeadline!);
    // Table is display-only in M1. Stop the local fixture, never invent a timeout result.
    if (g?.phase === "Playing" && g.turn && this.now() >= g.turn.deadline)
      throw new Error("DemoComplete");
  }
  private project(d: Demo): Snapshot {
    const s = structuredClone(d.snapshot);
    s.serverNow = this.now();
    const g = s.game;
    if (!g) {
      s.decision = {
        version: versions.decision,
        scope: {
          room: s.room.id,
          epoch: s.room.epoch,
          decision: `lobby-${d.decision}`,
          basis: s.room.epoch,
        },
        actions:
          s.self === s.room.host
            ? s.room.members.length >= 2 &&
              s.room.members
                .filter((m) => m.id !== s.room.host)
                .every((m) => m.ready)
              ? ["start"]
              : []
            : ["ready", "unready"],
        positions: [],
      };
    } else if (g.phase === "InitialReveal" && !d.ended) {
      s.decision = {
        version: versions.decision,
        scope: {
          room: s.room.id,
          game: g.id,
          round: g.round,
          decision: `reveal-${d.decision}`,
          basis: g.round,
        },
        actions: d.confirmed.length < 2 ? ["confirm", "end"] : ["end"],
        positions: [1, 2, 3, 4].filter((p) => !d.confirmed.includes(p)),
        remaining: 2 - d.confirmed.length,
        deadline: g.initialDeadline,
      };
      if (d.confirmed.length)
        s.reveal = {
          recipient: s.self,
          game: g.id,
          round: g.round,
          deadline: g.initialDeadline!,
          // Fixture values exist only on the Node side and only enter an authorized private result.
          cards: d.confirmed.map((position) => ({
            position,
            value: [2, 7, 4, 11][position - 1],
          })),
        };
    }
    return s;
  }
  read(session: string) {
    const d = this.get(session);
    if (!d.active) throw new Error("TakenOver");
    return this.project(d);
  }
  reconnect(session: string) {
    const d = this.get(session);
    d.active = true;
    return true;
  }
  lookup(session: string, r: Command): Result {
    const d = this.get(session);
    if (!d.active) throw new Error("TakenOver");
    const old = d.history.get(this.key(r));
    if (old && old.command !== this.normalized(r))
      return {
        version: versions.result,
        status: "Rejected",
        reason: "IdentityConflict",
      };
    return old
      ? { ...old.result }
      : { version: versions.result, status: "NotYetDetermined" };
  }
  private scopeKey(s: Scope) {
    return JSON.stringify([
      s.room,
      s.epoch,
      s.game,
      s.round,
      s.turn,
      s.decision,
      s.basis,
    ]);
  }
  private normalized(r: Command) {
    return JSON.stringify([this.scopeKey(r.scope), r.id, r.action, r.position]);
  }
  private key(r: Command) {
    return JSON.stringify([this.scopeKey(r.scope), r.id]);
  }
  command(session: string, r: Command): Result {
    const d = this.get(session);
    const reject = (reason: string): Result => ({
      version: versions.result,
      status: "Rejected",
      reason,
    });
    const old = d.history.get(this.key(r));
    if (old)
      return old.command === this.normalized(r)
        ? { ...old.result }
        : reject("IdentityConflict");
    let result: Result;
    const current = this.project(d).decision;
    if (!d.active) result = reject("TakenOver");
    else if (
      !current ||
      this.scopeKey(r.scope) !== this.scopeKey(current.scope)
    )
      result = reject("StaleDecision");
    else if (!current.actions.includes(r.action)) result = reject("NotAllowed");
    else if (r.action === "confirm" && !current.positions.includes(r.position!))
      result = reject("InvalidTarget");
    else {
      if (r.action === "start") this.start(d);
      if (r.action === "ready" || r.action === "unready")
        d.snapshot.room.members.find((m) => m.id === d.snapshot.self)!.ready =
          r.action === "ready";
      if (r.action === "confirm") {
        d.confirmed.push(r.position!);
        d.snapshot.game!.players.find(
          (p) => p.id === d.snapshot.self,
        )!.confirmed = [...d.confirmed];
        d.decision++;
      }
      if (r.action === "end") {
        d.ended = true;
        d.confirmed = [];
        d.decision++;
        d.snapshot.game!.players.find(
          (p) => p.id === d.snapshot.self,
        )!.finished = true;
        if (d.snapshot.game!.players.every((p) => p.finished))
          this.turn(d, this.now());
      }
      this.bump(d);
      result = {
        version: versions.result,
        status: "Accepted",
        originalProgress: d.snapshot.revision,
      };
    }
    d.history.set(this.key(r), { command: this.normalized(r), result });
    if (d.fault === "lost-response") {
      d.fault = undefined;
      throw new Error("RequestFailed");
    }
    return { ...result };
  }
  control(session: string, action: string) {
    const d = this.get(session);
    if (action === "takeover") d.active = false;
    if (action === "lost-response") d.fault = action;
    if (action === "stale") d.decision++;
    if (action === "peers-end" && d.snapshot.game?.phase === "InitialReveal") {
      d.snapshot.game.players
        .filter((p) => p.id !== d.snapshot.self)
        .forEach((p) => {
          p.finished = true;
        });
      if (d.ended) this.turn(d, this.now());
      this.bump(d);
    }
    if (action === "incompatible")
      d.snapshot.room.version = "demo-room-unknown";
    return true;
  }
}
