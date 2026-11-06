import type { Snapshot } from "../data/model";
export function Lobby({
  snapshot,
  disabled,
  onAction,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  onAction: (action: string) => void;
}) {
  const { room, self, decision } = snapshot;
  const host = self === room.host;
  const ready = room.members.find((m) => m.id === self)?.ready;
  return (
    <section className="lobby panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ROOM LOBBY</p>
          <h1>朋友到齐，好戏开场。</h1>
          <p className="muted">2–4 人，一场关于记忆与直觉的小游戏。</p>
        </div>
        <span className="seat-count">
          {room.members.length}
          <small> / 4 位玩家</small>
        </span>
      </div>
      <ul className="members">
        {room.members.map((member, index) => (
          <li key={member.id}>
            <span className={`avatar avatar-${index}`}>
              {member.name.slice(0, 1)}
            </span>
            <div className="member-info">
              <strong>
                {member.name}{" "}
                {member.id === self && <span className="muted">· 你</span>}
              </strong>
              <span className="presence">
                <i
                  className={member.presence === "Connected" ? "online" : ""}
                />
                {member.presence === "Connected" ? "在线" : "暂时离线"}
              </span>
            </div>
            {member.id === room.host ? (
              <span className="badge host">♔ Host</span>
            ) : (
              <span className={`badge ${member.ready ? "ready" : ""}`}>
                {member.ready ? "✓ 已准备" : "等待准备"}
              </span>
            )}
          </li>
        ))}
        {room.members.length < 4 && (
          <li className="empty-seat">
            <span className="avatar">＋</span>
            <span>留一个位置，等下一位朋友。</span>
          </li>
        )}
      </ul>
      <div className="lobby-actions">
        <p>
          {host
            ? "房主无需准备。其他成员准备后即可开局。"
            : "准备好后，等待房主开始游戏。"}
          <small>已准备成员暂时离线，不会取消其准备状态。</small>
        </p>
        {host ? (
          <button
            className="primary"
            disabled={disabled || !decision?.actions.includes("start")}
            onClick={() => onAction("start")}
          >
            开始游戏
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              disabled ||
              !decision?.actions.includes(ready ? "unready" : "ready")
            }
            onClick={() => onAction(ready ? "unready" : "ready")}
          >
            {ready ? "取消准备" : "准备好了"}
          </button>
        )}
      </div>
    </section>
  );
}
