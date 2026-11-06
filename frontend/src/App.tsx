import { useEffect, useSyncExternalStore } from "react";
import type { SessionController } from "./data/session";
import type { DemoGateway } from "./data/demoGateway";
import { Lobby } from "./components/Lobby";
import { InitialReveal } from "./components/InitialReveal";
import { GameTable } from "./components/GameTable";
import { ConnectionBanner } from "./components/ConnectionBanner";
export function App({
  client,
  demo,
}: {
  client: SessionController;
  demo?: DemoGateway;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => {
    void client.refresh();
    const tick = setInterval(() => client.tick(), 200);
    const poll = setInterval(() => void client.refresh(), 1000);
    const offline = () => client.disconnect();
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener("offline", offline);
    };
  }, [client]);
  const s = state.snapshot;
  const disabled =
    state.connection !== "connected" || state.busy || Boolean(state.pending);
  const control = async (action: string) => {
    try {
      await demo?.control(action);
      if (action !== "stale") await client.refresh();
    } catch {
      client.disconnect();
    }
  };
  return (
    <>
      <header className="topbar">
        <a className="logo" href="/">
          cabo<span>✦</span>
        </a>
        <span className="edition">A LITTLE MEMORY. A LITTLE LUCK.</span>
        <span className="connection-dot">
          <i className={state.connection === "connected" ? "online" : ""} />
          {state.connection === "connected" ? "已连接" : "连接待恢复"}
        </span>
      </header>
      <main>
        <div className="breadcrumb">
          游戏空间 <span>/</span> 房间 {s?.room.id ?? "…"}
          <span className="mock-badge">MOCK DEMO</span>
        </div>
        <ConnectionBanner client={client} />
        {!s ? (
          <div className="panel loading" role="status">
            正在进入房间…
          </div>
        ) : (
          <div className="layout">
            <div>
              {!s.game ? (
                <Lobby
                  snapshot={s}
                  disabled={disabled}
                  onAction={(a) => void client.send(a)}
                />
              ) : s.game.phase === "InitialReveal" ? (
                <InitialReveal
                  key={`${s.game.id}/${s.game.round}`}
                  snapshot={s}
                  now={state.now}
                  disabled={disabled}
                  onAction={(a, p) => void client.send(a, p)}
                />
              ) : (
                <GameTable snapshot={s} now={state.now} />
              )}
            </div>
            <aside>
              <div className="side-note">
                <span className="note-icon">✳</span>
                <p className="eyebrow">LESS IS MORE</p>
                <h2>
                  少一点分数，
                  <br />
                  多一点直觉。
                </h2>
                <p>记住你看过的牌，留意桌面的变化。最低分，才是好消息。</p>
              </div>
              <div className="room-facts">
                <h3>这一桌</h3>
                <p>
                  <span>玩家</span>
                  <b>{s.room.members.length} / 4</b>
                </p>
                <p>
                  <span>当前阶段</span>
                  <b>{s.game?.phase ?? "Lobby"}</b>
                </p>
                <p>
                  <span>你的身份</span>
                  <b>{s.self === s.room.host ? "Host" : "Player"}</b>
                </p>
              </div>
            </aside>
          </div>
        )}
        {demo && (
          <details className="demo-tools">
            <summary>演示场景与连接测试</summary>
            <p>
              场景链接建立新的独立 Mock
              会话；不切换真实玩家身份。服务重启后演示会话重置。
            </p>
            <nav aria-label="演示场景">
              <a href="?scene=host">房主大厅</a>
              <a href="?scene=member">成员大厅</a>
              <a href="?scene=initial">初始查看</a>
              <a href="?scene=table">公开牌桌</a>
            </nav>
            <div className="tool-buttons">
              <button onClick={() => client.disconnect()}>模拟本端断线</button>
              <button onClick={() => void control("takeover")}>
                模拟连接接管
              </button>
              <button onClick={() => void control("lost-response")}>
                下次响应丢失
              </button>
              <button onClick={() => void control("stale")}>
                使当前 Decision 过期
              </button>
              <button onClick={() => void control("peers-end")}>
                模拟其他玩家结束查看
              </button>
              <button onClick={() => void control("incompatible")}>
                模拟未知必需版本
              </button>
            </div>
          </details>
        )}
        <footer>
          <span>CABO / FRONTEND MILESTONE 01</span>
          <span>仅供本地演示 · 规则以冻结契约为准</span>
        </footer>
      </main>
    </>
  );
}
