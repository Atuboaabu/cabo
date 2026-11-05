import {
  versions,
  type Gateway,
  type Snapshot,
  type Command,
  type Result,
  type Connection,
} from "./model";
type State = {
  snapshot?: Snapshot;
  connection: Connection;
  pending?: Command;
  result?: Result;
  busy: boolean;
  error?: string;
  now: number;
};
/** Owns UI synchronization only. Never applies game commands to a domain state. */
export class SessionController {
  state: State = { connection: "syncing", busy: false, now: 0 };
  private listeners = new Set<() => void>();
  private generation = 0;
  private readSequence = 0;
  private appliedRead = 0;
  private anchor = 0;
  private anchorLocal = 0;
  constructor(
    public gateway: Gateway,
    private clock: () => number = () => performance.now(),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((l) => l());
  }
  private time() {
    return Math.max(
      this.state.now,
      this.anchor + Math.max(0, this.clock() - this.anchorLocal),
    );
  }
  private safe(s: Snapshot, now: number): Snapshot {
    const reveal = s.reveal;
    const valid =
      reveal &&
      reveal.recipient === s.self &&
      reveal.game === s.game?.id &&
      reveal.round === s.game?.round &&
      s.game?.phase === "InitialReveal" &&
      now < reveal.deadline &&
      !s.game.players.find((p) => p.id === s.self)?.finished;
    const decision = s.decision;
    const scopeValid =
      decision &&
      decision.scope.room === s.room.id &&
      (s.game
        ? decision.scope.game === s.game.id &&
          decision.scope.round === s.game.round &&
          (!decision.scope.turn || decision.scope.turn === s.game.turn?.id)
        : decision.scope.epoch === s.room.epoch);
    return {
      ...s,
      reveal:
        valid && this.state.pending?.action !== "end" ? reveal : undefined,
      decision:
        scopeValid &&
        (decision.deadline === undefined || now < decision.deadline)
          ? decision
          : undefined,
    };
  }
  tick() {
    const now = this.time();
    this.update({
      now,
      snapshot: this.state.snapshot
        ? this.safe(this.state.snapshot, now)
        : undefined,
    });
  }
  private clear(connection: Connection, error?: string) {
    this.generation++;
    this.update({
      connection,
      error,
      busy: false,
      snapshot: this.state.snapshot
        ? { ...this.state.snapshot, decision: undefined, reveal: undefined }
        : undefined,
    });
  }
  disconnect() {
    this.clear("disconnected");
  }
  private failed(error: unknown) {
    if (error instanceof Error && error.message === "DemoComplete")
      this.clear("demo-ended");
    else
      this.clear(
        error instanceof Error && error.message === "TakenOver"
          ? "taken-over"
          : "disconnected",
        "连接中断；原截止时间继续。",
      );
  }
  async refresh() {
    if (
      ["disconnected", "taken-over", "incompatible", "demo-ended"].includes(
        this.state.connection,
      )
    )
      return;
    const sequence = ++this.readSequence;
    const generation = this.generation;
    const started = this.clock();
    try {
      const s = await this.gateway.read();
      if (generation !== this.generation || sequence < this.appliedRead) return;
      if (
        s.room.version !== versions.room ||
        (s.game && s.game.version !== versions.game) ||
        (s.decision && s.decision.version !== versions.decision)
      ) {
        this.clear("incompatible");
        return;
      }
      if (this.state.snapshot && s.revision < this.state.snapshot.revision)
        return;
      // Conservatively account for all round-trip time; never extend a private grant on late delivery.
      this.appliedRead = sequence;
      this.anchor = Math.max(
        this.time(),
        s.serverNow + Math.max(0, this.clock() - started),
      );
      this.anchorLocal = this.clock();
      const now = this.time();
      this.update({
        snapshot: this.safe(s, now),
        now,
        connection: "connected",
      });
    } catch (error) {
      if (generation === this.generation && sequence >= this.appliedRead)
        this.failed(error);
    }
  }
  async reconnect() {
    if (this.state.busy) return;
    this.update({ connection: "syncing", busy: true, error: undefined });
    try {
      await this.gateway.reconnect();
      await this.refresh();
    } catch (error) {
      this.failed(error);
    } finally {
      this.update({ busy: false });
    }
  }
  async send(action: string, position?: number) {
    this.tick();
    const decision = this.state.snapshot?.decision;
    if (
      this.state.connection !== "connected" ||
      this.state.busy ||
      this.state.pending ||
      !decision?.actions.includes(action)
    )
      return;
    const command: Command = {
      id: crypto.randomUUID(),
      scope: { ...decision.scope },
      action,
      ...(position === undefined ? {} : { position }),
    };
    this.generation++;
    this.update({
      pending: command,
      busy: true,
      result: undefined,
      error: undefined,
    });
    this.tick();
    await this.perform(() => this.gateway.command(command));
  }
  async resolve() {
    const command = this.state.pending;
    if (!command || this.state.busy || this.state.connection !== "connected")
      return;
    this.update({ busy: true, error: undefined });
    await this.perform(() => this.gateway.lookup(command));
  }
  async retry() {
    const command = this.state.pending;
    if (
      !command ||
      this.state.busy ||
      this.state.connection !== "connected" ||
      this.state.result?.status === "OutsideScope"
    )
      return;
    this.update({ busy: true, error: undefined });
    await this.perform(() => this.gateway.command(command));
  }
  async leaveOldRequest() {
    if (this.state.result?.status !== "OutsideScope" || this.state.busy) return;
    await this.refresh();
    const old = this.state.pending?.scope;
    const current = this.state.snapshot?.decision?.scope;
    if (
      this.state.connection === "connected" &&
      old &&
      current &&
      (old.game !== current.game ||
        old.round !== current.round ||
        old.turn !== current.turn ||
        old.epoch !== current.epoch ||
        old.decision !== current.decision)
    )
      this.update({ pending: undefined });
  }
  private async perform(operation: () => Promise<Result>) {
    let generation = this.generation;
    try {
      const result = await operation();
      if (generation !== this.generation) return;
      if (result.version !== versions.result) {
        this.clear("incompatible");
        return;
      }
      // No read issued before this result may restore a superseded authorization.
      generation = ++this.generation;
      const final =
        result.status === "Accepted" || result.status === "Rejected";
      this.update({ result, pending: final ? undefined : this.state.pending });
      if (result.reason === "TakenOver") this.clear("taken-over");
      else await this.refresh();
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof Error && error.message === "TakenOver")
        this.clear("taken-over");
      else
        this.update({
          error: "请求响应未收到，结果尚不确定。请核对原请求结果。",
        });
    } finally {
      if (generation === this.generation) this.update({ busy: false });
    }
  }
}
