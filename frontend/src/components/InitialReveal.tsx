import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../data/model";
import { CardTile } from "./CardTile";
import { Countdown } from "./Countdown";
export function InitialReveal({
  snapshot,
  now,
  disabled,
  onAction,
}: {
  snapshot: Snapshot;
  now: number;
  disabled: boolean;
  onAction: (action: string, position?: number) => void;
}) {
  const [selected, setSelected] = useState<number>();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const decision = snapshot.decision;
  const game = snapshot.game!;
  const self = game.players.find((p) => p.id === snapshot.self)!;
  const remaining = decision?.remaining ?? 0;
  const live = Boolean(decision?.actions.includes("end")) && !disabled;
  useEffect(() => {
    setSelected(undefined);
    setConfirmEnd(false);
  }, [decision?.scope.decision, disabled]);
  useEffect(() => {
    if (confirmEnd && dialog.current && !dialog.current.open)
      dialog.current.showModal?.();
  }, [confirmEnd]);
  const end = () => {
    setConfirmEnd(false);
    onAction("end");
  };
  return (
    <section className="panel reveal-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            ROUND {String(game.roundNumber).padStart(2, "0")} / INITIAL REVEAL
          </p>
          <h1>记住两张，轻装上场。</h1>
          <p className="muted">
            逐张确认，最多查看两张不同的初始牌。请自己记住数字。
          </p>
        </div>
        {game.initialDeadline !== undefined && (
          <Countdown
            deadline={game.initialDeadline}
            now={now}
            label="全员共享窗口"
          />
        )}
      </div>
      <div className="reveal-mat">
        <div className="cards">
          {self.cards.map((card) => (
            <CardTile
              key={card.position}
              card={card}
              secret={
                snapshot.reveal?.cards.find((c) => c.position === card.position)
                  ?.value
              }
              selected={selected === card.position}
              disabled={
                !live ||
                !decision?.actions.includes("confirm") ||
                !decision.positions.includes(card.position)
              }
              onSelect={() => setSelected(card.position)}
            />
          ))}
        </div>
        <p className="reveal-hint">
          {self.finished
            ? "已结束查看，等待其他玩家。"
            : !decision
              ? "窗口已不可操作，等待当前状态同步。"
              : remaining === 0
                ? "两张已确认。你仍可查看，直到结束或共享窗口截止。"
                : `还可确认 ${remaining} 张 · 选中后点击确认查看`}
        </p>
      </div>
      <div className="reveal-actions">
        <button
          className="secondary"
          disabled={!live}
          onClick={() => (remaining > 0 ? setConfirmEnd(true) : end())}
        >
          结束查看
        </button>
        <button
          className="primary"
          disabled={
            !live ||
            selected === undefined ||
            !decision?.positions.includes(selected)
          }
          onClick={() => {
            if (selected !== undefined) onAction("confirm", selected);
          }}
        >
          {selected === undefined
            ? "先选择一张牌"
            : `确认查看第 ${selected} 张`}
        </button>
      </div>
      <div className="player-progress">
        {game.players.map((p) => (
          <span key={p.id}>
            <i className={p.finished ? "complete" : ""} />
            {p.name} ·{" "}
            {p.finished ? "已结束" : `已确认 ${p.confirmed.length}/2`}
          </span>
        ))}
      </div>
      {confirmEnd && live && (
        <dialog
          ref={dialog}
          open={typeof HTMLDialogElement.prototype.showModal !== "function"}
          aria-labelledby="end-title"
          onCancel={() => setConfirmEnd(false)}
        >
          <h2 id="end-title">现在结束查看？</h2>
          <p>将放弃剩余 {remaining} 次查看机会，之后不能再次查看。</p>
          <p className="muted">确认期间，原共享窗口继续计时。</p>
          <div className="dialog-actions">
            <button
              autoFocus
              className="secondary"
              onClick={() => setConfirmEnd(false)}
            >
              继续查看
            </button>
            <button className="primary" onClick={end}>
              确认结束
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
