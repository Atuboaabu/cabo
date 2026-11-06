/** Internal presentation models, NOT an approved HTTP/WS schema. Version labels are demo-only. */
export type Card =
  | { position: number; face: "down" }
  | { position: number; face: "up"; value: number };
export type Member = {
  id: string;
  name: string;
  ready: boolean;
  presence: "Connected" | "Disconnected";
};
export type RoomView = {
  version: string;
  id: string;
  epoch: string;
  progress: number;
  host: string;
  members: Member[];
};
export type GameView = {
  version: string;
  id: string;
  round: string;
  roundNumber: number;
  progress: number;
  phase: "InitialReveal" | "Playing" | "FinalTurns" | "Settling" | "Aborted";
  players: {
    id: string;
    name: string;
    cards: Card[];
    confirmed: number[];
    finished: boolean;
  }[];
  drawCount: number;
  discard: { count: number; top?: number };
  initialDeadline?: number;
  turn?: { id: string; actor: string; deadline: number };
  caboCaller?: string;
};
export type Scope = {
  room: string;
  epoch?: string;
  game?: string;
  round?: string;
  turn?: string;
  decision: string;
  basis: string;
};
export type Decision = {
  version: string;
  scope: Scope;
  actions: string[];
  positions: number[];
  remaining?: number;
  deadline?: number;
};
export type Reveal = {
  recipient: string;
  game: string;
  round: string;
  deadline: number;
  cards: { position: number; value: number }[];
};
export type Snapshot = {
  serverNow: number;
  revision: number;
  self: string;
  room: RoomView;
  game?: GameView;
  decision?: Decision;
  reveal?: Reveal;
};
export type Command = {
  id: string;
  scope: Scope;
  action: string;
  position?: number;
};
export type Result = {
  version: string;
  status: "Accepted" | "Rejected" | "NotYetDetermined" | "OutsideScope";
  reason?: string;
  originalProgress?: number;
  syncProgress?: number;
};
export type Connection =
  | "connected"
  | "disconnected"
  | "taken-over"
  | "syncing"
  | "incompatible"
  | "demo-ended";
export interface Gateway {
  read(): Promise<Snapshot>;
  command(command: Command): Promise<Result>;
  lookup(command: Command): Promise<Result>;
  reconnect(): Promise<void>;
}
export const versions = {
  room: "demo-room-1",
  game: "demo-game-1",
  decision: "demo-decision-1",
  result: "demo-result-1",
};
