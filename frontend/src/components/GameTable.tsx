import type { Snapshot } from "../data/model";
import { CardTile } from "./CardTile";
import { Countdown } from "./Countdown";
export function GameTable({
  snapshot,
  now,
}: {
  snapshot: Snapshot;
  now: number;
}) {
  const game = snapshot.game!;
  const actor = game.players.find((p) => p.id === game.turn?.actor);
  return (
    <section className="panel game-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            ROUND {String(game.roundNumber).padStart(2, "0")} / GAME TABLE
          </p>
          <h1>{actor ? `${actor.name}的回合` : "等待牌局推进"}</h1>
          <p className="muted">
            {game.phase === "FinalTurns"
              ? "最后行动阶段"
              : game.phase === "Settling"
                ? "正在结算"
                : game.phase === "Aborted"
                  ? "游戏已中止"
                  : "顺时针行动 · 背面牌仅显示当前位置"}
          </p>
        </div>
        {game.turn && (
          <Countdown
            deadline={game.turn.deadline}
            now={now}
            label="Turn 截止"
          />
        )}
      </div>
      <div className="table-grid">
        {game.players
          .filter((p) => p.id !== snapshot.self)
          .map((p) => (
            <div
              key={p.id}
              className={`player-hand ${p.id === actor?.id ? "active-player" : ""}`}
            >
              <h2>
                {p.name}{" "}
                <small>
                  {p.id === actor?.id ? "正在行动" : `${p.cards.length} 张牌`}
                </small>
              </h2>
              <div className="cards compact">
                {p.cards.map((c) => (
                  <CardTile key={c.position} card={c} />
                ))}
              </div>
            </div>
          ))}
      </div>
      <div className="piles">
        <div>
          <div className="pile-card back">
            <span>✦</span>
            <b>CABO</b>
          </div>
          <strong>DrawPile</strong>
          <small>{game.drawCount} 张 · 抽牌堆</small>
        </div>
        <span className="table-mark">
          CABO<small>TRUST YOUR MEMORY</small>
        </span>
        <div>
          <div className="pile-card front">
            <span>{game.discard.top ?? "—"}</span>
            <b>{game.discard.top === undefined ? "暂无顶牌" : "公开顶牌"}</b>
          </div>
          <strong>DiscardPile</strong>
          <small>{game.discard.count} 张 · 弃牌堆</small>
        </div>
      </div>
      {game.caboCaller && (
        <p className="cabo-notice">
          {game.players.find((p) => p.id === game.caboCaller)?.name} 已呼叫 CABO
        </p>
      )}
      {game.players
        .filter((p) => p.id === snapshot.self)
        .map((p) => (
          <div
            key={p.id}
            className={`player-hand self-hand ${p.id === actor?.id ? "active-player" : ""}`}
          >
            <h2>
              {p.name} · 你{" "}
              <small>
                {p.id === actor?.id ? "正在行动" : `${p.cards.length} 张牌`}
              </small>
            </h2>
            <div className="cards compact">
              {p.cards.map((c) => (
                <CardTile key={c.position} card={c} />
              ))}
            </div>
          </div>
        ))}
      <p className="demo-note">
        本阶段提供牌桌展示。抽牌、替换、能力与结算操作尚未接入。
      </p>
    </section>
  );
}
