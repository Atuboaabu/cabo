import type { Card } from "../data/model";
export function CardTile({
  card,
  secret,
  selected,
  disabled,
  onSelect,
}: {
  card: Card;
  secret?: number;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const value = card.face === "up" ? card.value : secret;
  const content = (
    <>
      <span className="card-corner">{value === undefined ? "◇" : value}</span>
      <span className="card-center" aria-hidden="true">
        {value === undefined ? "✦" : value}
      </span>
      <span className="card-brand">
        {value === undefined
          ? "CABO"
          : card.face === "up"
            ? "公开牌"
            : "仅你可见"}
      </span>
    </>
  );
  return (
    <div className="card-slot">
      {onSelect ? (
        <button
          type="button"
          className={`card ${value === undefined ? "back" : "front"} ${selected ? "selected" : ""}`}
          disabled={disabled}
          aria-pressed={selected}
          aria-label={`选择第 ${card.position} 张牌`}
          onClick={onSelect}
        >
          {content}
        </button>
      ) : (
        <div
          className={`card ${value === undefined ? "back" : "front"}`}
          aria-label={`第 ${card.position} 张${value === undefined ? "背面牌" : `公开牌 ${value}`}`}
        >
          {content}
        </div>
      )}
      {secret !== undefined && (
        <span className="sr-only" aria-label={`第 ${card.position} 张临时牌值`}>
          {secret}
        </span>
      )}
      <span className="position">{String(card.position).padStart(2, "0")}</span>
    </div>
  );
}
