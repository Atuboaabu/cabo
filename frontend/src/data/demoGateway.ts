import type { Command, Gateway, Result, Snapshot } from "./model";
async function rpc<T>(
  operation: string,
  session?: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch("/__cabo_demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, session, payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      ["TakenOver", "DemoComplete"].includes(body.error)
        ? body.error
        : "RequestFailed",
    );
  return body.data as T;
}
/** Replace with an authorized FastAPI adapter once the wire contract is approved. */
export class DemoGateway implements Gateway {
  private session?: string;
  private opening?: Promise<string>;
  constructor(private scenario: string) {}
  private async id() {
    if (this.session) return this.session;
    this.opening ??= rpc<string>("open", undefined, this.scenario);
    try {
      return (this.session = await this.opening);
    } catch (error) {
      this.opening = undefined;
      throw error;
    }
  }
  async read() {
    return rpc<Snapshot>("read", await this.id());
  }
  async command(command: Command) {
    return rpc<Result>("command", await this.id(), command);
  }
  async lookup(command: Command) {
    return rpc<Result>("lookup", await this.id(), command);
  }
  async reconnect() {
    await rpc("reconnect", await this.id());
  }
  async control(action: string) {
    await rpc("control", await this.id(), action);
  }
}
